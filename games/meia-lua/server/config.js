import 'dotenv/config';

function int(name, def, min, max) {
  const v = parseInt(process.env[name], 10);
  if (Number.isNaN(v)) return def;
  return Math.max(min, Math.min(max, v));
}

let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
try {
  if (process.env.ICE_SERVERS) iceServers = JSON.parse(process.env.ICE_SERVERS);
} catch {
  console.warn('[config] ICE_SERVERS inválido, usando STUN padrão.');
}

export const config = {
  port: int('PORT', 3000, 1, 65535),
  dbPath: process.env.DB_PATH || './data/game.sqlite',
  maxPlayersPerRoom: int('MAX_PLAYERS_PER_ROOM', 4, 1, 8),
  nightSeconds: int('NIGHT_SECONDS', 360, 30, 3600),
  maxRooms: int('MAX_ROOMS', 50, 1, 1000),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  iceServers,
  debug: process.env.DEBUG === '1',
};
