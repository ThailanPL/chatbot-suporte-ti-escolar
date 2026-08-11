'use strict';

// Lê somente as colunas Protocolo e Status da aba "Chamados".
// Não depende do Microsoft Excel nem de pacotes adicionais do npm.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  EXCEL_PATH,
  findTicket,
  updateTicketStatus,
  isClosedStatus,
} = require('./database');

let watcherStarted = false;
let debounceTimer = null;
let retryTimer = null;
let syncing = false;
let lastProcessedMtime = 0;

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)));
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054B50) return offset;
  }
  throw new Error('O arquivo não possui uma estrutura XLSX/ZIP válida.');
}

function readZipEntries(filePath) {
  const buffer = fs.readFileSync(filePath);
  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014B50) {
      throw new Error('A lista interna do arquivo XLSX está corrompida.');
    }

    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString('utf8');

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034B50) {
      throw new Error(`Entrada inválida dentro do arquivo XLSX: ${name}`);
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let content;

    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) content = zlib.inflateRawSync(compressed);
    else throw new Error(`Método de compactação não suportado no XLSX: ${method}`);

    entries.set(name.replace(/\\/g, '/'), content);
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function getEntryText(entries, name, required = true) {
  const entry = entries.get(name);
  if (!entry) {
    if (required) throw new Error(`Arquivo interno não encontrado no XLSX: ${name}`);
    return '';
  }
  return entry.toString('utf8');
}

function extractAttribute(attributes, name) {
  const match = String(attributes || '').match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function resolveWorksheetPath(entries, sheetName) {
  const workbookXml = getEntryText(entries, 'xl/workbook.xml');
  const relationshipsXml = getEntryText(entries, 'xl/_rels/workbook.xml.rels');
  const sheetRegex = /<(?:\w+:)?sheet\b([^>]*)\/?\s*>/gi;
  let relationshipId = '';
  let match;

  while ((match = sheetRegex.exec(workbookXml))) {
    const attributes = match[1];
    const name = extractAttribute(attributes, 'name');
    if (normalizeHeader(name) === normalizeHeader(sheetName)) {
      relationshipId = extractAttribute(attributes, 'r:id');
      break;
    }
  }

  if (!relationshipId) throw new Error(`A aba “${sheetName}” não foi encontrada na planilha.`);

  const relationRegex = /<(?:\w+:)?Relationship\b([^>]*)\/?\s*>/gi;
  let target = '';
  while ((match = relationRegex.exec(relationshipsXml))) {
    const attributes = match[1];
    if (extractAttribute(attributes, 'Id') === relationshipId) {
      target = extractAttribute(attributes, 'Target');
      break;
    }
  }

  if (!target) throw new Error(`Não foi possível localizar os dados da aba “${sheetName}”.`);
  if (target.startsWith('/')) return target.replace(/^\//, '');
  return path.posix.normalize(path.posix.join('xl', target));
}

function parseSharedStrings(entries) {
  const xml = getEntryText(entries, 'xl/sharedStrings.xml', false);
  if (!xml) return [];
  const values = [];
  const itemRegex = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml))) {
    const texts = [];
    const textRegex = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi;
    let textMatch;
    while ((textMatch = textRegex.exec(itemMatch[1]))) texts.push(decodeXml(textMatch[1]));
    values.push(texts.join(''));
  }
  return values;
}

function cellColumn(reference) {
  const match = String(reference || '').match(/^([A-Z]+)/i);
  if (!match) return 0;
  let value = 0;
  for (const char of match[1].toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64;
  return value;
}

function extractTextTags(xml) {
  const parts = [];
  const regex = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi;
  let match;
  while ((match = regex.exec(xml))) parts.push(decodeXml(match[1]));
  return parts.join('');
}

function parseCellValue(attributes, body, sharedStrings) {
  const type = extractAttribute(attributes, 't');
  if (type === 'inlineStr') return extractTextTags(body);

  const valueMatch = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i);
  const rawValue = valueMatch ? decodeXml(valueMatch[1]) : '';
  if (type === 's') return sharedStrings[Number(rawValue)] ?? '';
  if (type === 'str') return rawValue;
  if (type === 'b') return rawValue === '1' ? 'TRUE' : 'FALSE';
  return rawValue || extractTextTags(body);
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  const rowRegex = /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(xml))) {
    const rowNumber = Number(extractAttribute(rowMatch[1], 'r')) || rows.length + 1;
    const cells = new Map();
    const cellRegex = /<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>|<(?:\w+:)?c\b([^>]*)\/>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[2]))) {
      const attributes = cellMatch[1] || cellMatch[3] || '';
      const body = cellMatch[2] || '';
      const reference = extractAttribute(attributes, 'r');
      const column = cellColumn(reference);
      if (column > 0) cells.set(column, parseCellValue(attributes, body, sharedStrings));
    }
    rows.push({ rowNumber, cells });
  }

  return rows;
}

function readTicketStatusesFromExcel(filePath = EXCEL_PATH) {
  const entries = readZipEntries(filePath);
  const worksheetPath = resolveWorksheetPath(entries, 'Chamados');
  const sheetXml = getEntryText(entries, worksheetPath);
  const sharedStrings = parseSharedStrings(entries);
  const rows = parseWorksheetRows(sheetXml, sharedStrings);
  if (!rows.length) return [];

  const headerRow = rows[0];
  let protocolColumn = 0;
  let statusColumn = 0;
  for (const [column, value] of headerRow.cells.entries()) {
    const header = normalizeHeader(value);
    if (header === 'protocolo') protocolColumn = column;
    if (header === 'status') statusColumn = column;
  }

  if (!protocolColumn || !statusColumn) {
    throw new Error('As colunas “Protocolo” e “Status” não foram encontradas na aba Chamados.');
  }

  return rows.slice(1).map((row) => ({
    row: row.rowNumber,
    protocolo: String(row.cells.get(protocolColumn) || '').trim().toUpperCase(),
    status: String(row.cells.get(statusColumn) || '').trim(),
  })).filter((item) => item.protocolo);
}

async function syncExcelClosureStatuses() {
  if (syncing || !fs.existsSync(EXCEL_PATH)) return { updated: 0, ignored: 0 };
  syncing = true;
  try {
    const records = readTicketStatusesFromExcel(EXCEL_PATH);
    let updated = 0;
    let ignored = 0;

    for (const record of records) {
      // Somente “Encerrado” é importado do Excel. Os demais campos continuam protegidos pelo banco.
      if (!isClosedStatus(record.status)) continue;
      const ticket = findTicket(record.protocolo);
      if (!ticket) {
        ignored += 1;
        continue;
      }
      if (isClosedStatus(ticket.status)) continue;

      const result = updateTicketStatus(
        ticket.protocolo,
        'Encerrado',
        'Status alterado para Encerrado na aba Chamados da planilha Excel.',
        { origin: 'Planilha Excel', notify: true },
      );
      if (result) {
        updated += 1;
        console.log(`[EXCEL] ${ticket.protocolo} marcado como Encerrado. Notificação adicionada à fila.`);
      }
    }

    if (updated > 0) console.log(`[OK] ${updated} encerramento(s) importado(s) da planilha Excel.`);
    return { updated, ignored };
  } finally {
    syncing = false;
  }
}

function scheduleSync(delay = 1800) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    try {
      const stat = fs.statSync(EXCEL_PATH);
      if (stat.mtimeMs === lastProcessedMtime) return;
      await syncExcelClosureStatuses();
      lastProcessedMtime = stat.mtimeMs;
    } catch (error) {
      console.warn(`[AVISO] Ainda não foi possível ler a planilha: ${error.message}`);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        scheduleSync(500);
      }, 5000);
      retryTimer.unref();
    }
  }, delay);
  debounceTimer.unref();
}

function startExcelStatusWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;

  try {
    if (fs.existsSync(EXCEL_PATH)) lastProcessedMtime = fs.statSync(EXCEL_PATH).mtimeMs;
  } catch {
    lastProcessedMtime = 0;
  }

  fs.watchFile(EXCEL_PATH, { interval: 2500 }, (current, previous) => {
    if (current.mtimeMs && current.mtimeMs !== previous.mtimeMs) scheduleSync();
  });

  console.log('[OK] Monitor da planilha ativo: alterações para “Encerrado” serão importadas.');
}

function stopExcelStatusWatcher() {
  if (!watcherStarted) return;
  fs.unwatchFile(EXCEL_PATH);
  watcherStarted = false;
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  debounceTimer = null;
  retryTimer = null;
}

module.exports = {
  readTicketStatusesFromExcel,
  syncExcelClosureStatuses,
  startExcelStatusWatcher,
  stopExcelStatusWatcher,
};
