@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Reiniciar Bot WhatsApp - Suporte TI

where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    pause
    exit /b 1
)

echo =============================================================
echo  REINICIO SEGURO - BOT WHATSAPP SUPORTE TI
echo =============================================================
echo.
node bot-control.js stop
node bot-control.js cleanup --quiet >nul 2>nul
start "" wscript.exe "%~dp0INICIAR-BOT-OCULTO.vbs"
timeout /t 3 /nobreak >nul
echo.
node bot-control.js details
echo.
pause
