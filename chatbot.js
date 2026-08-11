'use strict';

// =============================================================
// BOT WHATSAPP — SUPORTE TI (THAILAN)
// Versão 1.7: instância única + controle seguro de execução em segundo plano.
// =============================================================

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { findBrowserExecutable } = require('./browser-path');
const { isBusinessHours: checkBusinessHours, getDateCode: makeDateCode, absencePeriodKey: makeAbsencePeriodKey } = require('./horario');
const {
  DB_PATH,
  EXCEL_PATH,
  initDatabase,
  closeDatabase,
  protocolExists,
  insertTicket,
  findTicket,
  priorityFromImpact,
  getPendingNotifications,
  markNotificationSent,
  markNotificationFailed,
} = require('./database');
const { startExcelStatusWatcher, stopExcelStatusWatcher } = require('./excel-sync');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const separator = trimmed.indexOf('=');
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const BOT_VERSION = '1.7.0';
const CONFIG = {
  timezone: process.env.TIMEZONE || 'America/Fortaleza',
  supportName: process.env.SUPPORT_NAME || 'Thailan',
  department: process.env.SUPPORT_DEPARTMENT || 'Suporte TI',
  sessionTimeoutMinutes: Number(process.env.SESSION_TIMEOUT_MINUTES || 30),
  headless: String(process.env.HEADLESS || 'true').toLowerCase() !== 'false',
};

const ROOT_DIR = __dirname;
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'erros.log');
const RUNTIME_DIR = path.join(ROOT_DIR, 'runtime');
const PID_FILE = path.join(RUNTIME_DIR, 'bot.pid.json');

function isProcessAlive(pid) {
  if (!pid || !Number.isInteger(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

function releaseRuntimePid() {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    const current = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    if (Number(current.pid) === process.pid) fs.rmSync(PID_FILE, { force: true });
  } catch {}
}

function claimRuntimePid() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });

  if (fs.existsSync(PID_FILE)) {
    try {
      const previous = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
      const previousPid = Number(previous.pid);
      if (previousPid && previousPid !== process.pid && isProcessAlive(previousPid)) {
        throw new Error(`BOT_ALREADY_RUNNING:${previousPid}`);
      }
    } catch (error) {
      if (String(error?.message || '').startsWith('BOT_ALREADY_RUNNING:')) throw error;
    }
    try { fs.rmSync(PID_FILE, { force: true }); } catch {}
  }

  try {
    const fd = fs.openSync(PID_FILE, 'wx');
    fs.writeFileSync(fd, JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      version: BOT_VERSION,
      rootDir: ROOT_DIR,
    }, null, 2));
    fs.closeSync(fd);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('BOT_ALREADY_RUNNING:LOCK');
    }
    throw error;
  }
}

process.on('exit', releaseRuntimePid);

const sessions = new Map();
const processedMessages = new Set();
const chatQueues = new Map();
let whatsappReady = false;
let notificationProcessing = false;
let notificationTimer = null;

// Cada categoria tem apenas UMA pergunta técnica. As outras duas perguntas são:
// identificação (nome e local) e urgência. Assim, o chamado inteiro possui somente 3 perguntas.
const CATEGORIES = {
  '1': {
    title: 'Internet ou Wi-Fi',
    detailQuestion: 'Informe o local, o nome da rede e o que acontece ao tentar conectar. Diga também quando o problema começou.',
  },
  '2': {
    title: 'Computador ou notebook',
    detailQuestion: 'Descreva o defeito do computador ou notebook e diga se aparece alguma mensagem de erro.',
  },
  '3': {
    title: 'Impressora ou copiadora',
    detailQuestion: 'Informe o modelo da impressora ou copiadora, se souber, e descreva o problema apresentado.',
  },
  '4': {
    title: 'TV, projetor ou equipamento de sala',
    detailQuestion: 'Informe a sala, qual equipamento está com problema e descreva o que não está funcionando.',
  },
  '5': {
    title: 'E-mail institucional',
    detailQuestion: 'Informe o e-mail institucional, o dispositivo utilizado e descreva o problema. Não envie sua senha.',
  },
  '6': {
    title: 'Senha ou acesso a sistemas',
    detailQuestion: 'Informe o sistema e o login ou e-mail utilizado, e diga se o acesso está bloqueado, sem permissão ou com senha esquecida. Não envie senhas.',
  },
  '7': {
    title: 'Sistema acadêmico ou administrativo',
    detailQuestion: 'Informe o nome do sistema, a função que estava utilizando e a mensagem de erro, caso exista.',
  },
  '8': {
    title: 'Instalação ou atualização de programas',
    detailQuestion: 'Informe o programa, o equipamento em que será instalado e a finalidade. Não serão instalados programas sem licença.',
  },
  '9': {
    title: 'Arquivos, pastas, backup ou recuperação',
    detailQuestion: 'Informe o arquivo ou pasta, onde estava armazenado e o que aconteceu: exclusão, substituição, corrupção ou falha ao abrir.',
  },
  '10': {
    title: 'Vírus, segurança ou atividade suspeita',
    detailQuestion: 'Informe a conta ou equipamento envolvido, o que foi identificado e se houve clique em link, download ou fornecimento de dados. Não envie senhas.',
    securityNotice: true,
  },
  '11': {
    title: 'Solicitação de equipamento',
    detailQuestion: 'Informe qual equipamento é necessário, a finalidade, a data desejada e se existe autorização da coordenação ou gestão.',
  },
  '12': {
    title: 'Reserva de equipamento',
    detailQuestion: 'Informe o equipamento, data, horários de retirada e devolução, local de uso e responsável pela reserva.',
    reservationNotice: true,
  },
  '13': {
    title: 'Criação, alteração ou exclusão de usuário',
    detailQuestion: 'Informe o nome do usuário, o tipo de solicitação, os sistemas necessários e se existe autorização da gestão.',
  },
  '14': {
    title: 'Telefone, WhatsApp ou comunicação institucional',
    detailQuestion: 'Informe o aparelho, número ou setor envolvido e descreva o problema com chamadas, mensagens, áudio, contatos, grupos ou acesso.',
  },
  '15': {
    title: 'Manutenção preventiva',
    detailQuestion: 'Informe o equipamento, a manutenção desejada e o melhor período para realizar o serviço.',
  },
  '16': {
    title: 'Acompanhamento de solicitação',
    statusLookup: true,
  },
  '17': {
    title: 'Outro problema',
    detailQuestion: 'Descreva o problema, informe o equipamento ou serviço envolvido, onde ocorre e quando começou.',
  },
  '18': {
    title: `Falar com ${CONFIG.supportName}`,
    detailQuestion: `Descreva resumidamente o assunto que deseja tratar com ${CONFIG.supportName} e informe se há algum prazo importante.`,
  },
};

const MAIN_MENU = `*${CONFIG.department} — ${CONFIG.supportName}* 🖥️\n\nEscolha uma opção digitando somente o número:\n\n1. Internet ou Wi-Fi\n2. Computador ou notebook\n3. Impressora ou copiadora\n4. TV, projetor ou equipamento de sala\n5. E-mail institucional\n6. Senha ou acesso a sistemas\n7. Sistema acadêmico ou administrativo\n8. Instalação ou atualização de programas\n9. Arquivos, pastas, backup ou recuperação\n10. Vírus, segurança ou atividade suspeita\n11. Solicitação de equipamento\n12. Reserva de equipamento\n13. Criação, alteração ou exclusão de usuário\n14. Telefone, WhatsApp ou comunicação institucional\n15. Manutenção preventiva\n16. Acompanhamento de solicitação\n17. Outro problema\n18. Falar com ${CONFIG.supportName}\n0. Encerrar atendimento\n\n_O chamado terá somente 3 perguntas._\n_Comandos: menu, voltar, cancelar, status e atendente._`;

const HOURS_TEXT = `🕐 *Horário de atendimento*\n\nSegunda a sexta-feira:\n• 08h às 11h30\n• 12h45 às 18h\n\nNão há atendimento durante o intervalo de 11h30 às 12h45, aos sábados e aos domingos.`;

const ABSENCE_MESSAGE = `Olá! No momento, o *${CONFIG.department}* está fora do horário de atendimento.\n\n${HOURS_TEXT}\n\nVocê pode registrar a solicitação agora. Ela ficará salva e será analisada no próximo período de atendimento.\n\n1. Registrar solicitação\n2. Consultar o horário\n0. Encerrar atendimento`;

const PRIVACY_NOTICE = '🔒 Não envie senhas, códigos de autenticação, CPF, dados bancários ou informações pessoais desnecessárias.';

const browserExecutablePath = findBrowserExecutable();
const puppeteerOptions = {
  headless: CONFIG.headless,
  executablePath: browserExecutablePath || undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
};

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(ROOT_DIR, '.wwebjs_auth') }),
  puppeteer: puppeteerOptions,
});

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatError(error) {
  if (!error) return 'Erro desconhecido';
  if (error.stack) return error.stack;
  if (error.message) return error.message;
  return String(error);
}

function writeErrorLog(context, error, metadata = {}) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const entry = [
      '=============================================================',
      new Date().toISOString(),
      `Contexto: ${context}`,
      `Metadados: ${JSON.stringify(metadata)}`,
      formatError(error),
      '',
    ].join('\n');
    fs.appendFileSync(ERROR_LOG_FILE, entry, 'utf8');
  } catch (logError) {
    console.error('[ERRO] Não foi possível gravar o log:', logError.message);
  }
}

function isIgnoredChatId(chatId) {
  const id = String(chatId || '');
  return !id
    || id === 'status@broadcast'
    || id.endsWith('@g.us')
    || id.endsWith('@broadcast')
    || id.endsWith('@newsletter');
}

function formatDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: CONFIG.timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(date));
}

function isBusinessHours(date = new Date()) {
  return checkBusinessHours(date, CONFIG.timezone);
}

function getDateCode(date = new Date()) {
  return makeDateCode(date, CONFIG.timezone);
}

function absencePeriodKey(date = new Date()) {
  return makeAbsencePeriodKey(date, CONFIG.timezone);
}

function getPhoneFromChatId(chatId) {
  return String(chatId || '').split('@')[0] || 'Não informado';
}

function createSession(chatId) {
  const outside = !isBusinessHours();
  const session = {
    chatId,
    step: outside ? 'outside_menu' : 'menu',
    previousStep: null,
    pendingCategory: null,
    ticket: null,
    outsideBusinessHours: outside,
    absenceNotifiedKey: outside ? absencePeriodKey() : null,
    lastActivity: Date.now(),
    lastResponseAt: 0,
  };
  sessions.set(chatId, session);
  return session;
}

function makeTicketSession(categoryKey) {
  return {
    categoryKey,
    categoryTitle: CATEGORIES[categoryKey].title,
    identity: null,
    name: 'Não informado',
    sector: 'Não informado',
    location: 'Não informado',
    details: '',
    impact: '',
    answers: [],
    fields: {},
    ticketSaved: false,
  };
}

function parseIdentity(answer) {
  const text = String(answer || '').trim();

  // Formato atual: Nome, Local. Se o local tiver vírgulas, tudo após a primeira
  // vírgula é preservado como parte do local.
  const commaParts = text.split(',').map((item) => item.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    return { name: commaParts[0], sector: '', location: commaParts.slice(1).join(', ') };
  }

  // Compatibilidade temporária com uma conversa que já estivesse aberta
  // antes da atualização, quando o formato antigo usava |.
  const legacyParts = text.split('|').map((item) => item.trim()).filter(Boolean);
  if (legacyParts.length >= 2) {
    return {
      name: legacyParts[0],
      sector: '',
      location: legacyParts.length >= 3 ? legacyParts.slice(2).join(' | ') : legacyParts[1],
    };
  }

  return { name: text, sector: '', location: '' };
}

function impactFromOption(option) {
  return {
    '1': 'Baixo — apenas uma pessoa, sem interrupção total',
    '2': 'Médio — algumas pessoas ou dificuldade relevante',
    '3': 'Alto — uma turma ou setor inteiro parado',
    '4': 'Crítico — toda a escola ou serviço essencial indisponível',
  }[String(option || '').trim()];
}

function markMessageProcessed(messageId) {
  if (!messageId) return false;
  if (processedMessages.has(messageId)) return true;
  processedMessages.add(messageId);
  if (processedMessages.size > 5000) {
    const first = processedMessages.values().next().value;
    processedMessages.delete(first);
  }
  return false;
}

function enqueueChat(chatId, task) {
  const previous = chatQueues.get(chatId) || Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(task)
    .catch(async (error) => {
      console.error('[ERRO] Falha ao processar a mensagem:', error);
      writeErrorLog('PROCESSAMENTO_DA_MENSAGEM', error, { chatId });
      try {
        await sendText(chatId, 'Ocorreu um erro temporário ao processar sua mensagem. Envie *menu* para tentar novamente.');
      } catch (sendError) {
        writeErrorLog('ENVIO_DO_AVISO_DE_ERRO', sendError, { chatId });
      }
    })
    .finally(() => {
      if (chatQueues.get(chatId) === current) chatQueues.delete(chatId);
    });

  chatQueues.set(chatId, current);
  return current;
}

async function sendText(chatId, text) {
  const session = sessions.get(chatId);
  const now = Date.now();
  if (session?.lastResponseAt && now - session.lastResponseAt < 450) {
    await sleep(450 - (now - session.lastResponseAt));
  }
  await client.sendMessage(chatId, text);
  if (session) session.lastResponseAt = Date.now();
}

function notificationDestinationCandidates(notification) {
  const candidates = [];
  const add = (value) => {
    const text = String(value || '').trim();
    if (text && !candidates.includes(text)) candidates.push(text);
  };

  add(notification.destino);
  add(notification.chat_id);

  const rawNumber = String(notification.numero_whatsapp || notification.telefone_chamado || '').trim();
  if (rawNumber.includes('@')) add(rawNumber);
  const digits = rawNumber.replace(/\D/g, '');
  if (digits) {
    add(`${digits}@c.us`);
    add(`${digits}@lid`);
  }

  return candidates;
}

async function processPendingNotifications() {
  if (!whatsappReady || notificationProcessing) return;
  notificationProcessing = true;
  try {
    const notifications = getPendingNotifications(20);
    for (const notification of notifications) {
      const candidates = notificationDestinationCandidates(notification);
      let sent = false;
      let lastError = null;

      for (const destination of candidates) {
        try {
          await client.sendMessage(destination, notification.mensagem);
          markNotificationSent(notification.id);
          console.log(`[OK] Encerramento do chamado ${notification.protocolo} informado ao usuário.`);
          sent = true;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!sent) {
        const errorMessage = lastError?.message || 'Não foi possível localizar a conversa do usuário no WhatsApp.';
        const result = markNotificationFailed(notification.id, errorMessage);
        console.warn(`[AVISO] Notificação do chamado ${notification.protocolo} não enviada. Tentativa ${result?.tentativas || '?'}/20.`);
      }

      await sleep(600);
    }
  } catch (error) {
    console.error('[ERRO] Falha ao processar notificações de encerramento:', error);
    writeErrorLog('NOTIFICACOES_DE_ENCERRAMENTO', error);
  } finally {
    notificationProcessing = false;
  }
}

async function notifyAbsenceIfNeeded(chatId, session) {
  if (isBusinessHours()) {
    session.outsideBusinessHours = false;
    session.absenceNotifiedKey = null;
    return false;
  }

  session.outsideBusinessHours = true;
  const key = absencePeriodKey();
  if (session.absenceNotifiedKey !== key) {
    session.absenceNotifiedKey = key;
    await sendText(chatId, ABSENCE_MESSAGE);
    if (session.step === 'menu') session.step = 'outside_menu';
    return true;
  }
  return false;
}

async function beginConversation(chatId) {
  const session = createSession(chatId);
  if (session.outsideBusinessHours) {
    await sendText(chatId, ABSENCE_MESSAGE);
    return;
  }

  await sendText(
    chatId,
    `Olá! 👋 Você entrou em contato com o *${CONFIG.department} da escola*.\n\nResponsável: *${CONFIG.supportName}*.\n\nPara facilitar, cada solicitação terá somente *3 perguntas*.`,
  );
  await showMainMenu(chatId, session);
}

async function showMainMenu(chatId, session) {
  session.step = 'menu';
  session.ticket = null;
  session.pendingCategory = null;
  session.lastActivity = Date.now();
  await sendText(chatId, MAIN_MENU);
}

async function processOutsideMenu(chatId, session, body) {
  if (body === '1') {
    session.step = 'menu';
    await sendText(chatId, 'Sua solicitação será registrada e analisada no próximo período de atendimento.');
    await showMainMenu(chatId, session);
    return;
  }

  if (body === '2') {
    await sendText(chatId, `${HOURS_TEXT}\n\nDigite *1* para registrar uma solicitação ou *0* para encerrar.`);
    return;
  }

  await sendText(chatId, 'Digite *1* para registrar a solicitação, *2* para consultar o horário ou *0* para encerrar.');
}

async function startCategory(chatId, session, categoryKey) {
  const category = CATEGORIES[categoryKey];
  if (!category) {
    await sendText(chatId, 'Opção inválida. Digite apenas o número correspondente ou envie *menu*.');
    return;
  }

  if (category.statusLookup) {
    session.step = 'await_protocol';
    await sendText(chatId, 'Informe o protocolo no formato *TI-AAAAMMDD-XXXX*.');
    return;
  }

  session.ticket = makeTicketSession(categoryKey);
  session.step = 'question_identity';

  let introduction = `Você selecionou: *${category.title}*.`;
  if (category.securityNotice) {
    introduction += '\n\n⚠️ Se houver suspeita de invasão, evite continuar utilizando a conta ou o equipamento até a avaliação do Suporte TI.';
  }
  if (category.reservationNotice) {
    introduction += '\n\n📅 O registro não garante a reserva. A disponibilidade será confirmada pelo setor de TI.';
  }
  if (categoryKey === '18') {
    introduction += `\n\nO retorno de ${CONFIG.supportName} acontecerá conforme disponibilidade e prioridade.`;
  }

  await sendText(chatId, introduction);
  await sendText(
    chatId,
    '*Pergunta 1 de 3:*\nInforme somente seu *nome e local*, separados por vírgula `,`.\n\nExemplo: Ana Silva, Recepção',
  );
}

async function processIdentity(chatId, session, body) {
  const answer = body.trim();
  if (!answer) {
    await sendText(chatId, 'Envie seu nome e local separados por vírgula. Exemplo: Ana Silva, Recepção');
    return;
  }

  const identity = parseIdentity(answer);
  if (!identity.name || !identity.location) {
    await sendText(chatId, 'Informe os dois dados separados por vírgula. Exemplo: Ana Silva, Recepção');
    return;
  }

  Object.assign(session.ticket, identity, { identity: answer });
  session.ticket.answers.push({
    campo: 'identificacao',
    pergunta: 'Nome e local',
    resposta: answer,
  });
  session.ticket.fields.identificacao = answer;
  session.step = 'question_details';

  const category = CATEGORIES[session.ticket.categoryKey];
  await sendText(chatId, `*Pergunta 2 de 3:*\n${category.detailQuestion}`);
}

async function processDetails(chatId, session, body, message) {
  let answer = body.trim();
  if (!answer && message.hasMedia) answer = '[Arquivo ou mídia enviado pelo usuário]';
  if (!answer) {
    await sendText(chatId, 'Descreva a solicitação em uma mensagem curta. Você também pode enviar uma imagem.');
    return;
  }
  if (answer.length > 2500) {
    await sendText(chatId, 'A mensagem está muito longa. Resuma em até 2.500 caracteres.');
    return;
  }

  const category = CATEGORIES[session.ticket.categoryKey];
  session.ticket.details = answer;
  session.ticket.answers.push({
    campo: 'detalhes',
    pergunta: category.detailQuestion,
    resposta: answer,
  });
  session.ticket.fields.detalhes = answer;
  session.step = 'question_urgency';

  await sendText(
    chatId,
    `*Pergunta 3 de 3 — grau de urgência:*\n\n1. *Baixa* — apenas uma pessoa, sem interrupção total\n2. *Média* — algumas pessoas ou dificuldade relevante\n3. *Alta* — uma turma ou setor inteiro parado\n4. *Crítica* — toda a escola ou serviço essencial indisponível\n\n${PRIVACY_NOTICE}`,
  );
}

async function generateProtocol() {
  const dateCode = getDateCode();
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const sequence = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const protocol = `TI-${dateCode}-${sequence}`;
    if (!protocolExists(protocol)) return protocol;
  }
  return `TI-${dateCode}-${Date.now().toString().slice(-6)}`;
}

async function saveCurrentTicket(session) {
  if (!session.ticket || session.ticket.ticketSaved) return null;

  const protocol = await generateProtocol();
  const createdAt = new Date().toISOString();
  const priority = priorityFromImpact(session.ticket.impact);
  const record = {
    protocolo: protocol,
    dataHora: createdAt,
    dataHoraFormatada: formatDateTime(createdAt),
    nome: session.ticket.name,
    numeroWhatsApp: getPhoneFromChatId(session.chatId),
    chatId: session.chatId,
    setor: session.ticket.sector,
    local: session.ticket.location,
    descricaoInicial: session.ticket.details,
    categoria: session.ticket.categoryTitle,
    categoriaCodigo: session.ticket.categoryKey,
    respostas: session.ticket.answers,
    dadosSolicitacao: session.ticket.fields,
    nivelImpacto: session.ticket.impact,
    prioridade: priority,
    foraDoHorario: !isBusinessHours() || session.outsideBusinessHours,
    urgenteInformadoForaDoHorario: priority === 'Crítica' && (!isBusinessHours() || session.outsideBusinessHours),
    status: 'Recebido',
    ultimaAtualizacao: createdAt,
    historico: [{
      dataHora: createdAt,
      status: 'Recebido',
      observacao: 'Chamado criado automaticamente pelo bot.',
    }],
  };

  const saved = insertTicket(record);
  session.ticket.ticketSaved = true;
  return saved;
}

async function processUrgency(chatId, session, body) {
  const impact = impactFromOption(body);
  if (!impact) {
    await sendText(chatId, 'Digite somente *1*, *2*, *3* ou *4* para indicar a urgência.');
    return;
  }

  session.ticket.impact = impact;
  session.ticket.answers.push({
    campo: 'urgencia',
    pergunta: 'Grau de urgência',
    resposta: impact,
  });
  session.ticket.fields.urgencia = impact;

  const record = await saveCurrentTicket(session);
  let finalMessage = `✅ *Solicitação registrada com sucesso!*\n\n*Protocolo:* ${record.protocolo}\n*Categoria:* ${record.categoria}\n*Urgência:* ${record.prioridade}\n*Status:* ${record.status}\n*Data:* ${record.dataHoraFormatada}\n\nOs chamados são organizados por urgência no banco de dados e na planilha Excel automática. Guarde o protocolo para acompanhar o atendimento.`;

  if (record.foraDoHorario) {
    finalMessage += '\n\n🌙 O registro foi feito fora do horário de atendimento e será analisado no próximo período disponível.';
  }
  if (record.prioridade === 'Crítica') {
    finalMessage += '\n\n⚠️ A prioridade crítica será avaliada, mas o registro não representa promessa de atendimento imediato.';
  }

  await sendText(chatId, finalMessage);
  session.ticket = null;
  session.step = 'menu';
  await sendText(chatId, 'Para registrar outra solicitação, envie *menu*. Para encerrar, envie *0*.');
}

function extractProtocol(text) {
  const match = String(text || '').toUpperCase().match(/TI-\d{8}-\d{4,6}/);
  return match ? match[0] : null;
}

async function showTicketStatus(chatId, session, text) {
  const protocol = extractProtocol(text) || String(text || '').trim().toUpperCase();
  const ticket = findTicket(protocol);
  if (!ticket) {
    await sendText(chatId, `Não encontrei o protocolo *${protocol}*. Exemplo: TI-20260806-0042`);
    return;
  }

  await sendText(
    chatId,
    `🔎 *Acompanhamento de solicitação*\n\n*Protocolo:* ${ticket.protocolo}\n*Categoria:* ${ticket.categoria}\n*Urgência:* ${ticket.prioridade}\n*Data de abertura:* ${ticket.dataHoraFormatada || formatDateTime(ticket.dataHora)}\n*Status:* ${ticket.status}\n*Última atualização:* ${formatDateTime(ticket.ultimaAtualizacao)}\n\nEnvie *menu* para voltar.`,
  );
  session.step = 'menu';
}

async function requestClose(chatId, session) {
  session.previousStep = session.step;
  session.step = 'close_confirm';
  await sendText(chatId, 'Deseja realmente encerrar o atendimento?\n\n1. Sim\n2. Não');
}

async function processCloseConfirmation(chatId, session, body) {
  const normalized = normalizeText(body);
  if (['1', 'sim', 's'].includes(normalized)) {
    sessions.delete(chatId);
    await client.sendMessage(chatId, `Atendimento encerrado. Obrigado por entrar em contato com o ${CONFIG.department}.\n\nPara iniciar novamente, envie *Olá* ou *menu*.`);
    return;
  }
  if (['2', 'nao', 'n'].includes(normalized)) {
    session.step = session.previousStep || 'menu';
    session.previousStep = null;
    await sendText(chatId, 'Atendimento mantido. Continue de onde parou ou envie *menu*.');
    return;
  }
  await sendText(chatId, 'Digite *1* para sim ou *2* para não.');
}

async function goBack(chatId, session) {
  if (session.step === 'question_details' && session.ticket) {
    session.ticket.answers = [];
    session.ticket.fields = {};
    session.step = 'question_identity';
    await sendText(chatId, '*Pergunta 1 de 3:*\nInforme somente seu nome e local, separados por vírgula `,`.\nExemplo: Ana Silva, Recepção');
    return;
  }
  if (session.step === 'question_urgency' && session.ticket) {
    session.ticket.answers = session.ticket.answers.slice(0, 1);
    delete session.ticket.fields.detalhes;
    session.step = 'question_details';
    await sendText(chatId, `*Pergunta 2 de 3:*\n${CATEGORIES[session.ticket.categoryKey].detailQuestion}`);
    return;
  }
  if (session.step === 'question_identity') {
    await showMainMenu(chatId, session);
    return;
  }
  await sendText(chatId, 'Não há uma etapa anterior. Envie *menu* para ver as opções.');
}

async function processMessage(message) {
  const chatId = String(message.from || '');
  const bodyOriginal = String(message.body || '').trim();
  const body = normalizeText(bodyOriginal);

  if (!bodyOriginal && !message.hasMedia) return;

  let session = sessions.get(chatId);
  if (!session) {
    await beginConversation(chatId);
    return;
  }

  session.lastActivity = Date.now();

  if (session.step !== 'outside_menu') {
    await notifyAbsenceIfNeeded(chatId, session);
  }

  if (session.step === 'close_confirm') {
    await processCloseConfirmation(chatId, session, bodyOriginal);
    return;
  }

  if (body === 'cancelar' || bodyOriginal === '0') {
    await requestClose(chatId, session);
    return;
  }

  if (body === 'menu') {
    if (!isBusinessHours() && session.step === 'outside_menu') {
      await sendText(chatId, ABSENCE_MESSAGE);
      return;
    }
    await showMainMenu(chatId, session);
    return;
  }

  if (body === 'voltar') {
    await goBack(chatId, session);
    return;
  }

  if (body === 'status' || body.startsWith('status ')) {
    const protocol = extractProtocol(bodyOriginal);
    if (protocol) {
      await showTicketStatus(chatId, session, protocol);
    } else {
      session.step = 'await_protocol';
      await sendText(chatId, 'Informe o protocolo no formato *TI-AAAAMMDD-XXXX*.');
    }
    return;
  }

  if (body === 'atendente') {
    await startCategory(chatId, session, '18');
    return;
  }

  switch (session.step) {
    case 'outside_menu':
      await processOutsideMenu(chatId, session, bodyOriginal);
      break;
    case 'menu':
      await startCategory(chatId, session, bodyOriginal);
      break;
    case 'question_identity':
      await processIdentity(chatId, session, bodyOriginal);
      break;
    case 'question_details':
      await processDetails(chatId, session, bodyOriginal, message);
      break;
    case 'question_urgency':
      await processUrgency(chatId, session, bodyOriginal);
      break;
    case 'await_protocol':
      await showTicketStatus(chatId, session, bodyOriginal);
      break;
    default:
      await showMainMenu(chatId, session);
  }
}

client.on('qr', (qr) => {
  console.clear();
  console.log('=============================================================');
  console.log(' ESCANEIE O QR CODE COM O WHATSAPP DO SUPORTE TI');
  console.log('=============================================================');
  console.log('No celular: WhatsApp > Configurações > Aparelhos conectados');
  console.log('> Conectar um aparelho.\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('\n[OK] Autenticação realizada com sucesso.');
});

client.on('ready', () => {
  whatsappReady = true;
  startExcelStatusWatcher();
  if (!notificationTimer) {
    notificationTimer = setInterval(processPendingNotifications, 20 * 1000);
    notificationTimer.unref();
  }
  setTimeout(processPendingNotifications, 1500).unref();

  console.clear();
  console.log('=============================================================');
  console.log(` ${CONFIG.department.toUpperCase()} — ${CONFIG.supportName.toUpperCase()}`);
  console.log('=============================================================');
  console.log('[OK] WhatsApp conectado com sucesso.');
  console.log('[OK] Bot iniciado e aguardando mensagens privadas.');
  console.log(`[INFO] Versão do bot: ${BOT_VERSION}.`);
  console.log(`[INFO] Horário: segunda a sexta, 08h–11h30 e 12h45–18h.`);
  console.log(`[INFO] Banco SQLite: ${DB_PATH}`);
  console.log(`[INFO] Planilha automática: ${EXCEL_PATH}`);
  console.log('[INFO] Encerramento pelo Excel: altere a coluna Status para Encerrado e salve.');
  console.log('\nNão feche esta janela enquanto o bot estiver funcionando.');
});

client.on('auth_failure', (message) => {
  whatsappReady = false;
  console.error('[ERRO] Falha de autenticação:', message);
  console.error('Execute “4-GERAR-NOVO-QR-CODE.bat”.');
});

client.on('disconnected', (reason) => {
  whatsappReady = false;
  console.error('[ERRO] WhatsApp desconectado:', reason);
  console.error('Feche esta janela e execute novamente “INICIAR-AQUI.bat”.');
});

client.on('message', async (message) => {
  const chatId = String(message?.from || '');
  try {
    if (!message || typeof message !== 'object') return;
    if (message.fromMe || message.id?.fromMe) return;
    if (isIgnoredChatId(chatId)) return;

    const messageId = message.id?._serialized || message.id?.id;
    if (markMessageProcessed(messageId)) return;

    console.log(`[MENSAGEM] Recebida de ${chatId} em ${formatDateTime()}.`);
    await enqueueChat(chatId, () => processMessage(message));
  } catch (error) {
    console.error('[ERRO] Não foi possível preparar a mensagem:', error);
    writeErrorLog('PREPARACAO_DA_MENSAGEM', error, { chatId });
  }
});

setInterval(() => {
  const timeout = CONFIG.sessionTimeoutMinutes * 60 * 1000;
  const now = Date.now();
  for (const [chatId, session] of sessions.entries()) {
    if (now - session.lastActivity > timeout) {
      sessions.delete(chatId);
      console.log(`[INFO] Sessão inativa encerrada: ${chatId}`);
    }
  }
}, 5 * 60 * 1000).unref();

process.on('unhandledRejection', (error) => {
  console.error('[ERRO] Promessa não tratada:', error);
  writeErrorLog('PROMESSA_NAO_TRATADA', error);
});

process.on('uncaughtException', (error) => {
  console.error('[ERRO] Exceção não tratada:', error);
  writeErrorLog('EXCECAO_NAO_TRATADA', error);
});

process.on('SIGINT', async () => {
  console.log('\n[INFO] Encerrando o bot com segurança...');
  try {
    whatsappReady = false;
    stopExcelStatusWatcher();
    if (notificationTimer) clearInterval(notificationTimer);
    notificationTimer = null;
    await client.destroy();
    closeDatabase();
    releaseRuntimePid();
  } catch (error) {
    console.error('[AVISO] Erro ao encerrar:', error.message);
  }
  process.exit(0);
});

(async () => {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    claimRuntimePid();
    initDatabase();

    if (!browserExecutablePath) {
      throw new Error('Nenhum navegador compatível foi encontrado. Instale Google Chrome ou Microsoft Edge.');
    }

    console.log('=============================================================');
    console.log(` INICIANDO ${CONFIG.department.toUpperCase()} — ${CONFIG.supportName.toUpperCase()}`);
    console.log('=============================================================');
    console.log(`[OK] Navegador encontrado: ${browserExecutablePath}`);
    console.log(`[OK] Banco de dados pronto: ${DB_PATH}`);
    console.log('[INFO] Aguarde a abertura do WhatsApp Web...');
    await client.initialize();
  } catch (error) {
    const errorText = String(error?.message || error || '');
    console.error('\n[ERRO] Não foi possível iniciar o bot.');

    if (errorText.startsWith('BOT_ALREADY_RUNNING:') || /browser is already running/i.test(errorText)) {
      console.error('[INFO] Já existe uma instância usando esta sessão do WhatsApp.');
      console.error('[INFO] Feche esta janela e execute INICIAR-AQUI.bat para ver o status ou reiniciar com segurança.');
    } else {
      console.error(error);
      console.error('\nExecute “6-DIAGNOSTICO.bat” para identificar o problema.');
    }

    writeErrorLog('INICIALIZACAO', error);
    releaseRuntimePid();
    process.exitCode = 1;
  }
})();
