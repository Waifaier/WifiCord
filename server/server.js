require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SqliteSessionStore = require('./session/SqliteSessionStore');
const { UPLOAD_DIR } = require('./storage');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');

const { router: authRouter } = require('./routes/auth');
const friendsRouter = require('./routes/friends');
const serversRouter = require('./routes/servers');
const messagesRouter = require('./routes/messages');
const economyRouter = require('./routes/economy');
const bootstrapAdmin = require('../scripts/admin-bootstrap');
const adminRouter = require('./routes/admin');
const mediaRouter = require('./routes/media');
const gamesRouter = require('./routes/games');
const webrtcRouter = require('./routes/webrtc');
const { initSockets } = require('./sockets');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
if (NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET é obrigatório em produção.');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Ativa o primeiro administrador através da variável ADMIN_USERNAME
bootstrapAdmin();

const app = express();
if (NODE_ENV === 'production') app.set('trust proxy', 1);
app.disable('x-powered-by'); // não anuncia o framework/versão do backend nos headers
const server = http.createServer(app);
const io = new SocketIOServer(server);
app.set('io', io);

// Headers básicos de segurança/privacidade. Nada de CSP aqui: o app carrega
// o socket.io via CDN (cdnjs) e uma CSP mal calibrada quebraria isso.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// 🔧 CORRIGIDO: Sessão com duração MUITO MAIOR (90 dias em vez de 7)
const sessionMiddleware = session({
  store: new SqliteSessionStore({
    cleanupIntervalMs: 60 * 60 * 1000, // Limpeza a cada 1 hora (não 15 min)
  }),
  secret: SESSION_SECRET,
  resave: true, // ✅ IMPORTANTE: true para renovar sessão a cada requisição
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // ✨ NOVO: Aumentado de 7 dias para 90 dias
    maxAge: 90 * 24 * 60 * 60 * 1000, // 90 dias
    secure: NODE_ENV === 'production',
    sameSite: 'strict', // Segurança adicional
  },
});

app.use(express.json({ limit: '10mb' }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));

app.use('/api/auth', authRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/servers', serversRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/economy', economyRouter);
app.use('/api/admin', adminRouter);
app.use('/api/media', mediaRouter);
app.use('/api/games', gamesRouter);
app.use('/api/webrtc', webrtcRouter);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Arquivo(s) muito grande(s). Escolha uma imagem menor e tente novamente.' });
  }
  const status = Number(err && (err.status || err.statusCode)) || 500;
  if (status < 500 && err && err.message) {
    return res.status(status).json({ error: err.message });
  }
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

io.engine.use(sessionMiddleware);
initSockets(io);

server.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em ${HOST}:${PORT}`);
  console.log(`✅ Sessões configuradas com duração de 90 dias`);
});
