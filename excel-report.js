'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA_DIR = path.join(__dirname, 'data');
const EXCEL_PATH = path.join(DATA_DIR, 'chamados.xlsx');
const EXCEL_BACKUP_PATH = path.join(DATA_DIR, 'chamados.backup.xlsx');
const EXCEL_PENDING_PATH = path.join(DATA_DIR, 'chamados-atualizacao-pendente.xlsx');

const PRIORITY_STYLE = { Crítica: 5, Alta: 6, Média: 7, Baixa: 8 };
const STATUS_STYLE = {
  Recebido: 9,
  'Em análise': 10,
  'Aguardando informações': 11,
  'Em atendimento': 12,
  'Aguardando fornecedor': 13,
  Encerrado: 14,
  Concluído: 14, // mantido para chamados antigos
  Cancelado: 15,
};

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let value = index;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cellRef(row, column) {
  return `${columnName(column)}${row}`;
}

function inlineCell(reference, value, style = 0) {
  if (value === null || value === undefined || value === '') return '';
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function numberCell(reference, value, style = 0) {
  return `<c r="${reference}" s="${style}"><v>${Number(value) || 0}</v></c>`;
}

function formulaCell(reference, formula, style = 0, cachedValue = 0) {
  return `<c r="${reference}" s="${style}"><f>${xmlEscape(formula)}</f><v>${cachedValue}</v></c>`;
}

function rowXml(rowNumber, cells, height = null) {
  const attrs = height ? ` r="${rowNumber}" ht="${height}" customHeight="1"` : ` r="${rowNumber}"`;
  return `<row${attrs}>${cells.join('')}</row>`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', {
    timeZone: process.env.TIMEZONE || 'America/Fortaleza',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function worksheetXml({ rows, cols, merges = [], autoFilter = null, freezeHeader = false, showGridLines = true, dataValidations = [] }) {
  const colXml = cols.map((width, index) => (
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  )).join('');

  const pane = freezeHeader
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
    : '<selection activeCell="A1" sqref="A1"/>';

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((range) => `<mergeCell ref="${range}"/>`).join('')}</mergeCells>`
    : '';

  const filterXml = autoFilter ? `<autoFilter ref="${autoFilter}"/>` : '';
  const validationXml = dataValidations.length
    ? `<dataValidations count="${dataValidations.length}">${dataValidations.join('')}</dataValidations>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0" showGridLines="${showGridLines ? 1 : 0}">${pane}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${colXml}</cols>
  <sheetData>${rows.join('')}</sheetData>
  ${filterXml}
  ${mergeXml}
  ${validationXml}
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;
}

function buildSummarySheet(snapshot, generatedAt) {
  const tickets = snapshot.tickets || [];
  const openStatuses = new Set(['Recebido', 'Em análise', 'Aguardando informações', 'Em atendimento', 'Aguardando fornecedor']);
  const totalTickets = tickets.length;
  const openTickets = tickets.filter((ticket) => openStatuses.has(ticket.status)).length;
  const criticalTickets = tickets.filter((ticket) => ticket.prioridade === 'Crítica').length;
  const rows = [];
  rows.push(rowXml(1, [inlineCell('A1', 'CHAMADOS — SUPORTE TI', 1)], 28));
  rows.push(rowXml(2, [], 28));
  rows.push(rowXml(3, [inlineCell('A3', `Atualização automática: ${formatDate(generatedAt)}`, 2)]));
  rows.push(rowXml(4, []));
  rows.push(rowXml(5, [
    inlineCell('A5', 'Total de chamados', 16),
    inlineCell('C5', 'Em aberto', 18),
    inlineCell('E5', 'Críticos', 20),
  ], 22));
  rows.push(rowXml(6, [
    formulaCell('A6', 'MAX(COUNTA(Chamados!A:A)-1,0)', 17, totalTickets),
    formulaCell('C6', 'COUNTIF(Chamados!K:K,"Recebido")+COUNTIF(Chamados!K:K,"Em análise")+COUNTIF(Chamados!K:K,"Aguardando informações")+COUNTIF(Chamados!K:K,"Em atendimento")+COUNTIF(Chamados!K:K,"Aguardando fornecedor")', 19, openTickets),
    formulaCell('E6', 'COUNTIF(Chamados!I:I,"Crítica")', 21, criticalTickets),
  ], 30));
  rows.push(rowXml(7, [], 30));
  rows.push(rowXml(8, []));
  rows.push(rowXml(9, []));
  rows.push(rowXml(10, [inlineCell('A10', 'Por urgência', 23), inlineCell('D10', 'Por status', 23)]));
  rows.push(rowXml(11, [inlineCell('A11', 'Urgência', 3), inlineCell('B11', 'Quantidade', 3), inlineCell('D11', 'Status', 3), inlineCell('E11', 'Quantidade', 3)], 24));

  const priorities = ['Crítica', 'Alta', 'Média', 'Baixa'];
  const statuses = ['Recebido', 'Em análise', 'Aguardando informações', 'Em atendimento', 'Aguardando fornecedor', 'Encerrado', 'Cancelado', 'Concluído'];
  for (let index = 0; index < statuses.length; index += 1) {
    const row = 12 + index;
    const cells = [];
    if (priorities[index]) {
      cells.push(inlineCell(`A${row}`, priorities[index], PRIORITY_STYLE[priorities[index]]));
      cells.push(formulaCell(`B${row}`, `COUNTIF(Chamados!I:I,A${row})`, 4, tickets.filter((ticket) => ticket.prioridade === priorities[index]).length));
    }
    cells.push(inlineCell(`D${row}`, statuses[index], STATUS_STYLE[statuses[index]] || 4));
    cells.push(formulaCell(`E${row}`, `COUNTIF(Chamados!K:K,D${row})`, 4, tickets.filter((ticket) => ticket.status === statuses[index]).length));
    rows.push(rowXml(row, cells));
  }
  rows.push(rowXml(20, []));
  rows.push(rowXml(21, [inlineCell('A21', 'COMO ENCERRAR: na aba Chamados, altere somente a coluna Status para Encerrado e salve o arquivo. O bot atualizará o banco e enviará uma mensagem automática ao usuário. Mantenha o bot em execução.', 22)], 25));
  rows.push(rowXml(22, [], 25));
  rows.push(rowXml(23, [], 25));

  return worksheetXml({
    rows,
    cols: [22, 14, 22, 24, 16, 14],
    merges: ['A1:F2', 'A3:F3', 'A5:B5', 'C5:D5', 'E5:F5', 'A6:B7', 'C6:D7', 'E6:F7', 'A21:F23'],
    showGridLines: false,
  });
}

function buildTableSheet(headers, dataRows, widths, styleResolver, autoFilterRange, dataValidations = []) {
  const rows = [rowXml(1, headers.map((header, index) => inlineCell(cellRef(1, index + 1), header, 3)), 26)];
  dataRows.forEach((values, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const cells = values.map((value, columnIndex) => {
      const style = styleResolver ? styleResolver(value, columnIndex, values) : 4;
      return inlineCell(cellRef(rowNumber, columnIndex + 1), value, style);
    });
    rows.push(rowXml(rowNumber, cells));
  });
  return worksheetXml({
    rows,
    cols: widths,
    autoFilter: autoFilterRange,
    freezeHeader: true,
    dataValidations,
  });
}

function buildTicketsSheet(tickets) {
  const headers = [
    'Protocolo', 'Data de abertura', 'Nome', 'WhatsApp', 'Setor', 'Local',
    'Categoria', 'Descrição', 'Urgência', 'Impacto', 'Status', 'Fora do horário?',
    'Última atualização', 'Notificação ao usuário', 'Notificado em', 'Origem do encerramento',
  ];
  const dataRows = tickets.map((ticket) => {
    let notification = '';
    if (String(ticket.status || '').toLowerCase() === 'encerrado') {
      if (ticket.encerramentoNotificado) notification = 'Enviada';
      else if (ticket.erroNotificacao) notification = 'Pendente — verificar log';
      else notification = 'Pendente';
    }
    return [
      ticket.protocolo,
      formatDate(ticket.dataHora),
      ticket.nome,
      ticket.numeroWhatsApp,
      ticket.setor,
      ticket.local,
      ticket.categoria,
      ticket.descricaoInicial,
      ticket.prioridade,
      ticket.nivelImpacto,
      ticket.status,
      ticket.foraDoHorario ? 'Sim' : 'Não',
      formatDate(ticket.ultimaAtualizacao),
      notification,
      formatDate(ticket.encerramentoNotificadoEm),
      ticket.encerramentoOrigem || '',
    ];
  });
  const allowedStatuses = 'Recebido,Em análise,Aguardando informações,Em atendimento,Aguardando fornecedor,Encerrado,Cancelado';
  const statusValidation = `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Status inválido" error="Escolha um status da lista." promptTitle="Encerrar e avisar" prompt="Selecione Encerrado e salve para avisar o usuário." sqref="K2:K5000"><formula1>"${xmlEscape(allowedStatuses)}"</formula1></dataValidation>`;
  return buildTableSheet(
    headers,
    dataRows,
    [22, 19, 24, 18, 20, 20, 30, 48, 12, 38, 24, 17, 20, 23, 20, 24],
    (value, columnIndex) => {
      if (columnIndex === 8) return PRIORITY_STYLE[value] || 4;
      if (columnIndex === 10) return STATUS_STYLE[value] || 4;
      return 4;
    },
    `A1:P${Math.max(1, dataRows.length + 1)}`,
    [statusValidation],
  );
}

function buildHistorySheet(history) {
  const headers = ['Protocolo', 'Data e hora', 'Status', 'Observação'];
  const rows = history.map((item) => [item.protocolo, formatDate(item.dataHora), item.status, item.observacao || '']);
  return buildTableSheet(headers, rows, [22, 20, 26, 70], (value, columnIndex) => (
    columnIndex === 2 ? STATUS_STYLE[value] || 4 : 4
  ), `A1:D${Math.max(1, rows.length + 1)}`);
}

function buildResponsesSheet(responses) {
  const headers = ['Protocolo', 'Ordem', 'Campo', 'Pergunta', 'Resposta'];
  const rows = responses.map((item) => [item.protocolo, item.ordem, item.campo, item.pergunta, item.resposta]);
  return buildTableSheet(headers, rows, [22, 10, 18, 52, 70], null, `A1:E${Math.max(1, rows.length + 1)}`);
}

function stylesXml() {
  const fonts = [
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
    '<font><b/><sz val="20"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
    '<font><i/><sz val="11"/><color rgb="FF5B6573"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF1F1F1F"/><name val="Calibri"/></font>',
    '<font><b/><sz val="24"/><color rgb="FF17365D"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF9C0006"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFC65911"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF7F6000"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF375623"/><name val="Calibri"/></font>',
    '<font><b/><sz val="13"/><color rgb="FF17365D"/><name val="Calibri"/></font>',
    '<font><sz val="11"/><color rgb="FF17365D"/><name val="Calibri"/></font>',
  ];
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFC6E0B4"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF2F8"/><bgColor indexed="64"/></patternFill></fill>',
  ];
  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left style="thin"><color rgb="FFB4C6E7"/></left><right style="thin"><color rgb="FFB4C6E7"/></right><top style="thin"><color rgb="FFB4C6E7"/></top><bottom style="thin"><color rgb="FFB4C6E7"/></bottom><diagonal/></border>',
    '<border><left/><right/><top/><bottom style="hair"><color rgb="FFD9E2F3"/></bottom><diagonal/></border>',
  ];
  const xf = (fontId, fillId, borderId, alignment = '') => `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment ${alignment}/></xf>`;
  const xfs = [
    xf(0, 0, 0, 'vertical="bottom"'),
    xf(1, 2, 0, 'horizontal="center" vertical="center"'),
    xf(2, 0, 0, 'horizontal="center" vertical="center"'),
    xf(3, 3, 1, 'horizontal="center" vertical="center" wrapText="1"'),
    xf(0, 0, 2, 'vertical="top" wrapText="1"'),
    xf(6, 6, 2, 'vertical="top" wrapText="1"'),
    xf(7, 7, 2, 'vertical="top" wrapText="1"'),
    xf(8, 5, 2, 'vertical="top" wrapText="1"'),
    xf(9, 8, 2, 'vertical="top" wrapText="1"'),
    xf(0, 4, 2, 'vertical="top" wrapText="1"'),
    xf(0, 9, 2, 'vertical="top" wrapText="1"'),
    xf(0, 5, 2, 'vertical="top" wrapText="1"'),
    xf(0, 8, 2, 'vertical="top" wrapText="1"'),
    xf(0, 7, 2, 'vertical="top" wrapText="1"'),
    xf(0, 10, 2, 'vertical="top" wrapText="1"'),
    xf(0, 11, 2, 'vertical="top" wrapText="1"'),
    xf(4, 4, 1, 'horizontal="center" vertical="center"'),
    xf(5, 4, 1, 'horizontal="center" vertical="center"'),
    xf(4, 5, 1, 'horizontal="center" vertical="center"'),
    xf(5, 5, 1, 'horizontal="center" vertical="center"'),
    xf(4, 6, 1, 'horizontal="center" vertical="center"'),
    xf(5, 6, 1, 'horizontal="center" vertical="center"'),
    xf(11, 12, 1, 'horizontal="center" vertical="center" wrapText="1"'),
    xf(10, 0, 0, 'vertical="center"'),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="${fonts.length}">${fonts.join('')}</fonts>
  <fills count="${fills.length}">${fills.join('')}</fills>
  <borders count="${borders.length}">${borders.join('')}</borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

let crcTable = null;
function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  entries.forEach(({ name, content }) => {
    const nameBuffer = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  });

  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, end]);
}

function workbookEntries(snapshot) {
  const sheetNames = ['Resumo', 'Chamados', 'Histórico', 'Respostas'];
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetNames.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets>${sheetNames.map((name, index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetNames.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const now = new Date().toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Bot WhatsApp — Suporte TI Thailan</dc:creator>
  <cp:lastModifiedBy>Bot WhatsApp — Suporte TI Thailan</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;

  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Bot WhatsApp — Suporte TI</Application>
  <DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Planilhas</vt:lpstr></vt:variant><vt:variant><vt:i4>4</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="4" baseType="lpstr">${sheetNames.map((name) => `<vt:lpstr>${xmlEscape(name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>
</Properties>`;

  return [
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'docProps/core.xml', content: core },
    { name: 'docProps/app.xml', content: app },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/styles.xml', content: stylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: buildSummarySheet(snapshot, new Date()) },
    { name: 'xl/worksheets/sheet2.xml', content: buildTicketsSheet(snapshot.tickets || []) },
    { name: 'xl/worksheets/sheet3.xml', content: buildHistorySheet(snapshot.history || []) },
    { name: 'xl/worksheets/sheet4.xml', content: buildResponsesSheet(snapshot.responses || []) },
  ];
}

async function writeExcelReport(snapshot) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const output = createZip(workbookEntries(snapshot));
  const tempPath = path.join(DATA_DIR, `chamados-${process.pid}-${Date.now()}.tmp.xlsx`);
  fs.writeFileSync(tempPath, output);

  try {
    if (fs.existsSync(EXCEL_PATH)) {
      try { fs.copyFileSync(EXCEL_PATH, EXCEL_BACKUP_PATH); } catch { /* backup opcional */ }
      fs.rmSync(EXCEL_PATH, { force: true });
    }
    fs.renameSync(tempPath, EXCEL_PATH);
    if (fs.existsSync(EXCEL_PENDING_PATH)) fs.rmSync(EXCEL_PENDING_PATH, { force: true });
    return { ok: true, path: EXCEL_PATH, locked: false };
  } catch (error) {
    try {
      if (fs.existsSync(EXCEL_PENDING_PATH)) fs.rmSync(EXCEL_PENDING_PATH, { force: true });
      fs.renameSync(tempPath, EXCEL_PENDING_PATH);
    } catch {
      try { fs.rmSync(tempPath, { force: true }); } catch { /* sem ação */ }
    }
    const locked = ['EBUSY', 'EPERM', 'EACCES'].includes(error.code);
    if (!locked) throw error;
    return { ok: false, path: EXCEL_PENDING_PATH, locked: true, error };
  }
}

module.exports = {
  EXCEL_PATH,
  EXCEL_BACKUP_PATH,
  EXCEL_PENDING_PATH,
  writeExcelReport,
};
