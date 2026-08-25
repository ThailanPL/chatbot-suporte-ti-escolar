'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TARGET = path.join(ROOT, 'chatbot.js');
const BACKUP = path.join(ROOT, 'backup-antes-v1.8-chatbot.js');

function fail(message) {
  console.error(`\n[ERRO] ${message}`);
  process.exit(1);
}

function replaceOnce(source, searchValue, replacement, label) {
  const after = source.replace(searchValue, replacement);
  if (after === source) fail(`Não foi possível localizar o trecho: ${label}.`);
  return after;
}

if (!fs.existsSync(TARGET)) fail('chatbot.js não encontrado.');
let source = fs.readFileSync(TARGET, 'utf8');

if (source.includes("const BOT_VERSION = '1.8.0';") && source.includes('free_chat_confirm')) {
  console.log('[OK] A atualização v1.8.0 já está aplicada.');
  process.exit(0);
}
if (!source.includes("const BOT_VERSION = '1.7.0';")) fail('A versão esperada (1.7.0) não foi encontrada.');

fs.copyFileSync(TARGET, BACKUP);

source = replaceOnce(source,
  '// Versão 1.7: instância única + controle seguro de execução em segundo plano.',
  '// Versão 1.8: atendimento livre na opção 18 + detecção inteligente de chamados.',
  'cabeçalho da versão');
source = replaceOnce(source, "const BOT_VERSION = '1.7.0';", "const BOT_VERSION = '1.8.0';", 'BOT_VERSION');

const oldCategoriesTail = `  '16': {
    title: 'Acompanhamento de solicitação',
    statusLookup: true,
  },
  '17': {
    title: 'Outro problema',
    detailQuestion: 'Descreva o problema, informe o equipamento ou serviço envolvido, onde ocorre e quando começou.',
  },
  '18': {
    title: \`Falar com \${CONFIG.supportName}\`,
    detailQuestion: \`Descreva resumidamente o assunto que deseja tratar com \${CONFIG.supportName} e informe se há algum prazo importante.\`,
  },
};`;

const newCategoriesTail = `  '16': {
    title: 'Outro problema',
    detailQuestion: 'Descreva o problema, informe o equipamento ou serviço envolvido, onde ocorre e quando começou.',
  },
  '17': {
    title: 'Acompanhamento de solicitação',
    statusLookup: true,
  },
  '18': {
    title: \`Falar com \${CONFIG.supportName}\`,
    freeChat: true,
  },
};`;
source = replaceOnce(source, oldCategoriesTail, newCategoriesTail, 'categorias 16, 17 e 18');

source = replaceOnce(source,
  `15. Manutenção preventiva\\n16. Acompanhamento de solicitação\\n17. Outro problema\\n18. Falar com \${CONFIG.supportName}`,
  `15. Manutenção preventiva\\n16. Outro problema\\n17. Acompanhamento de solicitação\\n18. Falar com \${CONFIG.supportName}`,
  'ordem das opções 16 e 17 no menu');

const keywordBlock = `

const FREE_CHAT_KEYWORDS = {
  '1': ['internet', 'wi-fi', 'wifi', 'sem internet', 'rede sem conexao', 'nao conecta', 'conexao'],
  '2': ['computador', 'notebook', 'pc', 'windows', 'travando', 'travou', 'lento', 'tela preta', 'nao liga', 'reiniciando'],
  '3': ['impressora', 'copiadora', 'scanner', 'imprimir', 'impressao', 'toner', 'tinta', 'papel atolado', 'fila de impressao'],
  '4': ['projetor', 'datashow', 'tv da sala', 'televisao', 'hdmi', 'equipamento de sala', 'caixa de som'],
  '5': ['e-mail institucional', 'email institucional', 'gmail', 'e-mail nao envia', 'email nao envia', 'e-mail nao recebe', 'email nao recebe'],
  '6': ['senha', 'login', 'acesso bloqueado', 'sem acesso', 'permissao', 'autenticacao', 'conta bloqueada'],
  '7': ['sistema academico', 'sistema administrativo', 'portal', 'diario', 'frequencia', 'notas', 'matricula'],
  '8': ['instalar programa', 'instalacao de programa', 'atualizar programa', 'atualizacao de programa', 'software', 'aplicativo'],
  '9': ['arquivo', 'pasta', 'backup', 'recuperar arquivo', 'arquivo excluido', 'drive', 'armazenamento'],
  '10': ['virus', 'malware', 'phishing', 'conta invadida', 'atividade suspeita', 'link suspeito', 'seguranca'],
  '11': ['solicitar equipamento', 'preciso de equipamento', 'equipamento novo', 'pedido de equipamento'],
  '12': ['reservar equipamento', 'reserva de equipamento', 'emprestimo de equipamento', 'emprestar equipamento', 'reservar notebook', 'reservar projetor'],
  '13': ['criar usuario', 'novo usuario', 'alterar usuario', 'excluir usuario', 'remover usuario', 'conta de colaborador'],
  '14': ['telefone', 'ramal', 'whatsapp', 'ligacao', 'chamada', 'chip', 'comunicacao institucional'],
  '15': ['manutencao preventiva', 'preventiva', 'limpeza de computador', 'revisao de equipamento'],
  '16': ['outro problema', 'problema nao listado', 'nao esta na lista'],
};

function keywordMatches(text, keyword) {
  const normalizedText = normalizeText(text);
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedText || !normalizedKeyword) return false;
  if (normalizedKeyword.includes(' ')) return normalizedText.includes(normalizedKeyword);
  const wordsOnly = normalizedText.replace(/[^a-z0-9]+/g, ' ').trim();
  return \` \${wordsOnly} \`.includes(\` \${normalizedKeyword} \`);
}

function detectSupportCategory(text) {
  const matches = [];
  for (const [categoryKey, keywords] of Object.entries(FREE_CHAT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (keywordMatches(text, keyword)) matches.push({ categoryKey, keyword, length: normalizeText(keyword).length });
    }
  }
  if (!matches.length) return null;
  matches.sort((a, b) => b.length - a.length);
  return matches[0];
}
`;

source = replaceOnce(source,
  "const PRIVACY_NOTICE = '🔒 Não envie senhas, códigos de autenticação, CPF, dados bancários ou informações pessoais desnecessárias.';",
  "const PRIVACY_NOTICE = '🔒 Não envie senhas, códigos de autenticação, CPF, dados bancários ou informações pessoais desnecessárias.';" + keywordBlock,
  'bloco de palavras-chave');

source = replaceOnce(source,
`    pendingCategory: null,
    ticket: null,`,
`    pendingCategory: null,
    pendingFreeChatMessage: null,
    returnToFreeChat: false,
    ticket: null,`, 'campos da sessão');

source = replaceOnce(source,
`  session.ticket = null;
  session.pendingCategory = null;
  session.lastActivity = Date.now();`,
`  session.ticket = null;
  session.pendingCategory = null;
  session.pendingFreeChatMessage = null;
  session.returnToFreeChat = false;
  session.lastActivity = Date.now();`, 'limpeza do menu principal');

source = replaceOnce(source,
`  if (category.statusLookup) {
    session.step = 'await_protocol';
    await sendText(chatId, 'Informe o protocolo no formato *TI-AAAAMMDD-XXXX*.');
    return;
  }

  session.ticket = makeTicketSession(categoryKey);`,
`  if (category.statusLookup) {
    session.step = 'await_protocol';
    await sendText(chatId, 'Informe o protocolo no formato *TI-AAAAMMDD-XXXX*.');
    return;
  }

  if (category.freeChat) {
    await startFreeChat(chatId, session);
    return;
  }

  session.ticket = makeTicketSession(categoryKey);`, 'tratamento da categoria livre');

source = replaceOnce(source,
`  if (categoryKey === '18') {
    introduction += \`\\n\\nO retorno de \${CONFIG.supportName} acontecerá conforme disponibilidade e prioridade.\`;
  }

`, '', 'introdução antiga da opção 18');

const freeChatFunctions = `

async function startFreeChat(chatId, session) {
  session.step = 'free_chat';
  session.ticket = null;
  session.pendingCategory = null;
  session.pendingFreeChatMessage = null;
  session.returnToFreeChat = false;
  session.lastActivity = Date.now();
  await sendText(chatId, \`👨‍💻 *Atendimento direto com \${CONFIG.supportName}*\\n\\nPode enviar sua mensagem normalmente. O chatbot não fará as 3 perguntas enquanto você estiver neste modo.\\n\\nSe a mensagem indicar uma solicitação de TI relacionada às opções *1 a 16*, eu perguntarei se você deseja transformá-la em chamado.\\n\\n_Comandos: menu, voltar, cancelar e status._\`);
}

async function processFreeChat(chatId, session, bodyOriginal, message) {
  if (!bodyOriginal && message?.hasMedia) return;
  const detected = detectSupportCategory(bodyOriginal);
  if (!detected) return;
  session.pendingCategory = detected.categoryKey;
  session.pendingFreeChatMessage = bodyOriginal;
  session.step = 'free_chat_confirm';
  const category = CATEGORIES[detected.categoryKey];
  await sendText(chatId, \`🔎 Parece que sua mensagem está relacionada a *\${category.title}*.\\n\\nDeseja transformar isso em um chamado de suporte?\\n\\n*1* - Sim, abrir chamado\\n*2* - Não, continuar falando com \${CONFIG.supportName}\`);
}

async function processFreeChatConfirmation(chatId, session, body) {
  const normalized = normalizeText(body);
  if (['1', 'sim', 's', 'abrir', 'chamado'].includes(normalized)) {
    const categoryKey = session.pendingCategory;
    session.pendingCategory = null;
    session.pendingFreeChatMessage = null;
    session.returnToFreeChat = true;
    if (!categoryKey || !CATEGORIES[categoryKey] || CATEGORIES[categoryKey].statusLookup || CATEGORIES[categoryKey].freeChat) {
      await startFreeChat(chatId, session);
      return;
    }
    await startCategory(chatId, session, categoryKey);
    return;
  }
  if (['2', 'nao', 'n', 'continuar'].includes(normalized)) {
    session.pendingCategory = null;
    session.pendingFreeChatMessage = null;
    session.step = 'free_chat';
    await sendText(chatId, \`Certo. Continuamos no atendimento direto com *\${CONFIG.supportName}*. Pode escrever normalmente.\`);
    return;
  }
  await sendText(chatId, \`Digite *1* para abrir o chamado ou *2* para continuar falando com \${CONFIG.supportName}.\`);
}
`;

source = replaceOnce(source, '\nasync function processIdentity(chatId, session, body) {', freeChatFunctions + '\nasync function processIdentity(chatId, session, body) {', 'funções do atendimento livre');

source = replaceOnce(source,
`  await sendText(chatId, finalMessage);
  session.ticket = null;
  session.step = 'menu';
  await sendText(chatId, 'Para registrar outra solicitação, envie *menu*. Para encerrar, envie *0*.');`,
`  await sendText(chatId, finalMessage);
  const returnToFreeChat = session.returnToFreeChat;
  session.ticket = null;
  session.returnToFreeChat = false;
  if (returnToFreeChat) {
    session.step = 'free_chat';
    await sendText(chatId, \`Você continua no atendimento direto com *\${CONFIG.supportName}*. Pode enviar outra mensagem normalmente.\`);
    return;
  }
  session.step = 'menu';
  await sendText(chatId, 'Para registrar outra solicitação, envie *menu*. Para encerrar, envie *0*.');`, 'retorno ao atendimento livre após chamado');

source = replaceOnce(source,
`async function goBack(chatId, session) {
  if (session.step === 'question_details' && session.ticket) {`,
`async function goBack(chatId, session) {
  if (session.step === 'free_chat_confirm') {
    session.pendingCategory = null;
    session.pendingFreeChatMessage = null;
    session.step = 'free_chat';
    await sendText(chatId, \`Continuamos no atendimento direto com *\${CONFIG.supportName}*.\`);
    return;
  }
  if (session.step === 'free_chat') {
    await showMainMenu(chatId, session);
    return;
  }
  if (session.step === 'question_details' && session.ticket) {`, 'voltar no atendimento livre');

source = replaceOnce(source,
`  if (body === 'atendente') {
    await startCategory(chatId, session, '18');
    return;
  }`,
`  if (body === 'atendente') {
    await startFreeChat(chatId, session);
    return;
  }`, 'comando atendente');

source = replaceOnce(source,
`    case 'menu':
      await startCategory(chatId, session, bodyOriginal);
      break;
    case 'question_identity':`,
`    case 'menu':
      await startCategory(chatId, session, bodyOriginal);
      break;
    case 'free_chat':
      await processFreeChat(chatId, session, bodyOriginal, message);
      break;
    case 'free_chat_confirm':
      await processFreeChatConfirmation(chatId, session, bodyOriginal);
      break;
    case 'question_identity':`, 'novos estados do atendimento livre');

fs.writeFileSync(TARGET, source, 'utf8');
console.log('[OK] Atualização v1.8.0 aplicada.');
