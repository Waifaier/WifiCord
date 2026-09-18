require('dotenv').config();

const { restoreFromRemote, startAutoBackup, restoreExtraFile, registerExtraFile } = require('./database/remoteBackup');

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
  const { SQLITE_PATH, UPLOAD_DIR } = require('./storage');
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
  const moderationRouter = require('./routes/moderation');
  const announcementsRouter = require('./routes/announcements');
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
  app.use('/api/moderation', moderationRouter);
  app.use('/api/announcements', announcementsRouter);

  // -------------------------------------------------------------------
  // Jogos > Meia-Lua: Turno da Noite — roda dentro deste MESMO processo e
  // porta (obrigatório pro plano atual do Render), num namespace Socket.IO
  // separado (/meia-lua) e API própria (/api/meia-lua). O jogo em si é
  // ESM ("type":"module" só dentro de games/meia-lua/ — o resto do
  // WifiCord continua CommonJS igual sempre foi), então é carregado com
  // import() dinâmico em vez de require(); ver games/meia-lua/server/
  // integration.js pros detalhes de como ele se encaixa no app/io daqui.
  // Banco totalmente separado do chat.db, mas na mesma pasta. IMPORTANTE:
  // o Render não tem Persistent Disk de verdade aqui — quem faz o chat.db
  // sobreviver a redeploy/restart é o backup remoto pro Turso (ver
  // server/database/remoteBackup.js). Esse backup só cobria o chat.db até
  // agora, então o meia-lua.sqlite nascia zerado a cada reinício do
  // processo — era exatamente o "progresso do jogo sempre volta pro
  // level 1" relatado. As duas linhas abaixo (restore antes de montar,
  // registro do backup depois) estendem o mesmo mecanismo pro banco do
  // jogo, sem mexer no que já funciona pro chat.
  const meiaLuaDbPath = path.join(path.dirname(SQLITE_PATH), 'meia-lua.sqlite');
  await restoreExtraFile(meiaLuaDbPath, 'meia-lua');
  const { mountMeiaLua } = await import('../games/meia-lua/server/integration.js');
  const meiaLua = await mountMeiaLua({ app, io, dbPath: meiaLuaDbPath });
  registerExtraFile(meiaLuaDbPath, 'meia-lua', () => {
    // Descarrega o WAL do SQLite do jogo pro arquivo principal antes do
    // backup ler os bytes — mesma ideia do checkpoint do chat.db logo
    // abaixo em backupToRemote(), só que aqui a conexão é a do jogo
    // (ESM, aberta dentro de mountMeiaLua), por isso o callback em vez de
    // um require direto.
    meiaLua.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  });
  // A ponte de login único (/api/meia-lua/session, usa a sessão do
  // WifiCord) precisa ser montada ANTES do router do próprio jogo — os
  // dois ficam no mesmo prefixo /api/meia-lua, e o router do jogo termina
  // com um catch-all 404 que nunca repassa adiante pro Express tentar o
  // próximo (ver o comentário sobre isso em integration.js).
  const { createMeiaLuaBridgeRouter } = require('./routes/meiaLua');
  app.use('/api/meia-lua', createMeiaLuaBridgeRouter({ accounts: meiaLua.accounts }));
  app.use('/api/meia-lua', meiaLua.apiRouter);

  // Painel Admin do Meia-Lua — rota própria FORA de /jogos/meia-lua (que é
  // servida sem autenticação nenhuma pro jogo em si) e fora de /api/meia-
  // lua (a API pública do jogo). Protegida por requireAuth+admin dentro do
  // próprio router (ver server/routes/meiaLuaAdmin.js) — tanto a página
  // quanto toda chamada de API exigem sessão de administrador de verdade.
  const { createMeiaLuaAdminRouter } = require('./routes/meiaLuaAdmin');
  app.use('/admin/meia-lua', createMeiaLuaAdminRouter({ adminBridge: meiaLua.admin }));

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

  // ---------------------------------------------------------------------
  // DIAGNÓSTICO TEMPORÁRIO — o processo está sendo morto por estourar
  // 512MB no Render (free tier), mas o gráfico de memória de verdade
  // ("Application Metrics") só existe no plano pago. Esse log aparece nos
  // Logs normais (grátis) a cada 15s e mostra os números reais de memória
  // do processo Node, junto com quantos sockets estão conectados agora —
  // isso é o que vai mostrar se é um vazamento subindo aos poucos ou um
  // pico ligado a uma ação específica. Tirar esse bloco assim que a causa
  // for encontrada.
  const memLogTimer = setInterval(() => {
    const m = process.memoryUsage();
    const mb = n => (n / 1024 / 1024).toFixed(1);
    const clients = io.engine?.clientsCount ?? '?';
    console.log(
      `📊 [mem] rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB heapTotal=${mb(m.heapTotal)}MB ` +
      `external=${mb(m.external)}MB arrayBuffers=${mb(m.arrayBuffers)}MB sockets=${clients}`
    );
  }, 15000);
  if (typeof memLogTimer.unref === 'function') memLogTimer.unref();
}

bootstrap().catch((err) => {
  console.error('❌ Falha ao iniciar o servidor:', err);
  process.exit(1);
});
