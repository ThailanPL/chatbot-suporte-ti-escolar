'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const {
  EXCEL_PATH,
  EXCEL_BACKUP_PATH,
  EXCEL_PENDING_PATH,
  writeExcelReport,
} = require('./excel-report');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'chamados.sqlite');
const JSON_EXPORT_PATH = path.join(DATA_DIR, 'chamados.json');
const JSON_BACKUP_PATH = path.join(DATA_DIR, 'chamados.backup.json');

let database = null;
let excelExportChain = Promise.resolve();
let excelRetryTimer = null;

const PRIORITY_ORDER = {
  Baixa: 1,
  Média: 2,
  Alta: 3,
  Crítica: 4,
};

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function priorityFromImpact(impact) {
  const text = String(impact || '').toLowerCase();
  if (text.includes('crít') || text.includes('crit')) return 'Crítica';
  if (text.includes('alto') || text.includes('alta')) return 'Alta';
  if (text.includes('médio') || text.includes('medio') || text.includes('média')) return 'Média';
  return 'Baixa';
}

function normalizeStatus(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isClosedStatus(value) {
  return normalizeStatus(value) === 'encerrado';
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || '');
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: process.env.TIMEZONE || 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function normalizeTicketRow(row) {
  if (!row) return null;

  return {
    protocolo: row.protocolo,
    dataHora: row.data_hora,
    dataHoraFormatada: row.data_hora_formatada,
    nome: row.nome,
    numeroWhatsApp: row.numero_whatsapp,
    chatId: row.chat_id || '',
    setor: row.setor,
    local: row.local,
    descricaoInicial: row.descricao,
    categoria: row.categoria,
    categoriaCodigo: row.categoria_codigo,
    nivelImpacto: row.nivel_impacto,
    prioridade: row.prioridade,
    prioridadeOrdem: row.prioridade_ordem,
    foraDoHorario: Boolean(row.fora_horario),
    urgenteInformadoForaDoHorario: Boolean(row.urgente_fora_horario),
    status: row.status,
    ultimaAtualizacao: row.ultima_atualizacao,
    dadosSolicitacao: safeJsonParse(row.dados_json, {}),
    encerramentoNotificado: Boolean(row.encerramento_notificado),
    encerramentoNotificadoEm: row.encerramento_notificado_em || '',
    encerramentoOrigem: row.encerramento_origem || '',
    erroNotificacao: row.erro_notificacao || '',
  };
}

function ensureDatabase() {
  if (!database) throw new Error('O banco de dados ainda não foi inicializado.');
  return database;
}

function ensureColumn(tableName, columnName, definition) {
  const db = ensureDatabase();
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function createExcelSnapshot() {
  const db = ensureDatabase();
  const tickets = db.prepare(`
    SELECT *
    FROM chamados
    ORDER BY prioridade_ordem DESC, data_hora ASC
  `).all().map(normalizeTicketRow);

  const history = db.prepare(`
    SELECT protocolo, data_hora AS dataHora, status, observacao
    FROM historico
    ORDER BY data_hora ASC, id ASC
  `).all();

  const responses = db.prepare(`
    SELECT protocolo, ordem, campo, pergunta, resposta
    FROM respostas
    ORDER BY protocolo ASC, ordem ASC, id ASC
  `).all();

  return { tickets, history, responses };
}

function scheduleExcelRetry() {
  if (excelRetryTimer) return;
  excelRetryTimer = setTimeout(() => {
    excelRetryTimer = null;
    queueExcelExport('nova tentativa após o fechamento da planilha');
  }, 30 * 1000);
  excelRetryTimer.unref();
}

function queueExcelExport(reason = 'atualização automática') {
  let snapshot;
  try {
    snapshot = createExcelSnapshot();
  } catch (error) {
    console.error(`[ERRO] Não foi possível preparar a planilha Excel: ${error.message}`);
    return Promise.resolve({ ok: false, error });
  }

  excelExportChain = excelExportChain
    .catch(() => undefined)
    .then(async () => {
      const result = await writeExcelReport(snapshot);
      if (result.locked) {
        console.warn('[AVISO] A planilha data\\chamados.xlsx está aberta no Excel.');
        console.warn('[AVISO] A atualização ficou pendente e será tentada novamente automaticamente.');
        scheduleExcelRetry();
      } else {
        console.log(`[OK] Planilha Excel atualizada (${reason}): ${EXCEL_PATH}`);
      }
      return result;
    })
    .catch((error) => {
      console.error(`[ERRO] Falha ao atualizar a planilha Excel: ${error.message}`);
      return { ok: false, error };
    });

  return excelExportChain;
}

function exportTicketsToExcel() {
  return queueExcelExport('sincronização manual');
}

function waitForExcelExport() {
  return excelExportChain.catch(() => undefined);
}

function initDatabase() {
  if (database) return database;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  database = new DatabaseSync(DB_PATH);

  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS chamados (
      protocolo TEXT PRIMARY KEY,
      data_hora TEXT NOT NULL,
      data_hora_formatada TEXT,
      nome TEXT NOT NULL,
      numero_whatsapp TEXT NOT NULL,
      setor TEXT,
      local TEXT,
      descricao TEXT,
      categoria TEXT NOT NULL,
      categoria_codigo TEXT,
      nivel_impacto TEXT NOT NULL,
      prioridade TEXT NOT NULL CHECK (prioridade IN ('Baixa', 'Média', 'Alta', 'Crítica')),
      prioridade_ordem INTEGER NOT NULL CHECK (prioridade_ordem BETWEEN 1 AND 4),
      fora_horario INTEGER NOT NULL DEFAULT 0,
      urgente_fora_horario INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      ultima_atualizacao TEXT NOT NULL,
      dados_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;

    CREATE TABLE IF NOT EXISTS respostas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      protocolo TEXT NOT NULL,
      ordem INTEGER NOT NULL,
      campo TEXT,
      pergunta TEXT NOT NULL,
      resposta TEXT NOT NULL,
      FOREIGN KEY (protocolo) REFERENCES chamados(protocolo) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      protocolo TEXT NOT NULL,
      data_hora TEXT NOT NULL,
      status TEXT NOT NULL,
      observacao TEXT,
      FOREIGN KEY (protocolo) REFERENCES chamados(protocolo) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS notificacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      protocolo TEXT NOT NULL,
      tipo TEXT NOT NULL,
      destino TEXT NOT NULL,
      numero_whatsapp TEXT,
      mensagem TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pendente',
      tentativas INTEGER NOT NULL DEFAULT 0,
      criada_em TEXT NOT NULL,
      ultima_tentativa_em TEXT,
      enviada_em TEXT,
      ultimo_erro TEXT,
      UNIQUE (protocolo, tipo),
      FOREIGN KEY (protocolo) REFERENCES chamados(protocolo) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_chamados_prioridade
      ON chamados(prioridade_ordem DESC, data_hora ASC);
    CREATE INDEX IF NOT EXISTS idx_chamados_status
      ON chamados(status, prioridade_ordem DESC, data_hora ASC);
    CREATE INDEX IF NOT EXISTS idx_chamados_categoria
      ON chamados(categoria, data_hora DESC);
    CREATE INDEX IF NOT EXISTS idx_respostas_protocolo
      ON respostas(protocolo, ordem);
    CREATE INDEX IF NOT EXISTS idx_historico_protocolo
      ON historico(protocolo, data_hora);
    CREATE INDEX IF NOT EXISTS idx_notificacoes_pendentes
      ON notificacoes(status, tentativas, criada_em);
  `);

  // Migração automática da versão 1.4 sem apagar registros existentes.
  ensureColumn('chamados', 'chat_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('chamados', 'encerramento_notificado', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('chamados', 'encerramento_notificado_em', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('chamados', 'encerramento_origem', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('chamados', 'erro_notificacao', "TEXT NOT NULL DEFAULT ''");

  migrateLegacyJsonIfNeeded();
  exportTicketsToJson();
  queueExcelExport('inicialização do banco');
  return database;
}

function protocolExists(protocol) {
  const db = ensureDatabase();
  return Boolean(db.prepare('SELECT 1 AS existe FROM chamados WHERE protocolo = ? LIMIT 1').get(protocol));
}

function insertTicketInternal(record) {
  const db = ensureDatabase();
  const priority = record.prioridade || priorityFromImpact(record.nivelImpacto);
  const priorityOrder = PRIORITY_ORDER[priority] || 1;

  db.prepare(`
    INSERT OR IGNORE INTO chamados (
      protocolo, data_hora, data_hora_formatada, nome, numero_whatsapp, chat_id,
      setor, local, descricao, categoria, categoria_codigo,
      nivel_impacto, prioridade, prioridade_ordem, fora_horario,
      urgente_fora_horario, status, ultima_atualizacao, dados_json,
      encerramento_notificado, encerramento_notificado_em, encerramento_origem, erro_notificacao
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.protocolo,
    record.dataHora,
    record.dataHoraFormatada || '',
    record.nome || 'Não informado',
    record.numeroWhatsApp || 'Não informado',
    record.chatId || '',
    record.setor || 'Não informado',
    record.local || 'Não informado',
    record.descricaoInicial || '',
    record.categoria || 'Outro problema',
    record.categoriaCodigo || '',
    record.nivelImpacto || 'Baixo — apenas uma pessoa',
    priority,
    priorityOrder,
    record.foraDoHorario ? 1 : 0,
    record.urgenteInformadoForaDoHorario ? 1 : 0,
    record.status || 'Recebido',
    record.ultimaAtualizacao || record.dataHora,
    JSON.stringify(record.dadosSolicitacao || {}),
    record.encerramentoNotificado ? 1 : 0,
    record.encerramentoNotificadoEm || '',
    record.encerramentoOrigem || '',
    record.erroNotificacao || '',
  );

  const responseInsert = db.prepare(`
    INSERT INTO respostas (protocolo, ordem, campo, pergunta, resposta)
    VALUES (?, ?, ?, ?, ?)
  `);
  const existingResponses = db.prepare('SELECT COUNT(*) AS total FROM respostas WHERE protocolo = ?').get(record.protocolo).total;
  if (Number(existingResponses) === 0) {
    (record.respostas || []).forEach((item, index) => {
      responseInsert.run(record.protocolo, index + 1, item.campo || '', item.pergunta || '', item.resposta || '');
    });
  }

  const historyInsert = db.prepare(`
    INSERT INTO historico (protocolo, data_hora, status, observacao)
    VALUES (?, ?, ?, ?)
  `);
  const existingHistory = db.prepare('SELECT COUNT(*) AS total FROM historico WHERE protocolo = ?').get(record.protocolo).total;
  if (Number(existingHistory) === 0) {
    const history = Array.isArray(record.historico) && record.historico.length
      ? record.historico
      : [{ dataHora: record.dataHora, status: record.status || 'Recebido', observacao: 'Chamado criado automaticamente pelo bot.' }];
    history.forEach((item) => {
      historyInsert.run(record.protocolo, item.dataHora || record.dataHora, item.status || record.status || 'Recebido', item.observacao || '');
    });
  }
}

function insertTicket(record) {
  const db = ensureDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    insertTicketInternal(record);
    db.exec('COMMIT');
    exportTicketsToJson();
    queueExcelExport('novo chamado');
    return findTicket(record.protocolo);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function findTicket(protocol) {
  const db = ensureDatabase();
  const normalized = String(protocol || '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM chamados WHERE UPPER(protocolo) = ?').get(normalized);
  if (!row) return null;

  const ticket = normalizeTicketRow(row);
  ticket.respostas = db.prepare(`
    SELECT campo, pergunta, resposta
    FROM respostas
    WHERE protocolo = ?
    ORDER BY ordem ASC, id ASC
  `).all(row.protocolo);
  ticket.historico = db.prepare(`
    SELECT data_hora AS dataHora, status, observacao
    FROM historico
    WHERE protocolo = ?
    ORDER BY data_hora ASC, id ASC
  `).all(row.protocolo);
  return ticket;
}

function listTickets(options = {}) {
  const db = ensureDatabase();
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 500));
  const status = String(options.status || '').trim();
  const orderByUrgency = options.orderByUrgency !== false;

  let sql = 'SELECT * FROM chamados';
  const parameters = [];
  if (status) {
    sql += ' WHERE status = ?';
    parameters.push(status);
  }
  sql += orderByUrgency ? ' ORDER BY prioridade_ordem DESC, data_hora ASC' : ' ORDER BY data_hora DESC';
  sql += ' LIMIT ?';
  parameters.push(limit);
  return db.prepare(sql).all(...parameters).map(normalizeTicketRow);
}

function countTickets() {
  const db = ensureDatabase();
  return Number(db.prepare('SELECT COUNT(*) AS total FROM chamados').get().total);
}

function getStatistics() {
  const db = ensureDatabase();
  const byPriority = db.prepare(`
    SELECT prioridade, prioridade_ordem, COUNT(*) AS total
    FROM chamados
    GROUP BY prioridade, prioridade_ordem
    ORDER BY prioridade_ordem DESC
  `).all();
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS total
    FROM chamados
    GROUP BY status
    ORDER BY total DESC, status ASC
  `).all();
  return {
    total: countTickets(),
    byPriority: byPriority.map((row) => ({ ...row, total: Number(row.total) })),
    byStatus: byStatus.map((row) => ({ ...row, total: Number(row.total) })),
  };
}

function buildClosureMessage(ticket, closedAt) {
  return `✅ *Chamado encerrado*\n\nOlá, *${ticket.nome || 'colaborador(a)'}*!\n\nSeu chamado foi encerrado pelo *Suporte TI*.\n\n*Protocolo:* ${ticket.protocolo}\n*Categoria:* ${ticket.categoria}\n*Status:* Encerrado\n*Encerrado em:* ${formatDate(closedAt)}\n\nCaso o problema continue, envie *menu* para registrar uma nova solicitação e informe o protocolo anterior.`;
}

function queueClosureNotificationInternal(db, ticket, origin, closedAt) {
  const destination = ticket.chatId || ticket.numeroWhatsApp || '';
  const message = buildClosureMessage(ticket, closedAt);
  db.prepare(`
    INSERT INTO notificacoes (
      protocolo, tipo, destino, numero_whatsapp, mensagem, status,
      tentativas, criada_em, ultima_tentativa_em, enviada_em, ultimo_erro
    ) VALUES (?, 'ENCERRAMENTO', ?, ?, ?, 'Pendente', 0, ?, '', '', '')
    ON CONFLICT(protocolo, tipo) DO UPDATE SET
      destino = excluded.destino,
      numero_whatsapp = excluded.numero_whatsapp,
      mensagem = excluded.mensagem,
      status = CASE WHEN notificacoes.status = 'Enviada' THEN 'Enviada' ELSE 'Pendente' END,
      tentativas = CASE WHEN notificacoes.status = 'Enviada' THEN notificacoes.tentativas ELSE 0 END,
      criada_em = CASE WHEN notificacoes.status = 'Enviada' THEN notificacoes.criada_em ELSE excluded.criada_em END,
      ultima_tentativa_em = CASE WHEN notificacoes.status = 'Enviada' THEN notificacoes.ultima_tentativa_em ELSE '' END,
      ultimo_erro = CASE WHEN notificacoes.status = 'Enviada' THEN notificacoes.ultimo_erro ELSE '' END
  `).run(ticket.protocolo, destination, ticket.numeroWhatsApp || '', message, closedAt);

  db.prepare(`
    UPDATE chamados
    SET encerramento_origem = ?, erro_notificacao = ''
    WHERE protocolo = ?
  `).run(origin || 'Atualização de status', ticket.protocolo);
}

function updateTicketStatus(protocol, newStatus, observation = '', options = {}) {
  const db = ensureDatabase();
  const normalized = String(protocol || '').trim().toUpperCase();
  const status = String(newStatus || '').trim();
  const now = new Date().toISOString();
  const origin = String(options.origin || 'Gerenciador local');
  const shouldNotify = options.notify !== false;

  db.exec('BEGIN IMMEDIATE');
  try {
    const previousRow = db.prepare('SELECT * FROM chamados WHERE UPPER(protocolo) = ?').get(normalized);
    if (!previousRow) {
      db.exec('ROLLBACK');
      return null;
    }

    const previousStatus = previousRow.status;
    if (previousStatus === status) {
      db.exec('COMMIT');
      return findTicket(previousRow.protocolo);
    }

    db.prepare(`
      UPDATE chamados
      SET status = ?, ultima_atualizacao = ?
      WHERE protocolo = ?
    `).run(status, now, previousRow.protocolo);

    db.prepare(`
      INSERT INTO historico (protocolo, data_hora, status, observacao)
      VALUES (?, ?, ?, ?)
    `).run(
      previousRow.protocolo,
      now,
      status,
      observation || `Status atualizado por ${origin}.`,
    );

    if (isClosedStatus(status)) {
      const updatedTicket = normalizeTicketRow({ ...previousRow, status, ultima_atualizacao: now });
      if (shouldNotify) queueClosureNotificationInternal(db, updatedTicket, origin, now);
    } else if (isClosedStatus(previousStatus)) {
      db.prepare(`
        UPDATE notificacoes
        SET status = CASE WHEN status = 'Enviada' THEN status ELSE 'Cancelada' END
        WHERE protocolo = ? AND tipo = 'ENCERRAMENTO'
      `).run(previousRow.protocolo);
      db.prepare(`
        UPDATE chamados
        SET encerramento_notificado = 0,
            encerramento_notificado_em = '',
            encerramento_origem = '',
            erro_notificacao = ''
        WHERE protocolo = ?
      `).run(previousRow.protocolo);
    }

    db.exec('COMMIT');
    exportTicketsToJson();
    queueExcelExport('alteração de status');
    return findTicket(previousRow.protocolo);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getPendingNotifications(limit = 20) {
  const db = ensureDatabase();
  const safeLimit = Math.max(1, Math.min(Number(limit || 20), 100));
  return db.prepare(`
    SELECT n.*, c.nome, c.categoria, c.chat_id, c.numero_whatsapp AS telefone_chamado
    FROM notificacoes n
    JOIN chamados c ON c.protocolo = n.protocolo
    WHERE n.status = 'Pendente' AND n.tentativas < 20
    ORDER BY n.criada_em ASC, n.id ASC
    LIMIT ?
  `).all(safeLimit);
}

function markNotificationSent(notificationId) {
  const db = ensureDatabase();
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const notification = db.prepare('SELECT * FROM notificacoes WHERE id = ?').get(notificationId);
    if (!notification) {
      db.exec('ROLLBACK');
      return null;
    }
    db.prepare(`
      UPDATE notificacoes
      SET status = 'Enviada', enviada_em = ?, ultima_tentativa_em = ?, ultimo_erro = ''
      WHERE id = ?
    `).run(now, now, notificationId);
    db.prepare(`
      UPDATE chamados
      SET encerramento_notificado = 1,
          encerramento_notificado_em = ?,
          erro_notificacao = ''
      WHERE protocolo = ?
    `).run(now, notification.protocolo);
    db.prepare(`
      INSERT INTO historico (protocolo, data_hora, status, observacao)
      VALUES (?, ?, 'Encerrado', 'Mensagem de encerramento enviada automaticamente ao usuário pelo WhatsApp.')
    `).run(notification.protocolo, now);
    db.exec('COMMIT');
    exportTicketsToJson();
    queueExcelExport('confirmação da notificação de encerramento');
    return notification;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function markNotificationFailed(notificationId, errorMessage) {
  const db = ensureDatabase();
  const now = new Date().toISOString();
  const message = String(errorMessage || 'Falha desconhecida').slice(0, 1000);
  db.exec('BEGIN IMMEDIATE');
  try {
    const notification = db.prepare('SELECT * FROM notificacoes WHERE id = ?').get(notificationId);
    if (!notification) {
      db.exec('ROLLBACK');
      return null;
    }
    const attempts = Number(notification.tentativas || 0) + 1;
    const nextStatus = attempts >= 20 ? 'Falhou' : 'Pendente';
    db.prepare(`
      UPDATE notificacoes
      SET status = ?, tentativas = ?, ultima_tentativa_em = ?, ultimo_erro = ?
      WHERE id = ?
    `).run(nextStatus, attempts, now, message, notificationId);
    db.prepare(`
      UPDATE chamados
      SET erro_notificacao = ?
      WHERE protocolo = ?
    `).run(message, notification.protocolo);
    db.exec('COMMIT');
    if (nextStatus === 'Falhou') queueExcelExport('falha definitiva na notificação');
    return { ...notification, status: nextStatus, tentativas: attempts };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function retryClosureNotification(protocol) {
  const db = ensureDatabase();
  const normalized = String(protocol || '').trim().toUpperCase();
  const result = db.prepare(`
    UPDATE notificacoes
    SET status = 'Pendente', tentativas = 0, ultimo_erro = '', ultima_tentativa_em = ''
    WHERE UPPER(protocolo) = ? AND tipo = 'ENCERRAMENTO' AND status <> 'Enviada'
  `).run(normalized);
  if (Number(result.changes) > 0) {
    db.prepare(`UPDATE chamados SET erro_notificacao = '' WHERE UPPER(protocolo) = ?`).run(normalized);
    queueExcelExport('nova tentativa de notificação');
    return true;
  }
  return false;
}

function exportTicketsToJson() {
  const db = ensureDatabase();
  const rows = db.prepare('SELECT * FROM chamados ORDER BY data_hora ASC').all();
  const tickets = rows.map((row) => {
    const ticket = normalizeTicketRow(row);
    ticket.respostas = db.prepare(`
      SELECT campo, pergunta, resposta
      FROM respostas
      WHERE protocolo = ?
      ORDER BY ordem ASC, id ASC
    `).all(row.protocolo);
    ticket.historico = db.prepare(`
      SELECT data_hora AS dataHora, status, observacao
      FROM historico
      WHERE protocolo = ?
      ORDER BY data_hora ASC, id ASC
    `).all(row.protocolo);
    return ticket;
  });

  if (fs.existsSync(JSON_EXPORT_PATH)) fs.copyFileSync(JSON_EXPORT_PATH, JSON_BACKUP_PATH);
  fs.writeFileSync(JSON_EXPORT_PATH, `${JSON.stringify(tickets, null, 2)}\n`, 'utf8');
  return tickets;
}

function migrateLegacyJsonIfNeeded() {
  const db = ensureDatabase();
  const total = Number(db.prepare('SELECT COUNT(*) AS total FROM chamados').get().total);
  if (total > 0 || !fs.existsSync(JSON_EXPORT_PATH)) return;

  let legacyTickets;
  try {
    const content = fs.readFileSync(JSON_EXPORT_PATH, 'utf8').trim() || '[]';
    legacyTickets = JSON.parse(content);
    if (!Array.isArray(legacyTickets) || legacyTickets.length === 0) return;
  } catch {
    return;
  }

  const migrationBackup = path.join(DATA_DIR, `chamados-antes-sqlite-${Date.now()}.json`);
  fs.copyFileSync(JSON_EXPORT_PATH, migrationBackup);

  db.exec('BEGIN IMMEDIATE');
  try {
    legacyTickets.forEach((record) => insertTicketInternal(record));
    db.exec('COMMIT');
    console.log(`[OK] ${legacyTickets.length} chamado(s) antigo(s) migrado(s) para SQLite.`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function closeDatabase() {
  if (excelRetryTimer) {
    clearTimeout(excelRetryTimer);
    excelRetryTimer = null;
  }
  if (database) {
    database.close();
    database = null;
  }
}

module.exports = {
  DB_PATH,
  EXCEL_PATH,
  EXCEL_BACKUP_PATH,
  EXCEL_PENDING_PATH,
  PRIORITY_ORDER,
  initDatabase,
  closeDatabase,
  protocolExists,
  insertTicket,
  findTicket,
  listTickets,
  countTickets,
  getStatistics,
  updateTicketStatus,
  getPendingNotifications,
  markNotificationSent,
  markNotificationFailed,
  retryClosureNotification,
  exportTicketsToJson,
  exportTicketsToExcel,
  queueExcelExport,
  waitForExcelExport,
  priorityFromImpact,
  isClosedStatus,
};
