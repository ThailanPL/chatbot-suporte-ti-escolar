@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Corrigir Instalacao - Bot Suporte TI

set "PUPPETEER_SKIP_DOWNLOAD=true"
set "PUPPETEER_CHROME_SKIP_DOWNLOAD=true"
set "NODE_NO_WARNINGS=1"

echo =============================================================
echo  CORRIGIR INSTALACAO DO BOT
 echo =============================================================
echo.
echo Este processo reinstala os modulos e preserva:
echo - o banco data\chamados.sqlite
echo - a copia data\chamados.json
echo - a planilha data\chamados.xlsx
echo - o emparelhamento do WhatsApp
echo - o arquivo .env
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    echo Instale a versao LTS atual em https://nodejs.org/
    pause
    exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)"
if errorlevel 1 (
    echo [ERRO] Atualize o Node.js para a versao 22.13 ou superior.
    node -v
    pause
    exit /b 1
)

node verificar-navegador.js
if errorlevel 1 (
    echo.
    pause
    exit /b 1
)

echo.
echo [1/4] Removendo modulos incompletos...
if exist "node_modules" rmdir /s /q "node_modules"
if exist "package-lock.json" del /f /q "package-lock.json"

echo [2/4] Limpando o cache incompleto do Puppeteer...
if exist "%USERPROFILE%\.cache\puppeteer" rmdir /s /q "%USERPROFILE%\.cache\puppeteer"
if exist "%LOCALAPPDATA%\puppeteer" rmdir /s /q "%LOCALAPPDATA%\puppeteer"

echo [3/4] Verificando o cache do npm...
call npm cache verify
if errorlevel 1 echo [AVISO] A verificacao do cache falhou, mas a instalacao continuara.

echo [4/4] Reinstalando sem baixar outro Chrome...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
    echo.
    echo [ERRO] A reinstalacao falhou.
    echo Verifique a internet, o antivirus e o proxy da rede.
    pause
    exit /b 1
)

echo.
call npm run diagnostico
if errorlevel 1 (
    echo [ERRO] A instalacao terminou, mas o diagnostico encontrou um problema.
    pause
    exit /b 1
)

echo.
echo =============================================================
echo  CORRECAO CONCLUIDA COM SUCESSO
echo =============================================================
echo Agora execute INICIAR-AQUI.bat.
pause
