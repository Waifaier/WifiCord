# 🌐 WifiCord

### Conecte. Converse. Compartilhe.

Um aplicativo de comunicação em tempo real criado para reunir comunidades, amigos e conversas em um único lugar.

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-Backend-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-Realtime-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io/)
[![JavaScript](https://img.shields.io/badge/JavaScript-Frontend-F7DF1E?style=for-the-badge&logo=javascript&logoColor=000)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML5)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS3)

---

> 💬 **WifiCord** é uma plataforma de comunicação online focada em comunidades, grupos e conversas em tempo real.

🚧 **Em desenvolvimento**## 🌐 Sobre o WifiCord

O **WifiCord** é uma plataforma de comunicação em tempo real criada para aproximar pessoas através de conversas, comunidades e espaços personalizados.

A plataforma utiliza como referência a experiência proporcionada por aplicativos modernos de comunicação, trazendo conceitos como **servidores, canais, amizades e mensagens em tempo real**, mas construindo sua própria identidade e arquitetura.

O objetivo é oferecer um ambiente simples, rápido e organizado para que pessoas possam criar comunidades, conversar com amigos e participar de diferentes grupos.

### 💡 A ideia

Imagine ter um espaço onde você pode:

> 👥 Adicionar seus amigos  
> 🏠 Criar comunidades  
> 📢 Organizar canais  
> 💬 Conversar em tempo real  
> 🌐 Participar de diferentes servidores

Tudo dentro de uma única plataforma.

---

## ⚡ Comunicação em tempo real

O WifiCord foi desenvolvido pensando em comunicação instantânea.

As mensagens são transmitidas em tempo real entre os usuários através de uma arquitetura baseada em comunicação persistente entre cliente e servidor, proporcionando uma experiência muito mais dinâmica do que uma aplicação tradicional baseada apenas em requisições HTTP.

---

## 🎯 Nossa proposta

Criar uma plataforma de comunicação **simples, moderna e acessível**, permitindo que qualquer pessoa possa criar seu próprio espaço e reunir sua comunidade.

O WifiCord está sendo desenvolvido continuamente e novas funcionalidades podem ser adicionadas ao longo do tempo.## ✨ Funcionalidades

### 👤 Usuários

- 🔐 Sistema de autenticação
- 👤 Perfis de usuários
- 🤝 Sistema de amizades
- 💬 Comunicação entre usuários
- 🟢 Estrutura preparada para presença/status

### 🏠 Servidores

- 🏠 Criação de servidores
- 👥 Comunidades independentes
- 📢 Organização através de canais
- 🔧 Estrutura preparada para gerenciamento de comunidades

### 📢 Canais

Os servidores podem ser organizados através de canais, permitindo separar diferentes assuntos e conversas.

```text
🏠 Meu Servidor
│
├── 📢 geral
├── 💬 conversa
├── 🎮 jogos
└── 🔊 ...
### 4. Tecnologias

```markdown
## 🛠️ Tecnologias

O WifiCord utiliza tecnologias web modernas para construir sua experiência de comunicação.

| Tecnologia | Utilização |
|---|---|
| 🟨 JavaScript | Lógica da aplicação |
| 🟧 HTML5 | Estrutura da interface |
| 🟦 CSS3 | Estilização e responsividade |
| 🟢 Node.js | Ambiente do servidor |
| ⚫ Express.js | API e servidor web |
| 🔌 Socket.IO | Comunicação em tempo real |
| 🗄️ SQLite | Persistência dos dados |
| 📦 npm | Gerenciamento de dependências |
| 🐙 Git | Controle de versão |

### 🏗️ Arquitetura

```text
                 ┌─────────────────┐
                 │     WifiCord    │
                 └────────┬────────┘
                          │
                 ┌────────▼────────┐
                 │    Frontend     │
                 │ HTML CSS JS     │
                 └────────┬────────┘
                          │
                    Socket.IO
                          │
                 ┌────────▼────────┐
                 │     Backend     │
                 │    Node.js      │
                 │    Express      │
                 └────────┬────────┘
                          │
                 ┌────────▼────────┐
                 │    Database     │
                 │     SQLite      │
                 └─────────────────┘
### 6. Como funciona

```markdown
## 🧩 Como funciona

O WifiCord é dividido em diferentes áreas responsáveis pela experiência da plataforma.

### 👤 Usuário

Cada usuário possui sua própria identidade dentro da plataforma, podendo interagir com outros usuários e participar de comunidades.

### 🏠 Servidores

Servidores funcionam como espaços independentes onde grupos podem se reunir.

Um servidor pode representar:

- 🎮 Uma comunidade gamer
- 👨‍💻 Uma comunidade de programação
- 🎵 Um grupo de música
- 📚 Uma comunidade de estudos
- 👥 Um grupo privado de amigos

### 📢 Canais

Dentro de cada servidor, os canais ajudam a organizar as conversas.

Isso evita que diferentes assuntos fiquem misturados em uma única conversa.

### 💬 Comunicação

Quando um usuário envia uma mensagem, o sistema utiliza comunicação em tempo real para transmitir a informação aos outros usuários conectados ao mesmo espaço.

```text
Usuário A
    │
    │ envia mensagem
    ▼
WifiCord Server
    │
    │ Socket.IO
    ▼
Usuário B ──── Usuário C
