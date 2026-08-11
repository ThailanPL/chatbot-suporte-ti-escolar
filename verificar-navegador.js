"use strict";

const { findBrowserExecutable, getBrowserCandidates } = require("./browser-path");

const browserPath = findBrowserExecutable();

if (browserPath) {
  console.log(`[OK] Navegador compatível encontrado: ${browserPath}`);
  process.exit(0);
}

console.error("[ERRO] Não foi possível localizar Google Chrome, Microsoft Edge ou Brave.");
console.error("Instale o Google Chrome ou confirme se o Microsoft Edge está instalado.");
console.error("Também é possível informar manualmente o caminho no arquivo .env:");
console.error("BROWSER_EXECUTABLE_PATH=C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
console.error("\nLocais verificados:");
for (const candidate of getBrowserCandidates()) {
  console.error(`- ${candidate}`);
}
process.exit(1);
