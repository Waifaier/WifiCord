// Salas, lobby e ciclo de partidas.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { Match } from './Match.js';
import { getAccount } from '../database/accounts.js';
import { NIGHTS, FINAL_NIGHT, DIFFICULTIES, DEFAULT_DIFFICULTY } from '../../shared/nights.js';
import { fala } from '../../shared/falas.js';

const CODE_PREFIX = 'NOITE';

export class Room {
  constructor(manager, code, host, opts) {
    this.manager = manager;
    this.io = manager.io;
    this.code = code;
    this.channel = `room:${code}`;
    this.hostId = host.id;
    this.maxPlayers = opts.maxPlayers;
    this.night = opts.night;
    this.isPublic = !!opts.isPublic;
    this.difficulty = DIFFICULTIES[opts.difficulty] ? opts.difficulty : DEFAULT_DIFFICULTY;
    // Modo de jogo (pedido #28: seletor de modo na criação de sala) —
    // 'normal' (padrão, o jogo de sempre) ou 'animatronic' (ver
    // shared/animatronicMode.js e Match.js). Qualquer outro valor cai em
    // 'normal' por segurança — nunca confiar cegamente no que o cliente
    // manda em opts.mode.
    this.mode = opts.mode === 'animatronic' ? 'animatronic' : 'normal';
    this.state = 'lobby';
    this.members = new Map(); // accountId -> { id, name, level, maxNight, ready, socketId, online }
    this.chat = [];
    this.match = null;
    this.lastResult = null;
    this.createdAt = Date.now();
  }

  get size() { return this.members.size; }

  view() {
    return {
      code: this.code,
      hostId: this.hostId,
      maxPlayers: this.maxPlayers,
      night: this.night,
      nightTitle: NIGHTS[this.night].title,
      isPublic: this.isPublic,
      difficulty: this.difficulty,
      state: this.state,
      members: [...this.members.values()].map((m) => ({
        id: m.id, name: m.name, level: m.level, ready: m.ready || m.id === this.hostId, online: m.online, maxNight: m.maxNight,
        inMatch: !!this.match?.hasPlayer(m.id),
      })),
      hostMaxNight: this.members.get(this.hostId)?.maxNight || 1,
      mode: this.mode,
    };
  }

  broadcastState() {
    this.io.to(this.channel).emit('room:update', this.view());
  }

  addMember(socket, account) {
    const m = {
      id: account.id, name: account.displayName, level: account.level, maxNight: account.maxNight,
      ready: false, socketId: socket.id, online: true,
    };
    this.members.set(account.id, m);
    socket.join(this.channel);
    this.systemMessage(fala('rEntrou', { nome: m.name }));
    this.broadcastState();
    socket.emit('chat:history', this.chat);
  }

  removeMember(accountId, reason = 'saiu') {
    const m = this.members.get(accountId);
    if (!m) return;
    if (this.match && !this.match.ended) {
      const p = this.match.players.get(accountId);
      if (p) this.match.removePlayer(p, reason);
    }
    this.members.delete(accountId);
    // MOTIVO RAIZ de um crash do processo inteiro (não só do jogo — chat e
    // chamadas junto, já que é tudo o mesmo processo): `this.io` aqui é o
    // NAMESPACE '/meia-lua' (io.of('/meia-lua') — ver integration.js), não
    // o Server raiz. Num Namespace do Socket.IO v4, `.sockets` já É o Map
    // de sockets conectados — `io.sockets.sockets` (com dois `.sockets`)
    // só existe no Server raiz, onde `.sockets` devolve o namespace "/" e
    // O SEU `.sockets` é que é o Map. Aqui, `this.io.sockets` (o Map) não
    // tem propriedade `.sockets` nenhuma — dava `undefined.get(...)`, um
    // TypeError que não tinha try/catch em volta (roda dentro de um
    // Timeout — ver o `setTimeout` que chama isso lá embaixo) e derrubava
    // o processo Node inteiro sempre que alguém saía de uma sala com outra
    // pessoa ainda dentro.
    const s = this.io.sockets.get(m.socketId);
    if (s) { s.leave(this.channel); s.emit('voice:reset'); }
    this.io.to(this.channel).emit('voice:peer-left', { id: accountId });
    if (!this.members.size) { this.manager.deleteRoom(this); return; }
    if (this.hostId === accountId) {
      const next = [...this.members.values()].find((x) => x.online) || [...this.members.values()][0];
      this.hostId = next.id;
      this.systemMessage(fala('rChefe', { nome: next.name }));
    }
    this.systemMessage(`${m.name} ${reason}.`);
    this.broadcastState();
  }

  systemMessage(text, glitch = false) {
    const msg = { system: true, glitch, text: String(text).slice(0, 240), ts: Date.now() };
    this.pushChat(msg);
  }

  pushChat(msg) {
    this.chat.push(msg);
    if (this.chat.length > 40) this.chat.shift();
    this.io.to(this.channel).emit('chat', msg);
  }

  async refreshMember(accountId) {
    const m = this.members.get(accountId);
    const acc = getAccount(accountId);
    if (m && acc) { m.name = acc.displayName; m.level = acc.level; m.maxNight = acc.maxNight; }
  }

  start(byId) {
    if (byId !== this.hostId) throw new Error('Só o anfitrião pode iniciar.');
    if (this.state !== 'lobby') throw new Error('A partida já começou.');
    const online = [...this.members.values()].filter((m) => m.online);
    const notReady = online.filter((m) => m.id !== this.hostId && !m.ready);
    if (notReady.length) throw new Error(`Aguardando: ${notReady.map((m) => m.name).join(', ')}`);
    if (this.mode === 'animatronic' && online.length < 2) throw new Error('Modo Animatronic precisa de pelo menos 2 jogadores.');
    const participants = [];
    for (const m of online) {
      const account = getAccount(m.id);
      if (account) participants.push({ account, socketId: m.socketId });
    }
    if (!participants.length) throw new Error('Nenhum jogador.');
    this.state = 'playing';
    this.match = new Match(this, this.io, this.night, participants, this.difficulty, this.mode);
    for (const pt of participants) {
      const p = this.match.players.get(pt.account.id);
      this.io.to(pt.socketId).emit('match:start', this.match.fullState(p));
    }
    this.systemMessage(fala('rInicio', { noite: NIGHTS[this.night].title }));
    this.broadcastState();
  }

  onMatchEnd(result) {
    this.lastResult = result;
    this.state = 'lobby';
    for (const m of this.members.values()) m.ready = false;
    // atualizar níveis e noites liberadas após salvar
    for (const m of this.members.values()) this.refreshMember(m.id);
    const hostMax = this.members.get(this.hostId)?.maxNight || 1;
    if (result.nextNight && result.nextNight <= hostMax) this.night = result.nextNight;
    this.night = Math.min(this.night, FINAL_NIGHT);
    setTimeout(() => { this.match = null; this.broadcastState(); }, 50);
  }

  destroy() {
    if (this.match) this.match.destroy();
  }
}

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.accountRoom = new Map();
  }

  generateCode() {
    for (let i = 0; i < 50; i++) {
      const code = `${CODE_PREFIX}-${crypto.randomInt(1000, 10000)}`;
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Não foi possível gerar código.');
  }

  roomOf(accountId) {
    const code = this.accountRoom.get(accountId);
    return code ? this.rooms.get(code) : null;
  }

  isInActiveMatch(accountId) {
    const r = this.roomOf(accountId);
    return !!(r && r.match && !r.match.ended && r.match.hasPlayer(accountId));
  }

  create(socket, account, opts) {
    if (this.rooms.size >= config.maxRooms) throw new Error('Servidor cheio. Tente mais tarde.');
    this.leave(account.id);
    const night = Math.max(1, Math.min(account.maxNight, Math.floor(Number(opts?.night) || 1), FINAL_NIGHT));
    const maxPlayers = Math.max(1, Math.min(config.maxPlayersPerRoom, Math.floor(Number(opts?.maxPlayers) || config.maxPlayersPerRoom)));
    const room = new Room(this, this.generateCode(), account, { night, maxPlayers, isPublic: !!opts?.isPublic, difficulty: opts?.difficulty, mode: opts?.mode });
    this.rooms.set(room.code, room);
    this.accountRoom.set(account.id, room.code);
    room.addMember(socket, account);
    return room;
  }

  join(socket, account, code) {
    code = String(code || '').toUpperCase().trim();
    if (/^\d{4}$/.test(code)) code = `${CODE_PREFIX}-${code}`;
    const room = this.rooms.get(code);
    if (!room) throw new Error('Sala não encontrada. Confira o código.');
    const existing = room.members.get(account.id);
    if (existing) {
      // reconexão
      existing.socketId = socket.id;
      existing.online = true;
      socket.join(room.channel);
      this.accountRoom.set(account.id, room.code);
      room.broadcastState();
      socket.emit('chat:history', room.chat);
      if (room.match && !room.match.ended && room.match.hasPlayer(account.id)) room.match.onReconnect(account.id, socket.id);
      return room;
    }
    if (room.state !== 'lobby') throw new Error('A partida já está em andamento. Aguarde terminar.');
    if (room.size >= room.maxPlayers) throw new Error('Sala cheia.');
    this.leave(account.id);
    this.accountRoom.set(account.id, room.code);
    room.addMember(socket, account);
    return room;
  }

  leave(accountId, reason = 'saiu') {
    const room = this.roomOf(accountId);
    this.accountRoom.delete(accountId);
    if (room) room.removeMember(accountId, reason);
  }

  onDisconnect(accountId, socketId) {
    const room = this.roomOf(accountId);
    if (!room) return;
    const m = room.members.get(accountId);
    if (!m || m.socketId !== socketId) return;
    m.online = false;
    this.io.to(room.channel).emit('voice:peer-left', { id: accountId });
    if (room.match && !room.match.ended && room.match.hasPlayer(accountId)) {
      room.match.onDisconnect(accountId);
      room.broadcastState();
      // remove do lobby se não voltar
      setTimeout(() => {
        const mm = room.members.get(accountId);
        if (mm && !mm.online && this.rooms.get(room.code) === room && !(room.match && room.match.hasPlayer(accountId))) this.leave(accountId, 'desconectou');
      }, 65000);
    } else {
      setTimeout(() => {
        const mm = room.members.get(accountId);
        if (mm && !mm.online && this.rooms.get(room.code) === room) this.leave(accountId, 'desconectou');
      }, 15000);
      room.broadcastState();
    }
  }

  deleteRoom(room) {
    room.destroy();
    this.rooms.delete(room.code);
    for (const [acc, code] of this.accountRoom) if (code === room.code) this.accountRoom.delete(acc);
  }

  publicRooms() {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic && r.state === 'lobby' && r.size < r.maxPlayers)
      .slice(0, 20)
      .map((r) => ({ code: r.code, players: r.size, maxPlayers: r.maxPlayers, night: r.night, difficulty: r.difficulty, host: r.members.get(r.hostId)?.name }));
  }
}
