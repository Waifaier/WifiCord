// Eventos Socket.IO — toda mensagem do cliente é tratada como não confiável.
import { accountIdFromToken, getAccount } from '../database/accounts.js';
import { config } from '../config.js';
import { DIFFICULTIES } from '../../shared/nights.js';

// Limitador simples por socket/evento (token bucket)
function limiter(ratePerSec, burst) {
  return { tokens: burst, last: Date.now(), rate: ratePerSec, burst };
}
function allow(l) {
  const now = Date.now();
  l.tokens = Math.min(l.burst, l.tokens + ((now - l.last) / 1000) * l.rate);
  l.last = now;
  if (l.tokens < 1) return false;
  l.tokens -= 1;
  return true;
}

const LIMITS = {
  input: [30, 12],
  interact: [6, 4],
  chat: [1.5, 4],
  room: [2, 5],
  action: [8, 6],
  voice: [40, 60],
};

export function registerSockets(io, rooms) {
  const socketsByAccount = new Map();

  io.use((socket, next) => {
    const accountId = accountIdFromToken(socket.handshake.auth?.token);
    if (!accountId) return next(new Error('unauthorized'));
    socket.data.accountId = accountId;
    next();
  });

  io.on('connection', (socket) => {
    const accountId = socket.data.accountId;
    const lim = Object.fromEntries(Object.entries(LIMITS).map(([k, [r, b]]) => [k, limiter(r, b)]));

    // Uma conexão por conta
    const old = socketsByAccount.get(accountId);
    if (old && old.id !== socket.id) {
      old.emit('session:replaced');
      old.disconnect(true);
    }
    socketsByAccount.set(accountId, socket);

    const on = (event, kind, handler) => {
      socket.on(event, (data, ack) => {
        if (!allow(lim[kind])) { if (typeof ack === 'function') ack({ ok: false, error: 'Calma! Muitas ações.' }); return; }
        try {
          const r = handler(data ?? {});
          if (typeof ack === 'function') ack({ ok: true, ...(r || {}) });
        } catch (err) {
          if (typeof ack === 'function') ack({ ok: false, error: err.message || 'Erro' });
        }
      });
    };

    const account = () => {
      const acc = getAccount(accountId);
      if (!acc) throw new Error('Conta não encontrada.');
      return acc;
    };
    const matchOf = () => {
      const r = rooms.roomOf(accountId);
      return r && r.match && !r.match.ended && r.match.hasPlayer(accountId) ? r.match : null;
    };

    // Se estava em uma sala (reconexão), reentra automaticamente
    const prevRoom = rooms.roomOf(accountId);
    if (prevRoom) {
      try { rooms.join(socket, account(), prevRoom.code); socket.emit('room:rejoined', prevRoom.view()); } catch { /* ignora */ }
    }

    // ---------------- Salas ----------------
    on('room:create', 'room', (d) => {
      const room = rooms.create(socket, account(), { night: d.night, maxPlayers: d.maxPlayers, isPublic: d.isPublic, difficulty: String(d.difficulty || '') });
      return { room: room.view() };
    });
    on('room:join', 'room', (d) => {
      const room = rooms.join(socket, account(), d.code);
      return { room: room.view() };
    });
    on('room:leave', 'room', () => { rooms.leave(accountId); socket.emit('voice:reset'); });
    on('room:list', 'room', () => ({ rooms: rooms.publicRooms() }));
    on('room:ready', 'room', (d) => {
      const r = rooms.roomOf(accountId);
      if (!r || r.state !== 'lobby') throw new Error('Fora do lobby.');
      r.members.get(accountId).ready = !!d.ready;
      r.broadcastState();
    });
    on('room:config', 'room', (d) => {
      const r = rooms.roomOf(accountId);
      if (!r || r.hostId !== accountId || r.state !== 'lobby') throw new Error('Só o anfitrião no lobby.');
      const acc = account();
      if (d.night !== undefined) {
        const n = Math.floor(Number(d.night));
        if (!(n >= 1 && n <= acc.maxNight)) throw new Error('Noite ainda não liberada para o anfitrião.');
        r.night = n;
      }
      if (d.maxPlayers !== undefined) {
        const mp = Math.floor(Number(d.maxPlayers));
        if (!(mp >= Math.max(1, r.size) && mp <= config.maxPlayersPerRoom)) throw new Error('Limite inválido.');
        r.maxPlayers = mp;
      }
      if (d.isPublic !== undefined) r.isPublic = !!d.isPublic;
      if (d.difficulty !== undefined) {
        if (!DIFFICULTIES[d.difficulty]) throw new Error('Dificuldade inválida.');
        r.difficulty = d.difficulty;
      }
      for (const m of r.members.values()) m.ready = false;
      r.broadcastState();
    });
    on('room:kick', 'room', (d) => {
      const r = rooms.roomOf(accountId);
      if (!r || r.hostId !== accountId) throw new Error('Só o anfitrião.');
      const target = Number(d.id);
      if (target === accountId || !r.members.has(target)) throw new Error('Jogador inválido.');
      const m = r.members.get(target);
      io.to(m.socketId).emit('room:kicked');
      rooms.leave(target, 'foi removido pelo anfitrião');
    });
    on('room:start', 'room', () => {
      const r = rooms.roomOf(accountId);
      if (!r) throw new Error('Você não está em uma sala.');
      r.start(accountId);
    });

    // ---------------- Chat ----------------
    on('chat:send', 'chat', (d) => {
      const r = rooms.roomOf(accountId);
      if (!r) throw new Error('Sem sala.');
      const text = String(d.text ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
      if (!text) return;
      const m = r.members.get(accountId);
      r.pushChat({ from: accountId, name: m?.name || '???', text, ts: Date.now() });
    });

    // ---------------- Partida ----------------
    socket.on('input', (d) => {
      if (!allow(lim.input)) return;
      matchOf()?.queueInput(accountId, d);
    });
    on('interact', 'interact', (d) => { matchOf()?.interact(accountId, typeof d.target === 'string' ? d.target.slice(0, 40) : null); });
    on('flashlight', 'action', () => { matchOf()?.toggleFlashlight(accountId); });
    socket.on('breath', (d) => { if (!allow(lim.action)) return; matchOf()?.setBreath(accountId, !!d?.hold); });
    on('useItem', 'action', (d) => { matchOf()?.useItem(accountId, String(d.item || '')); });
    on('equip', 'action', (d) => { matchOf()?.equip(accountId, String(d.item || '')); });
    on('unequip', 'action', (d) => { matchOf()?.unequip(accountId, String(d.slot || '')); });
    on('camera', 'action', (d) => { matchOf()?.setCamera(accountId, d.cam === null ? null : String(d.cam || '')); });
    on('remoteDoor', 'interact', (d) => { matchOf()?.remoteDoor(accountId, String(d.door || '')); });
    on('match:leave', 'room', () => {
      const r = rooms.roomOf(accountId);
      const m = matchOf();
      if (r && m) { m.removePlayer(m.players.get(accountId), 'left'); r.broadcastState(); }
    });

    // ---------------- Voz (sinalização WebRTC) ----------------
    on('voice:join', 'voice', () => {
      const r = rooms.roomOf(accountId);
      if (!r) throw new Error('Sem sala.');
      socket.data.voice = true;
      socket.to(r.channel).emit('voice:peer-joined', { id: accountId });
      const peers = [...r.members.values()]
        .filter((m) => m.id !== accountId && io.sockets.sockets.get(m.socketId)?.data.voice)
        .map((m) => m.id);
      return { peers };
    });
    on('voice:leave', 'voice', () => {
      socket.data.voice = false;
      const r = rooms.roomOf(accountId);
      if (r) socket.to(r.channel).emit('voice:peer-left', { id: accountId });
    });
    socket.on('voice:signal', (d) => {
      if (!allow(lim.voice) || !d || typeof d !== 'object') return;
      const r = rooms.roomOf(accountId);
      const target = r?.members.get(Number(d.to));
      if (!target) return;
      const payload = JSON.stringify(d.data ?? null);
      if (payload.length > 16000) return;
      io.to(target.socketId).emit('voice:signal', { from: accountId, data: d.data });
    });

    socket.on('disconnect', () => {
      if (socketsByAccount.get(accountId) === socket) socketsByAccount.delete(accountId);
      rooms.onDisconnect(accountId, socket.id);
    });
  });
}
