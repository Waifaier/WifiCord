# WifiCord

Aplicativo de chat em tempo real com Node.js, Express, Socket.IO e SQLite.

## Executar

```bash
npm install
npm start
```

O servidor usa `process.env.PORT` (com fallback local para `3000`) e escuta em
`0.0.0.0`, permitindo acesso pela Preview/Webview do Replit. A aplicação serve
o frontend em `client/` e cria o banco SQLite em `server/database/chat.db`.

## Preferências do usuário

- Preservar Node.js + Express + SQLite + Socket.IO.
- Preservar autenticação por sessão e o frontend HTML/CSS/JavaScript.
- Usar URLs relativas para as chamadas do frontend e a conexão Socket.IO.