// Meia-Lua: Turno da Noite — servidor principal
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { config } from './config.js';
import './database/db.js';
import { apiRouter } from './routes/api.js';
import { RoomManager } from './game/RoomManager.js';
import { registerSockets } from './sockets/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'microphone=(self)');
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') },
  maxHttpBufferSize: 32 * 1024,
  pingInterval: 10000,
  pingTimeout: 8000,
});

const rooms = new RoomManager(io);

app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.rooms.size, uptime: Math.round(process.uptime()) }));
app.use('/api', apiRouter(rooms));
app.use('/shared', express.static(path.join(root, 'shared'), { maxAge: 0, etag: true }));
app.use(express.static(path.join(root, 'client'), { maxAge: 0, etag: true, extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(root, 'client', 'index.html')));

registerSockets(io, rooms);

server.listen(config.port, () => {
  console.log(`\n🌙 Meia-Lua: Turno da Noite rodando em http://localhost:${config.port}`);
  console.log(`   Noite = ${config.nightSeconds}s · até ${config.maxPlayersPerRoom} jogadores por sala\n`);
});

function shutdown() {
  console.log('\nEncerrando...');
  for (const r of rooms.rooms.values()) {
    if (r.match && !r.match.ended) r.match.endMatch('aborted', 'server');
  }
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
