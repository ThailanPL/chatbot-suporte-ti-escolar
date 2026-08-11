"use strict";

const fs = require("fs");
const path = require("path");

function expandEnvironmentVariables(value) {
  return String(value || "").replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
}

function getBrowserCandidates() {
  const candidates = [];
  const add = (value) => {
    if (!value) return;
    const expanded = path.normalize(expandEnvironmentVariables(value).replace(/^['"]|['"]$/g, ""));
    if (!candidates.includes(expanded)) candidates.push(expanded);
  };

  add(process.env.BROWSER_EXECUTABLE_PATH);
  add(process.env.PUPPETEER_EXECUTABLE_PATH);
  add(process.env.CHROME_PATH);

  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA;

    // Google Chrome
    add(path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"));
    add(path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"));
    if (localAppData) add(path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"));

    // Microsoft Edge — normalmente já instalado no Windows 10/11.
    add(path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"));
    add(path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"));
    if (localAppData) add(path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"));

    // Outros navegadores Chromium comuns.
    if (localAppData) add(path.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"));
    add(path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"));
  } else if (process.platform === "darwin") {
    add("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    add("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
    add("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser");
  } else {
    add("/usr/bin/google-chrome-stable");
    add("/usr/bin/google-chrome");
    add("/usr/bin/chromium");
    add("/usr/bin/chromium-browser");
    add("/usr/bin/microsoft-edge");
    add("/usr/bin/microsoft-edge-stable");
  }

  return candidates;
}

function findBrowserExecutable() {
  return getBrowserCandidates().find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) || null;
}

module.exports = {
  findBrowserExecutable,
  getBrowserCandidates,
};
