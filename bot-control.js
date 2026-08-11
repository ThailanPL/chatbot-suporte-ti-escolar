'use strict';

// =============================================================
// CONTROLE DE INSTÂNCIA — BOT WHATSAPP SUPORTE TI
// Versão 1.7
// Detecta o bot/navegador que usa a sessão deste projeto e evita
// que duas instâncias tentem abrir o mesmo perfil do WhatsApp.
// =============================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = __dirname;
const SESSION_DIR = path.join(ROOT_DIR, '.wwebjs_auth', 'session');
const RUNTIME_DIR = path.join(ROOT_DIR, 'runtime');
const PID_FILE = path.join(RUNTIME_DIR, 'bot.pid.json');
const STALE_LOCK_NAMES = [
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
  'lockfile',
  'LOCK',
];

function normalizeWindowsPath(value) {
  return String(value || '').replace(/\//g, '\\').replace(/\\+$/g, '').toLowerCase();
}

function readPidFile() {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    if (!Number.isInteger(Number(data.pid))) return null;
    return { ...data, pid: Number(data.pid) };
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  if (!pid || !Number.isInteger(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    // EPERM normalmente significa que o processo existe, mas não pode ser sinalizado.
    return error && error.code === 'EPERM';
  }
}

function removeStalePidFile() {
  const pidInfo = readPidFile();
  if (!pidInfo) {
    try { fs.rmSync(PID_FILE, { force: true }); } catch {}
    return false;
  }
  if (isPidAlive(pidInfo.pid)) return false;
  try { fs.rmSync(PID_FILE, { force: true }); } catch {}
  return true;
}

function runPowerShell(script, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script];
  let result = spawnSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true, env });
  if (result.error && result.error.code === 'ENOENT') {
    result = spawnSync('powershell', args, { encoding: 'utf8', windowsHide: true, env });
  }
  if (result.error || result.status !== 0) {
    return { ok: false, stdout: '', stderr: result.stderr || result.error?.message || '' };
  }
  return { ok: true, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}

function getWindowsProcesses() {
  if (process.platform !== 'win32') return [];
  const script = [
    '$ErrorActionPreference = "Stop";',
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false;',
    '$OutputEncoding = [Console]::OutputEncoding;',
    'Get-CimInstance Win32_Process |',
    'Select-Object ProcessId,ParentProcessId,Name,CommandLine |',
    'ConvertTo-Json -Compress -Depth 3',
  ].join(' ');
  const result = runPowerShell(script);
  if (!result.ok || !result.stdout) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function commandLineIncludes(processInfo, needle) {
  const haystack = normalizeWindowsPath(processInfo?.CommandLine || '');
  return haystack.includes(normalizeWindowsPath(needle));
}

function isBrowserName(name) {
  return /^(chrome|msedge|brave)(\.exe)?$/i.test(String(name || ''));
}

function isNodeName(name) {
  return /^node(\.exe)?$/i.test(String(name || ''));
}

function buildProcessMap(processes) {
  return new Map(processes.map((item) => [Number(item.ProcessId), item]));
}

function findNodeAncestor(processInfo, processMap) {
  let current = processInfo;
  const visited = new Set();
  for (let depth = 0; depth < 12 && current; depth += 1) {
    const parentPid = Number(current.ParentProcessId || 0);
    if (!parentPid || visited.has(parentPid)) return null;
    visited.add(parentPid);
    const parent = processMap.get(parentPid);
    if (!parent) return null;
    if (isNodeName(parent.Name)) return parent;
    current = parent;
  }
  return null;
}

function getStatus() {
  removeStalePidFile();

  const pidInfo = readPidFile();
  if (pidInfo && isPidAlive(pidInfo.pid)) {
    return {
      state: 'RUNNING',
      source: 'pid_file',
      botPid: pidInfo.pid,
      startedAt: pidInfo.startedAt || null,
      sessionDir: SESSION_DIR,
      sessionBrowsers: [],
      staleLocks: getExistingStaleLocks(),
    };
  }

  if (process.platform !== 'win32') {
    return {
      state: 'STOPPED',
      source: 'no_pid',
      botPid: null,
      sessionDir: SESSION_DIR,
      sessionBrowsers: [],
      staleLocks: getExistingStaleLocks(),
    };
  }

  const processes = getWindowsProcesses();
  const processMap = buildProcessMap(processes);
  const sessionBrowsers = processes.filter((item) => isBrowserName(item.Name) && commandLineIncludes(item, SESSION_DIR));

  for (const browser of sessionBrowsers) {
    const nodeAncestor = findNodeAncestor(browser, processMap);
    if (nodeAncestor) {
      return {
        state: 'RUNNING',
        source: 'session_browser',
        botPid: Number(nodeAncestor.ProcessId),
        browserPid: Number(browser.ProcessId),
        browserName: browser.Name,
        sessionDir: SESSION_DIR,
        sessionBrowsers,
        staleLocks: getExistingStaleLocks(),
      };
    }
  }

  // Fallback: durante os primeiros segundos o Node pode existir antes do navegador.
  const chatbotNodes = processes.filter((item) => isNodeName(item.Name) && /chatbot\.js/i.test(String(item.CommandLine || '')));
  if (chatbotNodes.length === 1) {
    return {
      state: 'STARTING',
      source: 'chatbot_node',
      botPid: Number(chatbotNodes[0].ProcessId),
      sessionDir: SESSION_DIR,
      sessionBrowsers,
      staleLocks: getExistingStaleLocks(),
    };
  }

  if (sessionBrowsers.length > 0) {
    return {
      state: 'SESSION_IN_USE',
      source: 'orphan_browser',
      botPid: null,
      sessionDir: SESSION_DIR,
      sessionBrowsers,
      staleLocks: getExistingStaleLocks(),
    };
  }

  return {
    state: 'STOPPED',
    source: 'none',
    botPid: null,
    sessionDir: SESSION_DIR,
    sessionBrowsers: [],
    staleLocks: getExistingStaleLocks(),
  };
}

function getExistingStaleLocks() {
  if (!fs.existsSync(SESSION_DIR)) return [];
  return STALE_LOCK_NAMES
    .map((name) => path.join(SESSION_DIR, name))
    .filter((filePath) => fs.existsSync(filePath));
}

function cleanupStaleLocks(options = {}) {
  const status = getStatus();
  if (['RUNNING', 'STARTING', 'SESSION_IN_USE'].includes(status.state)) {
    if (!options.quiet) {
      console.log('[AVISO] A sessão está em uso. Nenhuma trava foi removida.');
    }
    return { removed: [], refused: true, status };
  }

  const removed = [];
  for (const filePath of getExistingStaleLocks()) {
    try {
      fs.rmSync(filePath, { recursive: true, force: true });
      removed.push(filePath);
    } catch {}
  }
  removeStalePidFile();

  if (!options.quiet) {
    if (removed.length) {
      console.log(`[OK] ${removed.length} trava(s) antiga(s) removida(s) com segurança.`);
    } else {
      console.log('[OK] Nenhuma trava antiga precisou ser removida.');
    }
  }
  return { removed, refused: false, status };
}

function killProcessTree(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.status === 0;
  }
  try {
    process.kill(Number(pid), 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function stopBot(options = {}) {
  const status = getStatus();
  const killed = new Set();

  if (status.botPid) {
    if (killProcessTree(status.botPid)) killed.add(status.botPid);
  }

  // Se houver um navegador órfão usando especificamente esta sessão,
  // encerra apenas os processos desse perfil, sem tocar no navegador pessoal.
  if (status.state === 'SESSION_IN_USE' || (!status.botPid && status.sessionBrowsers?.length)) {
    for (const browser of status.sessionBrowsers || []) {
      const pid = Number(browser.ProcessId);
      if (pid && !killed.has(pid) && killProcessTree(pid)) killed.add(pid);
    }
  }

  const pidInfo = readPidFile();
  if (pidInfo?.pid && !killed.has(pidInfo.pid) && isPidAlive(pidInfo.pid)) {
    if (killProcessTree(pidInfo.pid)) killed.add(pidInfo.pid);
  }

  // Dá um pequeno tempo para Chrome/Edge liberar o perfil.
  const start = Date.now();
  while (Date.now() - start < 1500) {
    // espera síncrona curta para uso exclusivo pelo utilitário de manutenção
  }

  try { fs.rmSync(PID_FILE, { force: true }); } catch {}
  const after = getStatus();
  if (after.state === 'STOPPED') cleanupStaleLocks({ quiet: true });

  if (!options.quiet) {
    if (killed.size > 0) console.log('[OK] Bot encerrado com segurança.');
    else if (status.state === 'STOPPED') console.log('[OK] O bot já estava parado.');
    else console.log('[AVISO] Não foi possível confirmar o encerramento de todos os processos.');
  }
  return getStatus();
}

function printDetails(status = getStatus()) {
  console.log('=============================================================');
  console.log(' STATUS DO BOT — SUPORTE TI');
  console.log('=============================================================');
  const labels = {
    RUNNING: 'EM EXECUÇÃO',
    STARTING: 'INICIANDO',
    SESSION_IN_USE: 'SESSÃO OCUPADA / NAVEGADOR ÓRFÃO',
    STOPPED: 'PARADO',
  };
  console.log(`Status: ${labels[status.state] || status.state}`);
  if (status.botPid) console.log(`PID do bot: ${status.botPid}`);
  if (status.browserName) console.log(`Navegador: ${status.browserName}${status.browserPid ? ` (PID ${status.browserPid})` : ''}`);
  console.log(`Sessão: ${status.sessionDir}`);
  if (status.startedAt) console.log(`Iniciado em: ${status.startedAt}`);
  console.log(`Travas de perfil encontradas: ${status.staleLocks?.length || 0}`);
  console.log('-------------------------------------------------------------');
  if (status.state === 'RUNNING') {
    console.log('[OK] Não inicie uma segunda instância.');
  } else if (status.state === 'SESSION_IN_USE') {
    console.log('[AVISO] O navegador da sessão está aberto sem um processo do bot confirmado.');
    console.log('Use a opção de reinício seguro no INICIAR-AQUI.bat.');
  } else if (status.state === 'STOPPED') {
    console.log('[INFO] O bot pode ser iniciado normalmente.');
  }
}

function main() {
  const command = String(process.argv[2] || 'details').toLowerCase();
  const plain = process.argv.includes('--plain');
  const quiet = process.argv.includes('--quiet');

  if (command === 'status' || command === 'details') {
    const status = getStatus();
    if (plain) console.log(status.state);
    else printDetails(status);
    return;
  }
  if (command === 'cleanup') {
    cleanupStaleLocks({ quiet });
    return;
  }
  if (command === 'stop') {
    stopBot({ quiet });
    return;
  }

  console.error('Uso: node bot-control.js status [--plain] | details | stop | cleanup');
  process.exitCode = 2;
}

if (require.main === module) main();

module.exports = {
  ROOT_DIR,
  SESSION_DIR,
  RUNTIME_DIR,
  PID_FILE,
  getStatus,
  cleanupStaleLocks,
  stopBot,
  isPidAlive,
};
