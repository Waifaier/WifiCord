require('dotenv').config();

const { restoreFromRemote, startAutoBackup } = require('./database/remoteBackup');

// Tudo que toca o banco (rotas, sockets, sessão, bootstrap do admin) só
// pode ser exigido (require) DEPOIS que um eventual snapshot do Turso for
// restaurado pro disco local — o db.js abre o arquivo .db na hora do
// require, então a ordem aqui importa. Por isso o app inteiro nasce
// dentro deste bootstrap assíncrono, em vez de tudo solto no topo do
// arquivo como antes.
async function bootstrap() {
  await restoreFromRemote();

  const path = require('path');
  const crypto = require('crypto');
  const express = require('express');
  const session = require('express-session');
  const SqliteSessionStore = require('./session/SqliteSessionStore');
  const compression = require('./middleware/compress');
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
  const pushRouter = require('./routes/push');
  const { initSockets } = require('./sockets');

  // Identificador único gerado a cada vez que o processo sobe (cada deploy
  // no Render reinicia o processo). O app desktop usa isso pra descobrir
  // que existe uma versão mais nova rodando e avisar o usuário.
  const SERVER_BOOT_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // O index.html referencia /js/*.js e /css/*.css com nomes fixos, e esses
  // arquivos são servidos com cache de 1 dia (ver staticOpts abaixo) pra não
  // rebaixar o app com um round-trip a cada reload. O problema: sem isso,
  // depois de um deploy novo o navegador de quem já usava o site continuava
  // com a versão ANTIGA de call.js/style.css guardada até o cache expirar —
  // "o Render mostra que fez deploy mas o site não muda" era exatamente
  // esse cache. A correção é colocar `?v=<SERVER_BOOT_ID>` em cada
  // src/href local: como o boot id muda a cada deploy, o navegador enxerga
  // uma URL nova e busca o arquivo de novo, mesmo com os headers de cache
  // antigos intactos — sem precisar de Ctrl+F5. Só o index.html em si
  // precisa ser servido sem cache (abaixo) pra essa URL versionada chegar.
  const fs = require('fs');
  const INDEX_HTML = fs
    .readFileSync(path.join(__dirname, '..', 'client', 'index.html'), 'utf8')
    .replace(/(src|href)="(\/(?:js|css)\/[^"?]+)"/g, (_, attr, url) => `${attr}="${url}?v=${SERVER_BOOT_ID}"`);

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

  // Compressão (gzip/br) do HTML/CSS/JS/JSON: reduz bastante o volume de dados
  // trafegado no celular e acelera o carregamento, sem exigir dependências novas.
  app.use(compression());

  app.use(express.json({ limit: '10mb' }));
  app.use(sessionMiddleware);

  // Serve o index.html (já com ?v=<bootId> nos src/href — ver INDEX_HTML
  // acima) SEM cache, sempre direto do processo atual. Tem que vir ANTES do
  // express.static abaixo: senão o próprio express.static intercepta "/" e
  // "/index.html" e volta a servir a versão antiga com cache de 1 dia,
  // anulando o cache-busting.
  app.get(['/', '/index.html'], (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(INDEX_HTML);
  });

  // Cache agressivo para os arquivos estáticos do client (css/js/imagens).
  // O navegador para de rebaixar o app com um round-trip a cada reload:
  // passa a usar a cópia local por até 1 dia e ainda revalida por ETag.
  // Seguro porque cada deploy muda a URL (?v=) referenciada pelo
  // index.html acima, então uma versão nova nunca fica presa atrás do
  // cache de uma URL antiga.
  const staticOpts = { maxAge: '1d', etag: true, lastModified: true };
  app.use(express.static(path.join(__dirname, '..', 'client'), staticOpts));

  // Arquivos enviados por usuários (uploads) nunca devem ser interpretados
  // como HTML/JS pelo navegador, mesmo que algum arquivo antigo tenha
  // ficado salvo com uma extensão inesperada. Qualquer extensão fora desta
  // lista de mídia conhecida é servida como download genérico, nunca inline.
  const UPLOADS_INLINE_SAFE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
    '.mp4', '.webm', '.mov', '.mkv',
    '.mp3', '.ogg', '.wav', '.pdf',
  ]);
  app.use('/uploads', express.static(UPLOAD_DIR, {
    maxAge: '7d',
    index: false,
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (!UPLOADS_INLINE_SAFE_EXTENSIONS.has(ext)) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
  }));

  app.use('/api/auth', authRouter);
  app.use('/api/friends', friendsRouter);
  app.use('/api/servers', serversRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/economy', economyRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api/webrtc', webrtcRouter);
  app.use('/api/push', pushRouter);

  // Usado pelo app desktop pra detectar quando uma nova versão foi
  // publicada (ver desktop-app/main.js). Sem cache nenhum de propósito.
  app.get('/api/version', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ bootId: SERVER_BOOT_ID });
  });

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(INDEX_HTML);
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
    // Só começa a mandar backups periódicos pro Turso depois que o
    // servidor já está de pé (e só faz alguma coisa se TURSO_DATABASE_URL
    // estiver configurada — senão é no-op).
    startAutoBackup();
  });
}

bootstrap().catch((err) => {
  console.error('❌ Falha ao iniciar o servidor:', err);
  process.exit(1);
});
