'use strict';

const {
  EXCEL_PATH,
  initDatabase,
  closeDatabase,
  exportTicketsToExcel,
  waitForExcelExport,
} = require('./database');

async function main() {
  try {
    initDatabase();
    const result = await exportTicketsToExcel();
    await waitForExcelExport();

    if (result?.locked) {
      console.log('[AVISO] A planilha principal está aberta no Excel.');
      console.log('[AVISO] Feche a planilha; o bot tentará atualizá-la novamente automaticamente.');
      process.exitCode = 2;
      return;
    }

    console.log(`[OK] Planilha atualizada: ${EXCEL_PATH}`);
  } catch (error) {
    console.error(`[ERRO] Não foi possível gerar a planilha: ${error.message}`);
    process.exitCode = 1;
  } finally {
    closeDatabase();
  }
}

main();
