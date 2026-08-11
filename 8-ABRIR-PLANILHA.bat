@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Planilha de Chamados - Suporte TI

set "NODE_NO_WARNINGS=1"

echo =============================================================
echo  PLANILHA DE CHAMADOS - SUPORTE TI
echo =============================================================
echo.
echo Para encerrar um chamado e avisar o usuario:
echo 1. Abra a aba Chamados.
echo 2. Altere somente a coluna Status para Encerrado.
echo 3. Salve o arquivo.
echo 4. Mantenha o bot em execucao.
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] O Node.js nao foi encontrado.
    echo Execute primeiro INICIAR-AQUI.bat.
    pause
    exit /b 1
)

call npm run excel
if errorlevel 2 (
    echo.
    echo A planilha esta aberta. Feche o Excel e execute este arquivo novamente.
    pause
    exit /b 2
)
if errorlevel 1 (
    echo.
    pause
    exit /b 1
)

if exist "data\chamados.xlsx" (
    start "" "data\chamados.xlsx"
) else (
    echo [ERRO] A planilha nao foi encontrada.
    pause
    exit /b 1
)
