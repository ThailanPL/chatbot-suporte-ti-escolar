@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem Inicializador não interativo para Agendador/VBS.
set "PUPPETEER_SKIP_DOWNLOAD=true"
set "PUPPETEER_CHROME_SKIP_DOWNLOAD=true"
set "NODE_NO_WARNINGS=1"

if not exist "logs" mkdir "logs" >nul 2>nul

where node >nul 2>nul
if errorlevel 1 exit /b 1

set "BOT_STATUS=UNKNOWN"
for /f "usebackq delims=" %%S in (`node bot-control.js status --plain 2^>nul`) do set "BOT_STATUS=%%S"

if /I "%BOT_STATUS%"=="RUNNING" exit /b 0
if /I "%BOT_STATUS%"=="STARTING" exit /b 0
if /I "%BOT_STATUS%"=="SESSION_IN_USE" exit /b 0

node bot-control.js cleanup --quiet >nul 2>nul

echo.>> "logs\bot-background.log"
echo =============================================================>> "logs\bot-background.log"
echo [%date% %time%] Iniciando Bot Suporte TI v1.7>> "logs\bot-background.log"
echo =============================================================>> "logs\bot-background.log"

call npm start >> "logs\bot-background.log" 2>&1
exit /b %errorlevel%
