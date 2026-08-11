@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Atualizacao v1.7 - Controle de instancia

set "DEST=%~dp0.."
set "BACKUP=%DEST%\backup-antes-v1.7"
set "NODE_NO_WARNINGS=1"

cls
echo =============================================================
echo  ATUALIZACAO V1.7 - CONTROLE DE INSTANCIA
echo =============================================================
echo.
echo Esta versao corrige o erro:
echo The browser is already running...
echo.
echo Ela preserva o emparelhamento, SQLite, Excel e chamados.
echo.

if not exist "%DEST%\chatbot.js" (
    echo [ERRO] Esta pasta precisa ficar DENTRO da pasta principal do bot.
    echo.
    echo Estrutura esperada:
    echo Pasta-do-bot\chatbot.js
    echo Pasta-do-bot\Correcao_Bot_WhatsApp_v1.7_Controle_Instancia\APLICAR-ATUALIZACAO-v1.7.bat
    echo.
    pause
    exit /b 1
)

set /p "CONFIRMA=Deseja aplicar a atualizacao agora? [S/N]: "
if /I not "%CONFIRMA%"=="S" (
    echo Atualizacao cancelada.
    pause
    exit /b 0
)

if not exist "%BACKUP%" mkdir "%BACKUP%" >nul 2>nul

echo.
echo [1/4] Criando backup dos arquivos de programa...
for %%F in (chatbot.js bot-control.js diagnostico.js package.json INICIAR-AQUI.bat INICIAR-SERVICO.bat INICIAR-BOT-OCULTO.vbs 9-STATUS-DO-BOT.bat 10-REINICIAR-BOT.bat README.md GUIA-RAPIDO.txt .gitignore) do (
    if exist "%DEST%\%%F" copy /Y "%DEST%\%%F" "%BACKUP%\%%F" >nul
)

echo [2/4] Instalando os arquivos da v1.7...
for %%F in (chatbot.js bot-control.js diagnostico.js package.json INICIAR-AQUI.bat INICIAR-SERVICO.bat INICIAR-BOT-OCULTO.vbs 9-STATUS-DO-BOT.bat 10-REINICIAR-BOT.bat README.md GUIA-RAPIDO.txt LEIA-ME-ATUALIZACAO-v1.7.txt .gitignore) do (
    copy /Y "%~dp0arquivos\%%F" "%DEST%\%%F" >nul
    if errorlevel 1 goto :erro
)

echo [3/4] Validando o codigo...
where node >nul 2>nul
if errorlevel 1 (
    echo [AVISO] Arquivos instalados, mas Node.js nao foi encontrado para validar.
    goto :finalizar
)
cd /d "%DEST%"
node --check chatbot.js
if errorlevel 1 goto :erro
node --check bot-control.js
if errorlevel 1 goto :erro
node --check diagnostico.js
if errorlevel 1 goto :erro

echo [4/4] Verificando se o bot esta em execucao...
set "BOT_STATUS=UNKNOWN"
for /f "usebackq delims=" %%S in (`node bot-control.js status --plain 2^>nul`) do set "BOT_STATUS=%%S"
echo [INFO] Status detectado: %BOT_STATUS%

:finalizar
echo.
echo =============================================================
echo  ATUALIZACAO V1.7 INSTALADA COM SUCESSO
echo =============================================================
echo.
echo Novidades:
echo - impede duas instancias do bot;
echo - mostra menu se o bot ja estiver ativo;
echo - reinicio seguro em segundo plano;
echo - limpa travas antigas somente quando for seguro;
echo - novos atalhos 9-STATUS-DO-BOT e 10-REINICIAR-BOT.
echo.

if not defined BOT_STATUS goto :fim
if /I "%BOT_STATUS%"=="RUNNING" goto :perguntar_reinicio
if /I "%BOT_STATUS%"=="STARTING" goto :perguntar_reinicio
if /I "%BOT_STATUS%"=="SESSION_IN_USE" goto :perguntar_reinicio

set /p "INICIAR=Deseja iniciar o bot em segundo plano agora? [S/N]: "
if /I "%INICIAR%"=="S" (
    start "" wscript.exe "%DEST%\INICIAR-BOT-OCULTO.vbs"
    timeout /t 3 /nobreak >nul
    node "%DEST%\bot-control.js" details
)
goto :fim

:perguntar_reinicio
echo.
echo [INFO] Existe uma instancia ou navegador usando a sessao atual.
echo Para ativar completamente a v1.7, o bot precisa ser reiniciado uma vez.
set /p "REINICIAR=Deseja reiniciar o bot com seguranca agora? [S/N]: "
if /I "%REINICIAR%"=="S" (
    cd /d "%DEST%"
    node bot-control.js stop
    node bot-control.js cleanup --quiet >nul 2>nul
    start "" wscript.exe "%DEST%\INICIAR-BOT-OCULTO.vbs"
    timeout /t 3 /nobreak >nul
    node bot-control.js details
) else (
    echo [INFO] A v1.7 entrara em vigor na proxima reinicializacao do bot.
)
goto :fim

:erro
echo.
echo [ERRO] Nao foi possivel concluir a atualizacao.
echo Backup disponivel em:
echo %BACKUP%
echo.
pause
exit /b 1

:fim
echo.
echo Para consultar o bot a qualquer momento, execute:
echo 9-STATUS-DO-BOT.bat
echo.
pause
exit /b 0
