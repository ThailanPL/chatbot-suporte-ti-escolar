@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Gerar Novo QR Code - Suporte TI

echo =============================================================
echo  GERAR UM NOVO QR CODE
echo =============================================================
echo.
echo Este procedimento apagara somente a sessao salva do WhatsApp Web.
echo Os chamados registrados na pasta data NAO serao apagados.
echo.
set /p CONFIRMA=Digite SIM para continuar: 
if /I not "%CONFIRMA%"=="SIM" (
    echo Operacao cancelada.
    pause
    exit /b 0
)

if exist ".wwebjs_auth" rmdir /s /q ".wwebjs_auth"
if exist ".wwebjs_cache" rmdir /s /q ".wwebjs_cache"

echo.
echo Sessao removida. Um novo QR Code sera gerado.
echo.
call "INICIAR-AQUI.bat"
