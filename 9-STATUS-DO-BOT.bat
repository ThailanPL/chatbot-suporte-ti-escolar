@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Status do Bot WhatsApp - Suporte TI

where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    pause
    exit /b 1
)

node bot-control.js details
echo.
pause
