// Ponto de entrada usado pelo WifiCord (server/server.js, CommonJS) para
// montar o Meia-Lua: Turno da Noite dentro do MESMO processo/porta, via
// import() dinâmico (ver comentário grande em server/server.js do
// WifiCord). Este arquivo é ESM porque o resto do jogo é ESM — é o único
// arquivo novo criado especificamente para a integração; tudo mais aqui
// dentro (config.js, database/, game/, sockets/, routes/api.js) é a cópia
// do jogo original, só com os ajustes mínimos documentados em cada arquivo
// (import() dinâmico não exige reescrever nada em CommonJS).
//
// Import()s de config.js/database/db.js ficam DENTRO de mountMeiaLua (não
// no topo do arquivo) de propósito: db.js lê `config.dbPath` e abre o
// arquivo .sqlite na hora em que é importado pela primeira vez — então
// `process.env.DB_PATH` precisa estar setado ANTES desse import, e isso só
// dá pra garantir depois que mountMeiaLua() já recebeu o dbPath calculado
// pelo WifiCord (mesma pasta do SQLITE_PATH do chat — ver storage.js).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(__dirname, '..'); // .../games/meia-lua

/**
 * @param {object} opts
 * @param {import('express').Express} opts.app - app Express do WifiCord
 * @param {import('socket.io').Server} opts.io - servidor Socket.IO do WifiCord (raiz)
 * @param {string} opts.dbPath - caminho absoluto do meia-lua.sqlite
 * @returns {Promise<{ rooms: any, config: any, accounts: any, db: any }>}
 *   `accounts` é o módulo database/accounts.js já carregado — o WifiCord
 *   passa ele pra server/routes/meiaLua.js (a ponte de sessão), pra não
 *   precisar dar outro import() e arriscar carregar o db.js antes do
 *   DB_PATH estar setado.
 *   `db` (a conexão SQLite aberta, de database/db.js) é devolvida pro
 *   WifiCord poder rodar um `PRAGMA wal_checkpoint` antes de mandar o
 *   arquivo .sqlite pro backup remoto (ver server/database/remoteBackup.js
 *   e o registerExtraFile em server.js) — sem isso o snapshot enviado
 *   pode ficar sem as escritas mais recentes, que só existem no -wal.
 */
export async function mountMeiaLua({ app, io, dbPath }) {
  if (dbPath) process.env.DB_PATH = dbPath;

  const { config } = await import('./config.js');
  const { db } = await import('./database/db.js'); // cria as tabelas + roda a migração aditiva (wificord_user_id)
  const accounts = await import('./database/accounts.js');
  const { RoomManager } = await import('./game/RoomManager.js');
  const { registerSockets } = await import('./sockets/index.js');
  const { apiRouter } = await import('./routes/api.js');
  const { createAdminBridge } = await import('./adminBridge.js');

  // Namespace próprio no MESMO servidor Socket.IO do WifiCord — o chat e as
  // chamadas continuam exclusivamente no namespace padrão "/", sem
  // nenhuma interferência (middlewares/eventos de um namespace não valem
  // pro outro). Ver client/js/main.js (window.io('/meia-lua', ...)).
  const namespace = io.of('/meia-lua');
  const rooms = new RoomManager(namespace);
  registerSockets(namespace, rooms);
  // Painel Admin do Meia-Lua (ver server/adminBridge.js) — opera na MESMA
  // instância viva de `rooms` de cima; devolvido pro WifiCord igual
  // accounts/apiRouter já eram, pro router CJS novo (server/routes/
  // meiaLuaAdmin.js) poder chamar essas funções sem outro import().
  const admin = createAdminBridge(rooms);

  const clientDir = path.join(gameRoot, 'client');
  const sharedDir = path.join(gameRoot, 'shared');
  // maxAge 0 + etag, exatamente como pedido — sem isso o navegador segura
  // versões antigas do JS/CSS do jogo depois de um deploy novo.
  const staticOpts = { maxAge: 0, etag: true };

  // /shared ANTES de /jogos/meia-lua (senão o static do client, montado no
  // prefixo mais curto, nunca deixaria a requisição chegar no de /shared).
  app.use('/jogos/meia-lua/shared', express.static(sharedDir, staticOpts));
  app.use('/jogos/meia-lua', express.static(clientDir, staticOpts));
  // O client é uma SPA de tela única (div-based, sem roteamento por URL),
  // então só precisa servir o index.html na raiz do jogo — não um
  // catch-all `/jogos/meia-lua/*` como o server.js original do jogo tinha
  // (aquele existia pra cobrir qualquer sub-rota; aqui os arquivos
  // estáticos acima já cobrem tudo que existe de verdade).
  app.get(['/jogos/meia-lua', '/jogos/meia-lua/'], (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDir, 'index.html'));
  });

  // IMPORTANTE sobre ordem de montagem: devolvemos o router em vez de
  // montá-lo aqui dentro. O WifiCord precisa montar a PONTE de sessão dele
  // (server/routes/meiaLua.js, rota /api/meia-lua/session) ANTES deste
  // router do jogo — como os dois ficam no mesmo prefixo /api/meia-lua, o
  // Express tenta cada `app.use` na ordem em que foi registrado, e este
  // router do jogo termina com um catch-all 404 (ver routes/api.js) que
  // nunca repassa adiante. Se ele fosse montado primeiro, /session cairia
  // nesse 404 antes de chegar na ponte. Ver server/server.js no WifiCord.
  const apiRouterInstance = apiRouter(rooms);

  console.log(`[meia-lua] montado em /jogos/meia-lua · API em /api/meia-lua · socket.io namespace /meia-lua · banco: ${dbPath}`);

  return { rooms, config, accounts, apiRouter: apiRouterInstance, db, admin };
}
