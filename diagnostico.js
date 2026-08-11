'use strict';

const fs = require('fs');
const path = require('path');
const { findBrowserExecutable } = require('./browser-path');

const MIN_NODE = [22, 13, 0];
const requiredModules = ['whatsapp-web.js', 'qrcode-terminal'];

function ok(message) { console.log(`[OK] ${message}`); }
function error(message) { console.error(`[ERRO] ${message}`); }
function warning(message) { console.warn(`[AVISO] ${message}`); }

function versionAtLeast(current, minimum) {
  const parts = current.split('.').map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if ((parts[index] || 0) > minimum[index]) return true;
    if ((parts[index] || 0) < minimum[index]) return false;
  }
  return true;
}

async function main() {
  console.log('=============================================================');
  console.log(' DIAGNÓSTICO DO BOT — SUPORTE TI');
  console.log('=============================================================');

  let hasError = false;

  if (versionAtLeast(process.versions.node, MIN_NODE)) {
    ok(`Node.js ${process.versions.node} instalado.`);
  } else {
    hasError = true;
    error(`Node.js ${process.versions.node} é antigo para o banco SQLite integrado.`);
    error('Instale o Node.js 22.13 ou superior, preferencialmente a versão LTS atual.');
  }

  try {
    const { DatabaseSync } = require('node:sqlite');
    const testDb = new DatabaseSync(':memory:');
    testDb.exec('CREATE TABLE teste (id INTEGER PRIMARY KEY) STRICT;');
    testDb.close();
    ok('Banco SQLite integrado ao Node.js está disponível.');
  } catch (sqliteError) {
    hasError = true;
    error(`SQLite não está disponível: ${sqliteError.message}`);
  }

  for (const moduleName of requiredModules) {
    try {
      require.resolve(moduleName);
      ok(`Módulo “${moduleName}” encontrado.`);
    } catch {
      hasError = true;
      error(`Módulo “${moduleName}” não foi encontrado.`);
    }
  }

  const browserExecutablePath = findBrowserExecutable();
  if (browserExecutablePath) {
    ok(`Navegador compatível encontrado: ${browserExecutablePath}`);
  } else {
    hasError = true;
    error('Google Chrome, Microsoft Edge ou Brave não foi encontrado.');
  }

  for (const fileName of ['chatbot.js', 'bot-control.js', 'INICIAR-SERVICO.bat', 'database.js', 'excel-report.js', 'excel-sync.js', 'exportar-excel.js', 'gerenciar-chamados.js']) {
    const filePath = path.join(__dirname, fileName);
    if (fs.existsSync(filePath)) ok(`Arquivo ${fileName} encontrado.`);
    else {
      hasError = true;
      error(`Arquivo ${fileName} não foi encontrado.`);
    }
  }

  try {
    const {
      DB_PATH,
      EXCEL_PATH,
      initDatabase,
      closeDatabase,
      countTickets,
      exportTicketsToExcel,
      waitForExcelExport,
    } = require('./database');

    initDatabase();
    ok(`Banco de dados válido: ${DB_PATH}`);
    ok(`Chamados armazenados: ${countTickets()}.`);

    if (!hasError) {
      const result = await exportTicketsToExcel();
      await waitForExcelExport();
      if (result?.locked) {
        warning('A planilha está aberta no Excel. A atualização automática ficará pendente até ela ser fechada.');
      } else if (fs.existsSync(EXCEL_PATH)) {
        ok(`Planilha Excel válida: ${EXCEL_PATH}`);
        const { readTicketStatusesFromExcel } = require('./excel-sync');
        readTicketStatusesFromExcel(EXCEL_PATH);
        ok('Leitura da aba Chamados e monitoramento de encerramentos disponíveis.');
      } else {
        hasError = true;
        error('A planilha Excel não foi criada.');
      }
    }

    closeDatabase();
  } catch (databaseError) {
    hasError = true;
    error(`Falha ao abrir o banco ou gerar a planilha: ${databaseError.message}`);
  }

  const legacyJson = path.join(__dirname, 'data', 'chamados.json');
  if (fs.existsSync(legacyJson)) {
    warning('O arquivo data/chamados.json será mantido como cópia legível do banco.');
  }

  console.log('-------------------------------------------------------------');
  if (hasError) {
    error('Foram encontrados problemas. Corrija os itens acima antes de iniciar.');
    process.exitCode = 1;
  } else {
    ok('Tudo parece pronto. Execute INICIAR-AQUI.bat. A versão 1.7 impedirá uma segunda instância.');
  }
}

main().catch((unexpectedError) => {
  console.error(`[ERRO] Falha inesperada no diagnóstico: ${unexpectedError.message}`);
  process.exitCode = 1;
});
