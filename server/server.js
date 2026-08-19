const path = require('path');
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');

const { router: authRouter } = require('./routes/auth');
const friendsRouter = require('./routes/friends');
const serversRouter = require('./routes/servers');
const messagesRouter = require('./routes/messages');
const economyRouter = require('./routes/economy');
const adminRouter = require('./routes/admin');
const mediaRouter = require('./routes/media');
const gamesRouter = require('./routes/games');
const { initSockets } = require('./sockets');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

if (NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET é obrigatório em produção.');
}

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);
app.set('io', io);

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: NODE_ENV === 'production',
  },
});

app.use(express.json({ limit: '3mb' }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d', index: false }));

app.use('/api/auth', authRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/servers', serversRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/economy', economyRouter);
app.use('/api/admin', adminRouter);
app.use('/api/media', mediaRouter);
app.use('/api/games', gamesRouter);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

io.engine.use(sessionMiddleware);
initSockets(io);

server.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em ${HOST}:${PORT}`);
});
