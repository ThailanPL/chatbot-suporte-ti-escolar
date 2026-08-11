# Chatbot de Suporte de TI Escolar — v1.7

Bot de respostas automáticas para o WhatsApp do Suporte TI, com controle de chamados, SQLite, Excel e gerenciamento seguro da instância em segundo plano.

## Principais recursos

- menu numérico com demandas de TI;
- somente 3 perguntas por chamado;
- pergunta 1: apenas **nome, local**, separados por vírgula;
- pergunta 2: descrição técnica sem solicitar patrimônio;
- pergunta 3: grau de urgência;
- horário: segunda a sexta, **08h às 11h30** e **12h45 às 18h**;
- mensagem de ausência fora do horário e no intervalo de almoço;
- protocolo automático;
- urgência: Baixa, Média, Alta ou Crítica;
- banco local SQLite em `data\chamados.sqlite`;
- planilha automática em `data\chamados.xlsx`;
- encerramento do chamado diretamente na planilha;
- mensagem automática de encerramento pelo WhatsApp;
- proteção contra notificações duplicadas;
- **controle de instância única na v1.7**.

## O que a v1.7 resolve

Se a sessão `.wwebjs_auth\session` já estiver sendo utilizada, `INICIAR-AQUI.bat` não tenta abrir outro navegador. Em vez do erro **“The browser is already running”**, ele informa que o bot já está ativo e mostra um menu de gerenciamento.

Menu disponível quando o bot está ativo:

1. Ver status do bot
2. Reiniciar o bot em segundo plano
3. Abrir planilha de chamados
4. Encerrar o bot
5. Abrir log de execução
0. Sair

A limpeza de `SingletonLock`, `SingletonSocket` e arquivos equivalentes só acontece quando nenhum processo associado à sessão do bot estiver ativo.

## Execução em segundo plano

`INICIAR-BOT-OCULTO.vbs` continua sendo o arquivo indicado para o Agendador de Tarefas. Na v1.7 ele chama `INICIAR-SERVICO.bat`, que verifica a sessão antes de executar `npm start`.

Se a tarefa do Windows já aponta para `INICIAR-BOT-OCULTO.vbs` dentro da mesma pasta, normalmente não é necessário recriá-la após atualizar.

## Atalhos

- `INICIAR-AQUI.bat`: inicia ou abre o menu de gerenciamento se o bot já estiver ativo;
- `INICIAR-SERVICO.bat`: inicializador não interativo para execução oculta;
- `INICIAR-BOT-OCULTO.vbs`: inicia o serviço sem janela visível;
- `2-INICIAR-BOT.bat`: abre o iniciador principal;
- `3-GERENCIAR-CHAMADOS.bat`: consulta e altera chamados;
- `4-GERAR-NOVO-QR-CODE.bat`: remove a autenticação para novo pareamento;
- `5-CORRIGIR-INSTALACAO.bat`: corrige dependências;
- `6-DIAGNOSTICO.bat`: verifica o projeto;
- `7-VER-ERROS.bat`: abre o log de erros;
- `8-ABRIR-PLANILHA.bat`: sincroniza e abre o Excel;
- `9-STATUS-DO-BOT.bat`: mostra se o bot está ativo, iniciando ou parado;
- `10-REINICIAR-BOT.bat`: reinicia com segurança em segundo plano.

## Como encerrar um chamado pelo Excel

1. Mantenha o bot em execução.
2. Execute `8-ABRIR-PLANILHA.bat`.
3. Abra a aba `Chamados`.
4. Localize o protocolo.
5. Altere **somente a coluna Status** para `Encerrado`.
6. Salve com `Ctrl + S`.

O SQLite é atualizado e o usuário recebe a confirmação de encerramento pelo WhatsApp. O mesmo protocolo não recebe a mensagem duas vezes.

## Banco e arquivos que não devem ser apagados

- `.wwebjs_auth`: sessão emparelhada do WhatsApp;
- `data\chamados.sqlite`: banco principal;
- `data\chamados.xlsx`: planilha operacional;
- `.env`: configuração local.

O arquivo `runtime\bot.pid.json` é temporário e serve apenas para identificar a instância ativa. Se o Windows for encerrado incorretamente, a v1.7 reconhece e ignora esse arquivo quando o PID não existir mais.

## Requisitos

- Windows 10 ou 11;
- Node.js 22.13 ou superior;
- Google Chrome, Microsoft Edge ou Brave;
- Microsoft Excel ou aplicativo compatível;
- internet.
