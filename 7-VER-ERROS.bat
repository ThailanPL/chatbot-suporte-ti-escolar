@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Erros do Bot WhatsApp - Suporte TI

if not exist "logs\erros.log" (
    echo =============================================================
    echo  LOG DE ERROS - BOT WHATSAPP
    echo =============================================================
    echo.
    echo Nenhum arquivo de erro foi criado até o momento.
    echo Isso significa que o bot ainda não registrou falhas detalhadas.
    echo.
    pause
    exit /b 0
)

start "" notepad.exe "logs\erros.log"
