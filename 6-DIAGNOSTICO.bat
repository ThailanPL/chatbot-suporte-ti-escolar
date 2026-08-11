@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Diagnostico - Bot Suporte TI
set "NODE_NO_WARNINGS=1"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js nao encontrado. Instale a versao LTS atual.
    pause
    exit /b 1
)

call npm run diagnostico
pause
