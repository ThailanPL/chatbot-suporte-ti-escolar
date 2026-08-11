@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Bot WhatsApp - Suporte TI Thailan v1.7

set "PUPPETEER_SKIP_DOWNLOAD=true"
set "PUPPETEER_CHROME_SKIP_DOWNLOAD=true"
set "NODE_NO_WARNINGS=1"

where node >nul 2>nul
if errorlevel 1 (
    echo =============================================================
    echo  BOT WHATSAPP - SUPORTE TI - THAILAN - V1.7
    echo =============================================================
    echo.
    echo [ERRO] O Node.js nao esta instalado.
    echo Instale a versao LTS atual pelo site: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)"
if errorlevel 1 (
    echo [ERRO] A versao do Node.js e antiga para o banco SQLite.
    echo Versao encontrada:
    node -v
    echo.
    echo Instale o Node.js 22.13 ou superior, de preferencia a versao LTS atual.
    echo Endereco: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:VERIFICAR_STATUS
set "BOT_STATUS=UNKNOWN"
for /f "usebackq delims=" %%S in (`node bot-control.js status --plain 2^>nul`) do set "BOT_STATUS=%%S"

if /I "%BOT_STATUS%"=="RUNNING" goto :BOT_JA_EXECUTANDO
if /I "%BOT_STATUS%"=="STARTING" goto :BOT_JA_EXECUTANDO
if /I "%BOT_STATUS%"=="SESSION_IN_USE" goto :SESSAO_OCUPADA

goto :INICIAR_NORMAL

:BOT_JA_EXECUTANDO
cls
echo =============================================================
echo  SUPORTE TI - THAILAN - V1.7
echo =============================================================
echo.
echo [OK] O Bot de Suporte TI ja esta em execucao.
echo.
echo Nao e necessario iniciar outra instancia.
echo.
echo 1 - Ver status do bot
echo 2 - Reiniciar o bot em segundo plano
echo 3 - Abrir planilha de chamados
echo 4 - Encerrar o bot
echo 5 - Abrir log de execucao
echo 0 - Sair
echo.
set /p "OPCAO=Escolha uma opcao: "

if "%OPCAO%"=="1" (
    cls
    node bot-control.js details
    echo.
    pause
    goto :BOT_JA_EXECUTANDO
)
if "%OPCAO%"=="2" goto :REINICIAR_SEGURO
if "%OPCAO%"=="3" (
    call "8-ABRIR-PLANILHA.bat"
    goto :BOT_JA_EXECUTANDO
)
if "%OPCAO%"=="4" (
    echo.
    node bot-control.js stop
    echo.
    pause
    exit /b 0
)
if "%OPCAO%"=="5" (
    if exist "logs\bot-background.log" (
        start "" notepad.exe "logs\bot-background.log"
    ) else (
        echo.
        echo [INFO] O log de segundo plano ainda nao foi criado.
        pause
    )
    goto :BOT_JA_EXECUTANDO
)
if "%OPCAO%"=="0" exit /b 0

goto :BOT_JA_EXECUTANDO

:SESSAO_OCUPADA
cls
echo =============================================================
echo  SUPORTE TI - THAILAN - V1.7
echo =============================================================
echo.
echo [AVISO] A sessao do WhatsApp esta ocupada por um navegador.
echo Nao foi possivel confirmar uma instancia normal do bot.
echo.
echo Isso pode acontecer apos queda de energia, travamento ou encerramento
echo incorreto do Windows.
echo.
echo 1 - Reiniciar o bot com seguranca
echo 2 - Ver detalhes
echo 3 - Abrir planilha de chamados
echo 0 - Sair sem alterar nada
echo.
set /p "OPCAO=Escolha uma opcao: "
if "%OPCAO%"=="1" goto :REINICIAR_SEGURO
if "%OPCAO%"=="2" (
    cls
    node bot-control.js details
    echo.
    pause
    goto :SESSAO_OCUPADA
)
if "%OPCAO%"=="3" (
    call "8-ABRIR-PLANILHA.bat"
    goto :SESSAO_OCUPADA
)
if "%OPCAO%"=="0" exit /b 0
goto :SESSAO_OCUPADA

:REINICIAR_SEGURO
cls
echo =============================================================
echo  REINICIO SEGURO - SUPORTE TI
echo =============================================================
echo.
echo [1/3] Encerrando somente os processos desta sessao do bot...
node bot-control.js stop
echo [2/3] Limpando travas antigas, se existirem...
node bot-control.js cleanup --quiet >nul 2>nul
echo [3/3] Iniciando novamente em segundo plano...
start "" wscript.exe "%~dp0INICIAR-BOT-OCULTO.vbs"
timeout /t 3 /nobreak >nul
echo.
node bot-control.js details
echo.
echo Se o status ainda aparecer como INICIANDO, aguarde alguns segundos
echo e envie "menu" de outro celular para testar.
echo.
pause
goto :VERIFICAR_STATUS

:INICIAR_NORMAL
cls
echo =============================================================
echo  BOT WHATSAPP - SUPORTE TI - THAILAN - V1.7
echo =============================================================
echo.
echo [OK] Nenhuma outra instancia do bot foi encontrada.
echo.

echo [INFO] Verificando o navegador instalado...
node verificar-navegador.js
if errorlevel 1 (
    echo.
    pause
    exit /b 1
)

set "PRECISA_INSTALAR=0"
if not exist "node_modules\whatsapp-web.js" set "PRECISA_INSTALAR=1"
if not exist "node_modules\qrcode-terminal" set "PRECISA_INSTALAR=1"

if "%PRECISA_INSTALAR%"=="1" (
    echo.
    echo [INFO] Instalando ou atualizando os componentes necessarios...
    echo [INFO] O Chrome nao sera baixado novamente.
    echo.
    call npm install --no-audit --no-fund --loglevel=error
    if errorlevel 1 (
        echo.
        echo [ERRO] A instalacao falhou.
        echo Execute o arquivo 5-CORRIGIR-INSTALACAO.bat.
        pause
        exit /b 1
    )
)

echo.
echo [INFO] Executando diagnostico...
call npm run diagnostico
if errorlevel 1 (
    echo.
    echo [ERRO] O diagnostico encontrou um problema.
    pause
    exit /b 1
)

node bot-control.js cleanup --quiet >nul 2>nul

echo.
echo [INFO] Iniciando o bot nesta janela...
echo [INFO] Para deixa-lo invisivel, use INICIAR-BOT-OCULTO.vbs.
echo.
call npm start

echo.
echo O bot foi encerrado.
pause
