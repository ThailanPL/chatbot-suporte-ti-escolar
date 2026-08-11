@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
title Instalar Bot WhatsApp - Suporte TI

set "PUPPETEER_SKIP_DOWNLOAD=true"
set "PUPPETEER_CHROME_SKIP_DOWNLOAD=true"

echo =============================================================
echo  INSTALACAO DO BOT WHATSAPP
echo =============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    echo Instale a versao LTS em https://nodejs.org/
    pause
    exit /b 1
)

node --version
npm --version
echo.
node verificar-navegador.js
if errorlevel 1 (
    pause
    exit /b 1
)

echo.
echo Instalando os componentes sem baixar outro Chrome...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
    echo.
    echo [ERRO] Nao foi possivel instalar todas as dependencias.
    echo Tente o arquivo 5-CORRIGIR-INSTALACAO.bat na pasta principal.
    pause
    exit /b 1
)

echo.
call npm run diagnostico
echo.
echo Instalacao concluida.
pause
