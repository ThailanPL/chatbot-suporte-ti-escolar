# 🧰 Chatbot de Suporte de TI Escolar

**Versão atual: v1.7**

Chatbot desenvolvido em **Node.js** para automatizar o primeiro atendimento de um setor de Tecnologia da Informação por meio do WhatsApp.

O projeto organiza solicitações de suporte, conduz o usuário por um fluxo estruturado de atendimento, realiza validações, oferece orientações iniciais e registra informações necessárias para abertura e acompanhamento de chamados.

> 📚 Além de sua finalidade prática, este projeto é utilizado como ambiente de estudo de JavaScript, Node.js, Git, depuração, automação e arquitetura de software.

---

## 🎯 Objetivo

O projeto surgiu da necessidade de organizar e agilizar o atendimento de suporte de TI em ambiente escolar.

Em vez de o usuário enviar apenas mensagens como:

```text
"Meu computador não funciona."
```

o chatbot conduz o atendimento coletando informações como:

```text
Categoria
↓
Tipo de problema
↓
Autodiagnóstico
↓
Local do atendimento
↓
Descrição
↓
Prioridade
↓
Confirmação
↓
Protocolo
```

Dessa forma, o técnico recebe uma solicitação mais estruturada e com informações suficientes para iniciar a análise.

---

# ✨ Principais funcionalidades

* Atendimento automático pelo WhatsApp;
* Menu estruturado de serviços de TI;
* Identificação de diferentes categorias de atendimento;
* Submenus específicos para cada categoria;
* Orientações de autodiagnóstico;
* Registro do local do problema;
* Coleta detalhada da descrição da solicitação;
* Definição do nível de prioridade;
* Confirmação dos dados antes da abertura;
* Geração automática de protocolo;
* Consulta de chamado por protocolo;
* Recebimento de imagens, vídeos e documentos;
* Armazenamento local das solicitações;
* Controle de sessão por usuário;
* Expiração automática de atendimentos abandonados;
* Fila individual de processamento por contato;
* Reconexão automática em determinadas situações;
* Persistência da autenticação do WhatsApp;
* Scripts auxiliares para inicialização e controle do bot no Windows;
* Tratamento de erros e encerramento seguro da aplicação.

---

# 🧭 Fluxo de atendimento

O fluxo principal funciona como uma máquina de estados.

```text
Usuário envia mensagem
        ↓
     CATEGORIA
        ↓
       ITEM
        ↓
 AUTODIAGNÓSTICO
    quando aplicável
        ↓
       LOCAL
        ↓
    DESCRIÇÃO
        ↓
     URGÊNCIA
        ↓
   CONFIRMAÇÃO
        ↓
REGISTRO DO CHAMADO
        ↓
     PROTOCOLO
```

Também existe um fluxo independente para consulta:

```text
status TI-...
      ↓
Validação do protocolo
      ↓
Busca do chamado
      ↓
Retorno do status
```

---

# 🗂️ Categorias de suporte

O bot foi estruturado para atender diferentes tipos de solicitações relacionadas ao setor de TI.

Entre elas:

* 🔐 Senhas, contas e acessos;
* 🌐 Internet, Wi-Fi e rede;
* 💻 Computadores e notebooks;
* 🖨️ Impressoras, copiadoras e scanners;
* 📺 TV, projetores, áudio e videoconferência;
* 🏫 Sistemas e plataformas escolares;
* 📧 E-mail, Drive e arquivos;
* 📱 Telefonia, WhatsApp e comunicação;
* ⌨️ Equipamentos e periféricos;
* ⚙️ Instalação e configuração;
* 🛡️ Segurança da informação;
* 📦 Reserva, empréstimo e aquisição;
* 🔧 Infraestrutura e mudança de ambiente;
* 👨‍💻 Atendimento com técnico.

---

# ⚠️ Classificação de prioridade

O usuário também informa o impacto da solicitação.

```text
🔴 Crítica
Escola, setor, aula ou evento parado ou situação com risco relevante.

🟠 Alta
Atividade importante comprometida e sem alternativa adequada.

🟡 Normal
Problema que ainda permite continuidade parcial do trabalho.

🟢 Baixa
Solicitação, melhoria, instalação ou orientação sem bloqueio imediato.
```

A classificação informada pelo usuário pode posteriormente ser revisada pela equipe técnica.

---

# 🎫 Protocolos

Cada chamado recebe automaticamente um protocolo semelhante a:

```text
TI-20260810-231530-A1B2
```

Estrutura:

```text
TI
│
├── Data
│
├── Horário
│
└── Identificador aleatório
```

O protocolo permite que o usuário consulte posteriormente sua solicitação.

Exemplo:

```text
status TI-20260810-231530-A1B2
```

---

# 🧠 Gerenciamento de sessões

Cada usuário possui uma sessão independente durante o atendimento.

Exemplo conceitual:

```javascript
{
    etapa: "categoria",
    nomeSolicitante: "Usuário",
    categoriaId: null,
    itemId: null,
    local: "",
    descricao: "",
    urgenciaId: null,
    anexos: []
}
```

As sessões são utilizadas para identificar em qual etapa do atendimento cada contato se encontra.

Também existe um mecanismo de expiração para evitar que atendimentos abandonados permaneçam ativos indefinidamente.

---

# 🔄 Fila de mensagens por contato

O projeto utiliza uma fila individual por usuário.

O objetivo é evitar problemas quando uma mesma pessoa envia várias mensagens rapidamente.

Exemplo:

```text
Usuário A → mensagem 1
Usuário A → mensagem 2
Usuário A → mensagem 3
```

As mensagens desse contato são processadas em sequência.

Ao mesmo tempo:

```text
Usuário B → mensagem
```

pode ser processado independentemente.

Essa estrutura reduz problemas de concorrência na atualização das sessões.

---

# 💾 Persistência de dados

Os chamados podem ser armazenados localmente para consulta posterior.

Na estrutura baseada em JSONL:

```text
dados/
├── chamados.jsonl
└── anexos/
```

Cada linha do arquivo representa um chamado em formato JSON.

Exemplo conceitual:

```json
{
  "protocolo": "TI-20260810-231530-A1B2",
  "status": "Aberto",
  "categoria": "Computador ou notebook",
  "servico": "Não liga",
  "local": "Sala de aula",
  "urgencia": "Alta"
}
```

---

# 📎 Anexos

Durante a descrição do problema, o usuário pode encaminhar materiais como:

* Capturas de tela;
* Imagens;
* Vídeos;
* PDFs;
* Documentos;
* Outros arquivos compatíveis.

Os arquivos são armazenados localmente e associados ao atendimento.

---

# 🛠️ Tecnologias utilizadas

* JavaScript;
* Node.js;
* whatsapp-web.js;
* Puppeteer;
* Git;
* npm;
* JSON;
* JSONL;
* File System API;
* Promises;
* Async/Await;
* Expressões regulares;
* Scripts Batch/PowerShell para Windows.

---

# 📦 Pré-requisitos

Antes de executar o projeto, tenha instalado:

* Node.js;
* npm;
* Google Chrome ou Chromium;
* Git, recomendado para desenvolvimento;
* Visual Studio Code, recomendado para estudo e manutenção.

Verifique:

```powershell
node -v
```

```powershell
npm -v
```

---

# 🚀 Instalação

Clone o repositório:

```powershell
git clone https://github.com/SEU-USUARIO/chatbot-suporte-ti-escolar.git
```

Entre na pasta:

```powershell
cd chatbot-suporte-ti-escolar
```

Instale as dependências:

```powershell
npm install
```

---

# ▶️ Executando

Inicie utilizando:

```powershell
npm start
```

Na primeira execução poderá ser necessário realizar o pareamento com o WhatsApp.

No celular:

```text
WhatsApp
→ Aparelhos conectados
→ Conectar um aparelho
```

Depois escaneie o QR Code apresentado pela aplicação.

---

# 🔐 Sessão do WhatsApp

Após o pareamento, informações de autenticação são armazenadas localmente.

Exemplo:

```text
.wwebjs_auth/
```

Essa pasta **não deve ser enviada para o GitHub**.

Ela está incluída no `.gitignore`.

---

# ⚙️ Configurações

Configurações específicas do ambiente podem ser informadas por variáveis.

Exemplo de `.env.example`:

```env
NOME_ESCOLA=
NOME_SETOR=Suporte de TI
NUMERO_EQUIPE_TI=
CHROME_PATH=
HEADLESS=
```

Crie localmente seu:

```text
.env
```

O `.env` real deve permanecer fora do Git.

---

# 📂 Estrutura do projeto

A estrutura pode variar conforme a evolução da aplicação.

Exemplo:

```text
chatbot-suporte-ti-escolar/
│
├── chatbot.js
├── package.json
├── package-lock.json
├── diagnostico.js
│
├── README.md
├── .gitignore
├── .env.example
│
├── scripts de inicialização/
│
├── dados/
│   ├── chamados.jsonl
│   └── anexos/
│
└── .wwebjs_auth/
```

Alguns diretórios existem somente durante a execução e não são versionados.

---

# 🖥️ Desenvolvimento com VS Code

O projeto também é utilizado como ambiente de aprendizado.

Fluxo recomendado:

```text
VS Code
   ↓
Criar branch
   ↓
Modificar
   ↓
Executar
   ↓
Depurar
   ↓
Revisar Git Diff
   ↓
Commit
   ↓
Push
```

Exemplo:

```powershell
git switch -c feature/nova-funcionalidade
```

Depois:

```powershell
git add .
git commit -m "feat: adiciona nova funcionalidade"
git push
```

---

# 🔍 Depuração

Durante o estudo e manutenção do projeto são utilizados recursos do debugger do VS Code, como:

* Breakpoints;
* Step Over;
* Step Into;
* Variables;
* Watch;
* Call Stack;
* Debug Console.

Pontos particularmente úteis para estudo:

```javascript
client.on("message", ...)
```

```javascript
processarMensagem(...)
```

```javascript
atualizarSessao(...)
```

```javascript
registrarChamado(...)
```

---

# 🔒 Segurança e privacidade

Este repositório **não deve conter informações reais de usuários ou da instituição**.

Não devem ser versionados:

```text
.env
.wwebjs_auth/
node_modules/
dados reais
bancos de produção
anexos enviados por usuários
logs contendo informações pessoais
credenciais
tokens
senhas
números privados
```

Dados usados para demonstração devem ser fictícios ou anonimizados.

---

# ⚠️ Observação sobre o WhatsApp

Este projeto utiliza uma integração baseada no WhatsApp Web.

Seu uso deve considerar as políticas e limitações da plataforma.

Para aplicações comerciais ou institucionais de missão crítica, deve-se avaliar a adoção de integrações oficiais disponibilizadas pela plataforma.

---

# 🤖 Uso de Inteligência Artificial

A implementação inicial e diferentes etapas de evolução deste projeto foram realizadas com **forte auxílio de ferramentas de Inteligência Artificial generativa**.

Minha participação esteve relacionada principalmente a:

* Identificação do problema;
* Definição do objetivo da solução;
* Levantamento de requisitos;
* Estruturação dos fluxos de atendimento;
* Definição das regras de negócio;
* Criação e refinamento de prompts;
* Testes;
* Identificação de erros;
* Validação das correções;
* Refinamento das funcionalidades.

Atualmente, o projeto também é utilizado como ambiente prático de aprendizado para aprofundar conhecimentos em:

* JavaScript;
* Node.js;
* Git e GitHub;
* Async/Await;
* Promises;
* Gerenciamento de estado;
* Manipulação de arquivos;
* Depuração;
* Testes;
* Arquitetura de software.

O objetivo é aumentar progressivamente minha autonomia sobre a aplicação, compreendendo, modificando, testando e evoluindo tecnicamente o código.

---

# 📚 Status do aprendizado

```text
Implementação inicial com apoio de IA
              ↓
Compreensão da arquitetura
              ↓
Estudo do código
              ↓
Debug e testes
              ↓
Alterações próprias
              ↓
Refatoração
              ↓
Maior autonomia no desenvolvimento
```

---

# 🗺️ Roadmap

Algumas evoluções planejadas:

* [ ] Ampliar cobertura de testes;
* [ ] Modularizar o `chatbot.js`;
* [ ] Separar regras de negócio da integração com WhatsApp;
* [ ] Melhorar tratamento de erros;
* [ ] Adicionar sistema estruturado de logs;
* [ ] Evoluir persistência para banco de dados;
* [ ] Criar painel para gerenciamento de chamados;
* [ ] Implementar atualização de status pela equipe de TI;
* [ ] Criar relatórios e indicadores;
* [ ] Documentar arquitetura;
* [ ] Avaliar integração com APIs oficiais;
* [ ] Aumentar progressivamente a participação direta no desenvolvimento.

---

# 🏷️ Versão

Versão atual:

```text
v1.7.0
```

O histórico das próximas evoluções será mantido através de commits, branches e tags no Git.

---

# 👨‍💻 Autor

**Thailan Lima**

Graduando em **Análise e Desenvolvimento de Sistemas**.

Interesses:

```text
Tecnologia da Informação
Suporte de TI
Desenvolvimento de Software
Automação
Back-end
Inteligência Artificial aplicada
```

---

## ⭐ Sobre este repositório

Este projeto representa não apenas uma solução de automação, mas também meu processo de evolução na área de desenvolvimento de software.

Cada nova versão busca aumentar minha compreensão técnica, autonomia e capacidade de transformar necessidades reais em soluções computacionais.
