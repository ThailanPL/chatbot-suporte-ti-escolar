@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Gerenciador de Chamados - Suporte TI
set "NODE_NO_WARNINGS=1"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js nao encontrado. Instale a versao LTS atual.
    pause
    exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)"
if errorlevel 1 (
    echo Atualize o Node.js para a versao 22.13 ou superior.
    node -v
    pause
    exit /b 1
)

call npm run chamados
pause
