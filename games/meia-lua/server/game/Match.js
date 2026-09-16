// Simulação autoritativa de uma partida (uma noite).
import { config } from '../config.js';
import {
  AREAS, AREA_BY_ID, DOORS, DOOR_BY_ID, OBJECTS, OBJECT_BY_ID, CAMERAS, CAMERA_BY_ID,
  SPAWN_POINTS, RESPAWN_POINT, moveWithCollision, lineOfSight, areaAt, randomFloorInArea,
  blockedTile, tileAt, TILE,
} from '../../shared/map.js';
import { ITEMS } from '../../shared/items.js';
import { NIGHTS, FINAL_NIGHT, LORE, ANIMATRONIC_INFO, DIFFICULTIES, DEFAULT_DIFFICULTY } from '../../shared/nights.js';
import { effectiveAttrs, derivedStats, applyXp, xpToNext, POINTS_PER_LEVEL } from '../../shared/rpg.js';
import { Animatronic } from '../ai/Animatronic.js';
import { STATE_CODE, TYPE_LIST, ANIM_TYPES } from '../ai/types.js';
import { rollLoot } from './loot.js';
import { fala } from '../../shared/falas.js';
import { saveMatchProgress } from '../database/accounts.js';

const TICK_MS = 50;
const SNAP_EVERY = 2; // 10 snapshots/s
const PLAYER_RADIUS = 0.3;
const INTERACT_RANGE = 1.7;
const GRACE_SECONDS = 8;
const OFFLINE_GRACE = 60;

const r2 = (v) => Math.round(v * 100) / 100;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export class Match {
  constructor(room, io, night, participants, difficulty = DEFAULT_DIFFICULTY) {
    this.room = room;
    this.io = io;
    this.night = night;
    this.cfg = NIGHTS[night];
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : DEFAULT_DIFFICULTY;
    this.diff = DIFFICULTIES[this.difficulty];
    this.decoys = [];
    this.duration = config.nightSeconds;
    this.drainScale = 360 / this.duration;
    this.time = 0;
    this.tickCount = 0;
    this.ended = false;
    this.lastTick = Date.now();

    this.power = this.cfg.startPower ?? 100;
    this.lightsOn = true;
    this.blackout = false;
    this.camerasBroken = !!this.cfg.camerasBroken;
    this.camFail = new Map();
    this.flicker = new Map();
    this.respawnsLeft = Math.max(0, this.cfg.respawns + this.diff.respawn);
    this.finalTriggered = false;
    this.maestroDown = false;
    this.phoneUntil = 0;
    this.noises = [];
    this.lastCamCheckAt = 0; // evento do Tonho (ver Animatronic.speedNow)
    this.nextEventAt = rnd(...this.cfg.eventInterval) * 0.6 * this.diff.events;
    this.lastEventType = null;
    this.eventLog = [];

    // Portas
    this.doors = new Map();
    for (const d of DOORS) {
      let locked = false;
      if (Object.prototype.hasOwnProperty.call(this.cfg.locks, d.id)) {
        locked = this.cfg.locks[d.id] === null ? 'sealed' : this.cfg.locks[d.id];
      }
      this.doors.set(d.id, { open: !locked, locked, jamUntil: 0 });
    }

    // Contêineres com saque pré-sorteado
    this.containers = new Map();
    for (const o of OBJECTS.filter((o) => o.type === 'container')) {
      this.containers.set(o.id, { searched: false, loot: rollLoot(night), quest: [] });
    }
    for (const sp of this.cfg.spawns) {
      const pool = shuffle(OBJECTS.filter((o) => o.type === 'container' && sp.areas.includes(o.area) && this.containers.get(o.id).quest.length === 0));
      for (let i = 0; i < sp.count; i++) {
        const c = pool[i % pool.length];
        this.containers.get(c.id).quest.push(sp.item);
      }
    }

    // Itens no chão
    this.ground = new Map();
    this.groundSeq = 1;
    for (let i = 0; i < 3; i++) {
      const area = pick(['salao', 'corredor_oeste', 'corredor_leste', 'cozinha', 'exterior']);
      const pt = randomFloorInArea(area);
      this.addGround(pick(['bateria', 'bandagem', 'chocolate']), pt.x, pt.y, 0, false);
    }

    // Missões
    this.quests = this.cfg.quests.map((q) => ({ id: q.id, def: q, done: false, progress: 0, read: new Set() }));

    // Jogadores
    this.players = new Map();
    participants.forEach((pt, i) => this.players.set(pt.account.id, this.makePlayer(pt, i)));

    // Animatrônicos — ativação escalonada ao longo da noite: cada "caçador"
    // (não é armadilha nem começa dormente) liga numa hora diferente, na
    // ordem em que aparece na lista da noite, em vez de todos começarem a
    // andar quase junto nos primeiros segundos como era antes. Numa noite
    // com 4, por exemplo, eles vêm à tona por volta de 1h, 2h20, 3h40 e
    // 4h50 (com uma folga aleatória em cada um) — dá pra sentir a virada
    // de clima crescendo em vez de já começar tudo de uma vez.
    const hunterTypes = this.cfg.animatronics.filter((t) => !ANIM_TYPES[t].trap && !ANIM_TYPES[t].dormant);
    const hourLen = this.duration / 6;
    const spacing = Math.min(1.3, 4 / Math.max(1, hunterTypes.length - 1));
    const activationAt = {};
    // Faixa permitida em proporção da duração da noite (calibrada p/ os
    // 20s..315s de uma noite padrão de 360s) — usar proporção em vez de
    // segundos fixos evita que o teto (duration-45) fique menor que o piso
    // (20) em noites curtas, o que colapsava todo mundo pro mesmo instante.
    const activationLo = this.duration * (20 / 360);
    const activationHi = this.duration * (315 / 360);
    // A folga aleatória também escala com o tamanho da "hora" do jogo —
    // numa noite padrão (hourLen=60s) isso é o rnd(-15,25) original; numa
    // noite mais curta (config/testes), a folga encolhe junto pra não
    // engolir o espaçamento entre um animatrônico e o outro.
    hunterTypes.forEach((t, i) => {
      const targetHour = 1 + i * spacing;
      const secs = targetHour * hourLen + rnd(-hourLen * 0.25, hourLen * (25 / 60));
      activationAt[t] = Math.max(activationLo, Math.min(activationHi, secs));
    });
    this.anims = this.cfg.animatronics.map((t) => new Animatronic(t, this, activationAt[t]));

    this.interval = setInterval(() => this.tick(), TICK_MS);
  }

  // ======================================================================
  // Jogadores
  // ======================================================================
  makePlayer(pt, i) {
    const acc = pt.account;
    const sp = SPAWN_POINTS[i % SPAWN_POINTS.length];
    const p = {
      id: acc.id, socketId: pt.socketId, name: acc.displayName,
      x: sp.x, y: sp.y, dir: -Math.PI / 2,
      inputs: [], budget: 4, lastSeq: 0,
      alive: true, hidden: null, hideFrom: null, hideSeenBy: null, respawnAt: 0,
      stunUntil: 0, invulnUntil: 0, boostUntil: 0,
      action: null, cam: null, flash: false, battery: 100,
      baseAttrs: { ...acc.attrs }, equipment: { ...acc.equipment },
      level: acc.level, xp: acc.xp, money: acc.money, pointsGained: 0, levelsGained: 0,
      inv: { ...acc.inventory },
      stats: { deaths: 0, missions: 0, itemsFound: 0, jumpscares: 0 },
      xpGained: 0, moneyGained: 0,
      online: true, offlineSince: 0, saved: false,
      noiseCd: 0, breathCd: 0, sprinting: false, moved: false, sneaking: false, breath: 100, holdBreath: false, threat: null,
      hints: [], hintCd: 0, color: i,
      stillSince: 0, flashOnSince: 0, // eventos da Marola (acampar) e da Lume (lanterna acesa demais)
    };
    this.recalcStats(p, true);
    return p;
  }

  recalcStats(p, fill = false) {
    const ratio = p.derived ? p.hp / p.derived.maxHp : 1;
    p.attrs = effectiveAttrs(p.baseAttrs, p.equipment);
    p.derived = derivedStats(p.attrs, p.equipment);
    p.hp = fill ? p.derived.maxHp : Math.max(1, Math.round(p.derived.maxHp * ratio));
    if (fill) { p.stamina = p.derived.maxStamina; p.fear = 0; }
  }

  *alivePlayers() {
    for (const p of this.players.values()) if (p.alive && p.online && !p.saved) yield p;
  }

  inGamePlayers() {
    return [...this.players.values()].filter((p) => !p.saved);
  }

  sendTo(p, ev, data) {
    if (p.online && p.socketId) this.io.to(p.socketId).emit(ev, data);
  }
  broadcast(ev, data) {
    this.io.to(this.room.channel).emit(ev, data);
  }
  notify(p, text, kind = 'info') {
    this.sendTo(p, 'fx', { type: 'notify', text, kind });
  }
  system(text) {
    this.room.systemMessage(text);
  }

  // ======================================================================
  // Entrada do cliente (validada)
  // ======================================================================
  queueInput(accountId, data) {
    const p = this.players.get(accountId);
    if (!p || !data || typeof data !== 'object') return;
    const s = Number(data.s), x = Number(data.x), y = Number(data.y);
    if (!Number.isFinite(s) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (s <= p.lastSeq) return;
    p.inputs.push({ s, x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), r: !!data.r, c: !!data.c });
    if (p.inputs.length > 10) p.inputs.splice(0, p.inputs.length - 10);
  }

  canAct(p) {
    return p.alive && p.online && !p.saved && this.time >= p.stunUntil;
  }

  applyInput(p, inp, dt) {
    p.lastSeq = inp.s;
    if (!p.alive || p.hidden || p.cam || this.time < p.stunUntil) return;
    let dx = inp.x, dy = inp.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) return;
    if (len > 1) { dx /= len; dy /= len; }
    if (p.action) this.cancelAction(p);
    const sneak = inp.c;
    const sprint = !sneak && inp.r && p.stamina > 1;
    let speed = p.derived.speed * (sprint ? 1.55 : sneak ? 0.5 : 1);
    if (p.fear >= 75) speed *= 0.85;
    if (this.time < p.boostUntil) speed *= 1.2;
    const pos = moveWithCollision(p.x, p.y, dx * speed * dt, dy * speed * dt, PLAYER_RADIUS, (id) => this.isDoorClosed(id));
    p.x = pos.x; p.y = pos.y;
    p.dir = Math.atan2(dy, dx);
    p.moved = true;
    if (sprint) { p.sprinting = true; p.stamina = Math.max(0, p.stamina - 28 * dt); }
    if (sneak) p.sneaking = true;
    p.noiseCd -= dt;
    if (p.noiseCd <= 0) {
      const q = 1 - p.derived.quiet;
      if (sprint) { this.addNoise(p.x, p.y, 7 * q, 'run'); p.noiseCd = 0.45; }
      else if (sneak) { this.addNoise(p.x, p.y, 0.7, 'sneak'); p.noiseCd = 1.2; }
      else { this.addNoise(p.x, p.y, 2.2 * q, 'walk'); p.noiseCd = 0.9; }
    }
  }

  // ======================================================================
  // Loop
  // ======================================================================
  tick() {
    if (this.ended) return;
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.time += dt;
    this.tickCount++;

    try {
      this.updatePlayers(dt);
      this.updateWorld(dt);
      if (this.time > GRACE_SECONDS) {
        for (const a of this.anims) a.update(dt);
      }
      for (const n of this.noises) for (const a of this.anims) a.hear(n);
      this.noises.length = 0;
      this.checkEnd();
      if (this.tickCount % SNAP_EVERY === 0) this.sendSnapshots();
    } catch (err) {
      console.error('[match] erro no tick:', err);
    }
  }

  updatePlayers(dt) {
    for (const p of this.players.values()) {
      if (p.saved) continue;
      if (!p.online) {
        if (this.time - p.offlineSince > OFFLINE_GRACE) this.removePlayer(p, 'timeout');
        continue;
      }
      p.moved = false; p.sprinting = false; p.sneaking = false;
      p.budget = Math.min(4, p.budget + 1);
      while (p.inputs.length && p.budget >= 1) {
        p.budget -= 1;
        this.applyInput(p, p.inputs.shift(), TICK_MS / 1000);
      }

      if (!p.alive) {
        if (p.respawnAt && this.time >= p.respawnAt) this.respawn(p);
        continue;
      }
      if (!p.sprinting) p.stamina = Math.min(p.derived.maxStamina, p.stamina + (p.moved ? 7 : 13) * dt);

      // eventos da Marola (acampar) e do Tonho (câmeras sem vigilância)
      if (p.moved) p.stillSince = this.time;
      if (p.cam) this.lastCamCheckAt = this.time;

      // lanterna
      if (p.flash) {
        p.battery = Math.max(0, p.battery - 0.7 * dt);
        if (p.battery <= 0) { p.flash = false; this.notify(p, fala('lanternaApagou'), 'warn'); }
      }

      // prender a respiração dentro do esconderijo
      p.threat = null;
      if (p.hidden) {
        let best = null, bd = 4.2;
        for (const a of this.anims) {
          if (a.def.trap || !['SEARCH', 'INVESTIGATE', 'CHASE', 'PATROL'].includes(a.state)) continue;
          const d = Math.hypot(a.x - p.x, a.y - p.y);
          if (d < bd) { bd = d; best = a; }
        }
        p.threat = best;
      }
      if (p.hidden && p.holdBreath) {
        p.breath = Math.max(0, p.breath - 20 * dt);
        if (p.breath <= 0) {
          p.holdBreath = false;
          this.addNoise(p.x, p.y, 6, 'gasp');
          this.emitSfx('gasp', p.x, p.y, 10);
          this.notify(p, fala('ofegou'), 'danger');
          if (p.threat) { this.pullFromHiding(p, p.threat); continue; }
        }
      } else {
        p.breath = Math.min(100, (p.breath ?? 100) + 14 * dt);
      }
      if (p.hidden && p.threat && !p.holdBreath) {
        const d = Math.hypot(p.threat.x - p.x, p.threat.y - p.y);
        const chance = (0.55 - d * 0.1) * (0.6 + p.fear / 125) * dt;
        if (Math.random() < chance) { this.pullFromHiding(p, p.threat); continue; }
      }

      // medo
      const area = areaAt(p.x, p.y);
      const lit = this.isLitAt(p.x, p.y);
      let fearDelta = lit ? (area?.safeLight ? -10 : -5) : (p.flash ? 0.5 : 2.5);
      for (const a of this.anims) {
        if (a.state === 'DISABLED' || a.state === 'DORMANT') continue;
        const d = Math.hypot(a.x - p.x, a.y - p.y);
        if (d < 7 && this.playerSees(p, a.x, a.y)) { fearDelta = Math.max(fearDelta, 0) + 15 * (1 - d / 9); }
      }
      if (this.blackout) fearDelta += 1.5;
      const watch = this.watchOf(p);
      if (watch.lvl > 0) fearDelta = Math.max(fearDelta, 0) + 22 * watch.lvl;
      p.fear = Math.max(0, Math.min(100, p.fear + (fearDelta > 0 ? fearDelta * p.derived.fearMult : fearDelta) * dt));
      if (p.fear >= 75) {
        p.breathCd -= dt;
        if (p.breathCd <= 0) { p.breathCd = 2; this.addNoise(p.x, p.y, 3.5, 'breath'); }
      }

      // ação em andamento
      if (p.action) this.updateAction(p, dt);

      // câmera: validar se ainda pode usar
      if (p.cam && !this.canUseCameras(p)) { p.cam = null; this.sendTo(p, 'fx', { type: 'camClose' }); }

      // dicas de investigação
      p.hintCd -= dt;
      if (p.hintCd <= 0) {
        p.hintCd = 0.5;
        const r = p.derived.senseRadius;
        p.hints = [];
        for (const [id, c] of this.containers) {
          if (c.searched || !c.quest.length) continue;
          const o = OBJECT_BY_ID[id];
          if (Math.hypot(o.x + 0.5 - p.x, o.y + 0.5 - p.y) <= r) p.hints.push(id);
        }
      }
    }
  }

  updateWorld(dt) {
    const hour = Math.min(6, Math.floor((this.time / this.duration) * 6));
    this.hour = hour;
    const alive = [...this.alivePlayers()].length;
    this.aggression = this.cfg.aggression + this.diff.aggr + hour * 0.06 + (this.blackout ? 0.3 : 0) + (this.finalTriggered ? 0.3 : 0)
      + 0.05 * Math.max(0, this.inGamePlayers().length - 1);

    // energia
    if (this.power > 0) {
      let drain = 0.095 * this.cfg.powerDrain;
      for (const d of DOORS) if (d.kind === 'power' && !this.doors.get(d.id).open) drain += 0.4;
      if (this.lightsOn) drain += 0.1;
      const camUsers = [...this.alivePlayers()].filter((p) => p.cam);
      for (const p of camUsers) drain += 0.1 * p.derived.camDrainMult;
      this.power = Math.max(0, this.power - drain * this.diff.drain * this.drainScale * dt);
      if (this.power <= 0) this.startBlackout();
    }

    // portas emperradas
    for (const [id, st] of this.doors) if (st.jamUntil && this.time > st.jamUntil) st.jamUntil = 0;

    // evento final
    if (this.cfg.finalEventHour && !this.finalTriggered && hour >= this.cfg.finalEventHour) this.triggerFinal();

    // eventos aleatórios
    if (this.time >= this.nextEventAt && this.time > GRACE_SECONDS + 10) {
      this.runRandomEvent();
      const [a, b] = this.cfg.eventInterval;
      this.nextEventAt = this.time + rnd(a, b) * this.diff.events;
    }
    if (this.phoneUntil && this.time > this.phoneUntil) this.phoneUntil = 0;
    for (const dc of this.decoys) {
      if (this.time >= dc.next) {
        dc.next = this.time + 1.5;
        this.addNoise(dc.x, dc.y, 14, 'decoy');
        this.emitSfx('radio', dc.x, dc.y, 22);
      }
    }
    this.decoys = this.decoys.filter((dc) => this.time < dc.until);
    void alive;
  }

  // ======================================================================
  // Mundo: portas, luz, câmeras, ruído
  // ======================================================================
  isDoorClosed(id) { return !this.doors.get(id).open; }

  doorCostFor(anim, id) {
    const st = this.doors.get(id);
    if (st.locked) return Infinity;
    if (st.open) return 0;
    const d = DOOR_BY_ID[id];
    if (d.kind === 'power') return this.power > 0 ? (anim.def.bashDoors ? 12 : Infinity) : 0;
    return 2 + anim.def.doorTime;
  }

  walkableFor(x, y) {
    return !blockedTile(Math.floor(x), Math.floor(y), (id) => this.isDoorClosed(id));
  }

  setDoorOpen(id, open, p) {
    const st = this.doors.get(id);
    const d = DOOR_BY_ID[id];
    if (!st || st.locked) return false;
    if (st.open === open) return true;
    if (!open) {
      if (st.jamUntil) { if (p) this.notify(p, fala('portaEmperrada'), 'warn'); return false; }
      if (d.kind === 'power' && this.power <= 0) { if (p) this.notify(p, fala('portaSemEnergia'), 'warn'); return false; }
      const cx = d.x + 0.5, cy = d.y + 0.5;
      for (const o of this.alivePlayers()) if (Math.abs(o.x - cx) < 0.5 + PLAYER_RADIUS && Math.abs(o.y - cy) < 0.5 + PLAYER_RADIUS) { if (p) this.notify(p, fala('portaAlguem'), 'warn'); return false; }
      for (const a of this.anims) if (Math.abs(a.x - cx) < 0.8 && Math.abs(a.y - cy) < 0.8 && a.state !== 'DISABLED') { if (p) this.notify(p, fala('portaSegurando'), 'danger'); return false; }
    }
    st.open = open;
    this.broadcast('door', { id, open, locked: st.locked ? true : false });
    this.emitSfx(d.kind === 'power' ? 'doorPower' : (open ? 'doorOpen' : 'doorClose'), d.x + 0.5, d.y + 0.5, 18);
    this.addNoise(d.x + 0.5, d.y + 0.5, d.kind === 'power' ? 3 : 5, 'door');
    return true;
  }

  forceDoorOpen(id, seconds) {
    const st = this.doors.get(id);
    st.open = true;
    st.jamUntil = this.time + seconds;
    this.broadcast('door', { id, open: true, locked: false, jam: true });
    const d = DOOR_BY_ID[id];
    this.emitSfx('doorBreak', d.x + 0.5, d.y + 0.5, 30);
    this.system(fala('rArrombada', { porta: d.name }));
  }

  isLitAt(x, y) {
    const area = areaAt(x, y);
    if (!area || this.blackout || !this.lightsOn || area.dark || area.outdoor) return false;
    const fl = this.flicker.get(area.id);
    if (fl && this.time < fl && Math.floor(this.time * 8) % 3 === 0) return false;
    return true;
  }

  viewRadius(p) {
    if (this.isLitAt(p.x, p.y)) return 10;
    if (p.flash && p.battery > 0) return p.derived.light + 1;
    return areaAt(p.x, p.y)?.outdoor ? 5 : 2.6;
  }

  playerSees(p, x, y) {
    const d = Math.hypot(x - p.x, y - p.y);
    const r = this.isLitAt(x, y) && d < 11 ? 11 : this.viewRadius(p);
    if (d > r + 0.4) return false;
    return lineOfSight(p.x, p.y, x, y, (id) => this.isDoorClosed(id));
  }

  cameraWorking(camId) {
    return this.power > 0 && !this.camerasBroken && !((this.camFail.get(camId) || 0) > this.time);
  }

  nearObjectType(p, type, range = 2.3) {
    return OBJECTS.some((o) => o.type === type && Math.hypot(o.x + 0.5 - p.x, o.y + 0.5 - p.y) <= range);
  }

  canUseCameras(p) {
    return p.alive && p.online && !p.hidden && (p.derived.tablet || this.nearObjectType(p, 'console'));
  }

  isWatchedOnCamera(x, y) {
    for (const p of this.alivePlayers()) {
      if (!p.cam || !this.cameraWorking(p.cam)) continue;
      const c = CAMERA_BY_ID[p.cam];
      if (Math.abs(x - c.cx) <= c.vw / 2 && Math.abs(y - c.cy) <= c.vh / 2) return true;
    }
    return false;
  }

  addNoise(x, y, radius, source) {
    if (this.noises.length < 64) this.noises.push({ x, y, radius, source });
  }

  // Nível de voz do microfone (0..1), medido no navegador do jogador e
  // mandado só como um número — nunca o áudio em si. Vira um "barulho" que
  // apenas animatrônicos com hearsVoice (ver Animatronic.hear) percebem.
  playerVoiceNoise(accountId, level) {
    const p = this.players.get(accountId);
    if (!p || !p.alive || p.saved) return;
    if (this.time < (p.voiceNoiseCd || 0)) return;
    p.voiceNoiseCd = this.time + 0.4;
    if (level < 0.05) return;
    this.addNoise(p.x, p.y, 3.5 + level * 11, 'voice');
  }

  emitSfx(s, x, y, radius = 20, extra = {}) {
    for (const p of this.players.values()) {
      if (!p.online || p.saved) continue;
      if (radius !== Infinity && Math.hypot(p.x - x, p.y - y) > radius) continue;
      this.sendTo(p, 'fx', { type: 'sfx', s, x: r2(x), y: r2(y), ...extra });
    }
  }

  startBlackout() {
    if (this.blackout) return;
    this.blackout = true;
    this.lightsOn = false;
    for (const d of DOORS) {
      const st = this.doors.get(d.id);
      if (d.kind === 'power' && !st.open) { st.open = true; this.broadcast('door', { id: d.id, open: true, locked: false }); }
    }
    for (const p of this.players.values()) if (p.cam) p.cam = null;
    this.broadcast('fx', { type: 'blackout' });
    this.system(fala('rApagao'));
    // Evento do Gregório: o apagão é a deixa dele — para de rondar normal
    // e vem caçando por audição até a luz voltar (ver Animatronic.startBlackoutHunt).
    const greg = this.anims.find((a) => a.def.blackoutStalker);
    if (greg) greg.startBlackoutHunt();
  }

  restorePower(amount) {
    this.power = Math.min(100, this.power + amount);
    if (this.blackout && this.power > 0) {
      this.blackout = false;
      this.lightsOn = true;
      this.broadcast('fx', { type: 'powerRestored' });
      for (const a of this.anims) if (a.blackoutHunt) a.endBlackoutHunt();
    }
  }

  // ======================================================================
  // Itens no chão / inventário
  // ======================================================================
  addGround(item, x, y, amount = 0, announce = true) {
    const id = this.groundSeq++;
    const g = { id, item, x: r2(x), y: r2(y), amount };
    this.ground.set(id, g);
    if (announce) this.broadcast('ground', { add: g });
    return g;
  }

  removeGround(id) {
    this.ground.delete(id);
    this.broadcast('ground', { remove: id });
  }

  giveItem(p, item, qty = 1) {
    p.inv[item] = (p.inv[item] || 0) + qty;
    p.stats.itemsFound += qty;
    this.onItemCollected(item);
    this.sendInventory(p);
  }

  takeItem(p, item, qty = 1) {
    if ((p.inv[item] || 0) < qty) return false;
    p.inv[item] -= qty;
    if (p.inv[item] <= 0) delete p.inv[item];
    return true;
  }

  giveMoney(p, amount) {
    amount = Math.round(amount);
    p.money += amount;
    p.moneyGained += amount;
  }

  giveXp(p, amount) {
    amount = Math.round(amount);
    const before = p.level;
    const r = applyXp(p.level, p.xp, amount);
    p.level = r.level; p.xp = r.xp; p.xpGained += amount;
    if (r.levelsGained > 0) {
      p.levelsGained += r.levelsGained;
      p.pointsGained += r.levelsGained * POINTS_PER_LEVEL;
      this.sendTo(p, 'fx', { type: 'levelup', level: p.level });
      this.system(fala('rNivel', { nome: p.name, n: p.level }));
    }
    void before;
  }

  sendProgress(p) {
    this.sendTo(p, 'progress', { level: p.level, xp: p.xp, xpToNext: xpToNext(p.level), money: p.money, xpGained: p.xpGained, moneyGained: p.moneyGained, pointsGained: p.pointsGained });
  }

  sendInventory(p) {
    this.sendTo(p, 'inv', { inventory: p.inv, equipment: p.equipment, attrs: p.attrs, derived: p.derived });
  }

  useItem(accountId, itemId) {
    const p = this.players.get(accountId);
    if (!p || !this.canAct(p)) return;
    const it = ITEMS[itemId];
    if (!it || it.type !== 'consumable' || !(p.inv[itemId] > 0)) return;
    let ok = true;
    switch (itemId) {
      case 'bandagem': if (p.hp >= p.derived.maxHp) ok = false; else p.hp = Math.min(p.derived.maxHp, p.hp + 35); break;
      case 'bateria': if (p.battery >= 99) ok = false; else p.battery = 100; break;
      case 'refrigerante': p.stamina = p.derived.maxStamina; p.boostUntil = this.time + 8; break;
      case 'chocolate': if (p.fear < 1) ok = false; else p.fear = Math.max(0, p.fear - 45); break;
      case 'radio_isca': {
        this.decoys.push({ x: p.x, y: p.y, until: this.time + 12, next: this.time + 0.3 });
        this.broadcast('fx', { type: 'decoy', x: r2(p.x), y: r2(p.y), dur: 12 });
        this.notify(p, fala('radioIsca'), 'good');
        break;
      }
      case 'sinalizador': {
        let n = 0;
        for (const a of this.anims) {
          if (Math.hypot(a.x - p.x, a.y - p.y) < 5.5) { a.stun(5); n++; }
        }
        this.emitSfx('flare', p.x, p.y, 25);
        this.broadcast('fx', { type: 'flare', x: r2(p.x), y: r2(p.y) });
        this.addNoise(p.x, p.y, 12, 'flare');
        this.notify(p, n ? fala('sinalizador', { n }) : fala('sinalizadorNada'), n ? 'good' : 'info');
        break;
      }
      default: ok = false;
    }
    if (!ok) { this.notify(p, fala('naoPrecisa')); return; }
    this.takeItem(p, itemId);
    this.sendTo(p, 'fx', { type: 'sfx', s: 'use', x: r2(p.x), y: r2(p.y) });
    this.sendInventory(p);
  }

  equip(accountId, itemId) {
    const p = this.players.get(accountId);
    if (!p || p.saved) return;
    const it = ITEMS[itemId];
    if (!it || it.type !== 'equip' || !(p.inv[itemId] > 0)) return;
    p.equipment[it.slot] = itemId;
    this.recalcStats(p);
    this.sendInventory(p);
  }

  unequip(accountId, slot) {
    const p = this.players.get(accountId);
    if (!p || p.saved || !(slot in p.equipment)) return;
    p.equipment[slot] = null;
    if (slot === 'lanterna') p.flash = false;
    this.recalcStats(p);
    this.sendInventory(p);
  }

  setBreath(accountId, hold) {
    const p = this.players.get(accountId);
    if (!p || !p.alive || p.saved) return;
    if (hold && (!p.hidden || p.breath < 8)) return;
    p.holdBreath = !!hold;
  }

  // Pipoca não machuca — é só uma alucinação pra mexer com a cabeça de
  // quem vê: nenhum dano, só o clarão fantasmagórico (mesma fx visual das
  // aparições aleatórias) e um baque de medo.
  trapClash(anim, target) {
    this.emitSfx('cymbals', anim.x, anim.y, 45);
    this.broadcast('fx', { type: 'clash', x: r2(anim.x), y: r2(anim.y) });
    const ang = Math.random() * Math.PI * 2;
    this.sendTo(target, 'fx', {
      type: 'apparition', kind: 'pipoca',
      x: r2(target.x + Math.cos(ang) * 2.1), y: r2(target.y + Math.sin(ang) * 2.1),
    });
    for (const a of this.anims) {
      if (a === anim || a.def.trap) continue;
      if (Math.hypot(a.x - anim.x, a.y - anim.y) < 28) a.investigate(anim.x, anim.y);
    }
    target.fear = Math.min(100, target.fear + 18 * target.derived.fearMult);
    for (const p of this.alivePlayers()) {
      if (Math.hypot(p.x - anim.x, p.y - anim.y) < 12) this.notify(p, fala('pipoca'), 'danger');
    }
  }

  // Assombração: de vez em quando a Pipoca se teleporta pra perto de um
  // jogador (sem ninguém vendo) só pra fazer a tela tremeluzir e sussurrar
  // — nenhum dano, nenhuma perseguição de verdade, é só pra assustar.
  animHaunt(anim, target) {
    this.emitSfx('musicbox', anim.x, anim.y, 16);
    const area = areaAt(target.x, target.y);
    this.sendTo(target, 'fx', { type: 'flicker', area: area?.id, until: 1.4 });
    this.sendTo(target, 'fx', { type: 'whisper', text: pick(LORE.whispers) });
    target.fear = Math.min(100, target.fear + 5 * target.derived.fearMult);
  }

  areaAccessible(areaId) {
    const gated = { porao: 'd_porao', sala_secreta: 'd_secreta', deposito: 'd_deposito' };
    return !gated[areaId] || !this.doors.get(gated[areaId]).locked;
  }

  toggleFlashlight(accountId) {
    const p = this.players.get(accountId);
    if (!p || !p.alive || p.saved) return;
    if (!p.equipment.lanterna) { this.notify(p, fala('semLanterna')); return; }
    if (!p.flash && p.battery <= 0) { this.notify(p, fala('semBateria'), 'warn'); return; }
    p.flash = !p.flash;
    if (p.flash) p.flashOnSince = this.time; // evento da Lume (ver Animatronic.canSee)
    this.sendTo(p, 'fx', { type: 'sfx', s: 'click', x: r2(p.x), y: r2(p.y) });
  }

  setCamera(accountId, camId) {
    const p = this.players.get(accountId);
    if (!p || p.saved) return;
    if (camId === null) { p.cam = null; return; }
    if (typeof camId !== 'string' || !CAMERA_BY_ID[camId]) return;
    if (!this.canUseCameras(p)) { this.notify(p, fala('camSemMonitor'), 'warn'); this.sendTo(p, 'fx', { type: 'camClose' }); return; }
    if (this.power <= 0) { this.notify(p, fala('camSemEnergia'), 'warn'); this.sendTo(p, 'fx', { type: 'camClose' }); return; }
    if (p.action) this.cancelAction(p);
    p.cam = camId;
  }

  remoteDoor(accountId, doorId) {
    const p = this.players.get(accountId);
    if (!p || !this.canAct(p)) return;
    const d = DOOR_BY_ID[doorId];
    if (!d || d.kind !== 'power') return;
    if (!this.nearObjectType(p, 'console')) { this.notify(p, fala('remotoSoMonitor'), 'warn'); return; }
    this.setDoorOpen(doorId, !this.doors.get(doorId).open, p);
  }

  // ======================================================================
  // Interação
  // ======================================================================
  interact(accountId, targetId) {
    const p = this.players.get(accountId);
    if (!p || !this.canAct(p)) return;
    if (p.hidden) { this.unhide(p); return; }
    if (p.cam) return;
    if (p.action) { this.cancelAction(p); return; }

    const cands = [];
    for (const o of OBJECTS) {
      const d = Math.hypot(o.x + 0.5 - p.x, o.y + 0.5 - p.y);
      if (d <= INTERACT_RANGE) cands.push({ kind: 'obj', id: o.id, d, o });
    }
    for (const dr of DOORS) {
      const d = Math.hypot(dr.x + 0.5 - p.x, dr.y + 0.5 - p.y);
      if (d <= INTERACT_RANGE) cands.push({ kind: 'door', id: dr.id, d: d + 0.05, dr });
    }
    for (const g of this.ground.values()) {
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d <= 1.3) cands.push({ kind: 'ground', id: 'g' + g.id, d: d - 0.3, g });
    }
    if (!cands.length) return;
    let c = null;
    if (typeof targetId === 'string') c = cands.find((k) => k.id === targetId);
    if (!c) c = cands.sort((a, b) => a.d - b.d)[0];

    if (c.kind === 'ground') return this.pickupGround(p, c.g);
    if (c.kind === 'door') return this.interactDoor(p, c.dr);
    return this.interactObject(p, c.o);
  }

  pickupGround(p, g) {
    this.removeGround(g.id);
    if (g.item === 'money') {
      this.giveMoney(p, g.amount);
      this.notify(p, fala('pegouDinheiro', { v: g.amount }), 'good');
      this.sendProgress(p);
    } else {
      this.giveItem(p, g.item);
      this.notify(p, fala('pegouItem', { item: ITEMS[g.item].name }), 'good');
    }
    this.emitSfx('pickup', p.x, p.y, 6);
  }

  interactDoor(p, d) {
    const st = this.doors.get(d.id);
    if (st.locked === 'sealed') { this.notify(p, fala('portaSelada', { porta: d.name }), 'warn'); this.emitSfx('locked', d.x + 0.5, d.y + 0.5, 6); return; }
    if (st.locked) {
      if ((p.inv[st.locked] || 0) > 0) {
        st.locked = false;
        this.broadcast('door', { id: d.id, open: false, locked: false });
        this.setDoorOpen(d.id, true, p);
        this.system(fala('rDestrancou', { nome: p.name, porta: d.name.toLowerCase() }));
        const q = this.quests.find((q) => q.def.type === 'unlock' && q.def.target === d.id && !q.done);
        if (q) this.completeQuest(q, p);
      } else {
        this.notify(p, fala('portaTrancada', { item: ITEMS[st.locked].name }), 'warn');
        this.emitSfx('locked', d.x + 0.5, d.y + 0.5, 6);
      }
      return;
    }
    this.setDoorOpen(d.id, !st.open, p);
  }

  questFor(type, target) {
    return this.quests.find((q) => q.def.type === type && (q.def.target === target || q.def.targets?.includes(target)));
  }
  questActive(q) {
    return q && !q.done && (q.def.requires || []).every((id) => this.quests.find((x) => x.id === id)?.done);
  }

  interactObject(p, o) {
    switch (o.type) {
      case 'container': {
        const c = this.containers.get(o.id);
        if (c.searched) { this.notify(p, fala('vazio')); return; }
        p.action = { kind: 'search', objId: o.id, t: 0, dur: p.derived.searchTime };
        this.addNoise(p.x, p.y, 3, 'search');
        this.emitSfx('search', o.x + 0.5, o.y + 0.5, 8);
        return;
      }
      case 'hide': return this.hide(p, o);
      case 'investigate': {
        const q = this.questFor('interact', o.id);
        if (this.questActive(q)) { p.action = { kind: 'investigate', objId: o.id, t: 0, dur: 2.5, questId: q.id }; return; }
        this.notify(p, fala('palcoNada'));
        return;
      }
      case 'fusebox': case 'tapedeck': case 'keycutter': case 'altar': return this.deliver(p, o);
      case 'campanel': case 'generator': {
        const q = this.questFor('repair', o.id);
        if (!q) { this.notify(p, fala(o.type === 'generator' ? 'geradorOk' : 'painelOk')); return; }
        if (q.done) { this.notify(p, fala('jaConsertado')); return; }
        if (!this.questActive(q)) { this.notify(p, fala('naoDaConsertar')); return; }
        p.action = { kind: 'repair', objId: o.id, questId: q.id, t: 0, dur: 1 };
        this.emitSfx('repair', o.x + 0.5, o.y + 0.5, 10);
        return;
      }
      case 'console': {
        if (this.power <= 0) { this.notify(p, fala('monitorSemEnergia'), 'warn'); return; }
        this.sendTo(p, 'fx', { type: 'openCams' });
        return;
      }
      case 'breaker': {
        if (this.power <= 0) { this.notify(p, fala('semEnergia'), 'warn'); return; }
        this.lightsOn = !this.lightsOn;
        this.broadcast('fx', { type: 'lights', on: this.lightsOn });
        this.emitSfx('breaker', o.x + 0.5, o.y + 0.5, 30);
        this.addNoise(o.x + 0.5, o.y + 0.5, 5, 'breaker');
        this.system(fala('rLuzes', { nome: p.name, acao: this.lightsOn ? 'Liguei' : 'Desliguei' }));
        return;
      }
      case 'phone': {
        if (this.phoneUntil && this.time < this.phoneUntil) {
          this.phoneUntil = 0;
          const text = pick(LORE.phone);
          this.broadcast('fx', { type: 'lore', title: 'Ligação misteriosa', text });
          this.giveMoney(p, 40); this.giveXp(p, 25); this.sendProgress(p);
          this.notify(p, fala('telefoneBonus'), 'good');
          this.emitSfx('phonePick', o.x + 0.5, o.y + 0.5, 10);
        } else this.notify(p, fala('telefoneMudo'));
        return;
      }
      case 'document': {
        const q = this.questFor('read', o.id);
        if (!this.questActive(q)) {
          if (q?.done) this.sendTo(p, 'fx', { type: 'lore', title: o.name, text: LORE.docs[o.id] });
          return;
        }
        if (!q.read.has(o.id)) {
          q.read.add(o.id);
          q.progress = q.read.size;
          this.broadcast('fx', { type: 'lore', title: o.name, text: LORE.docs[o.id] });
          this.system(fala('rLeu', { nome: p.name, doc: o.name, p: q.read.size, t: q.def.targets.length }));
          if (q.read.size >= q.def.targets.length) this.completeQuest(q, p);
          else this.broadcastQuests();
        } else this.sendTo(p, 'fx', { type: 'lore', title: o.name, text: LORE.docs[o.id] });
        return;
      }
      case 'lore': this.sendTo(p, 'fx', { type: 'lore', title: o.name, text: pick(LORE.mural) }); return;
      case 'gate': {
        const q = this.questFor('escape', o.id);
        if (this.questActive(q)) { this.completeQuest(q, p); this.endMatch('victory', 'escape'); }
        else this.notify(p, fala('portaoTrancado'), 'warn');
        return;
      }
    }
  }

  deliver(p, o) {
    const q = this.questFor('deliver', o.id);
    if (!q || q.done) { this.notify(p, fala(q?.done ? 'jaFeito' : 'nadaAqui')); return; }
    if (!this.questActive(q)) {
      const missing = (q.def.requires || []).map((id) => this.quests.find((x) => x.id === id)).filter((x) => !x.done).map((x) => x.def.title);
      this.notify(p, fala('primeiro', { lista: missing.join(', ').toLowerCase() }), 'warn');
      return;
    }
    const need = q.def.count - q.progress;
    const have = p.inv[q.def.item] || 0;
    if (have <= 0) { this.notify(p, fala('precisaEntregar', { item: ITEMS[q.def.item].name, p: q.progress, t: q.def.count }), 'warn'); return; }
    const n = Math.min(need, have);
    this.takeItem(p, q.def.item, n);
    q.progress += n;
    this.sendInventory(p);
    this.emitSfx('deliver', o.x + 0.5, o.y + 0.5, 12);
    if (q.progress >= q.def.count) this.completeQuest(q, p);
    else { this.notify(p, fala('entregou', { item: ITEMS[q.def.item].name, p: q.progress, t: q.def.count })); this.broadcastQuests(); }
  }

  updateAction(p, dt) {
    const a = p.action;
    const o = OBJECT_BY_ID[a.objId];
    if (!o || Math.hypot(o.x + 0.5 - p.x, o.y + 0.5 - p.y) > INTERACT_RANGE + 0.4) { this.cancelAction(p); return; }
    if (a.kind === 'repair') {
      const q = this.quests.find((x) => x.id === a.questId);
      if (!q || q.done) { p.action = null; return; }
      q.progress = Math.min(1, q.progress + dt / (q.def.seconds * p.derived.repairMult));
      a.t = q.progress;
      if (Math.random() < dt * 0.8) this.addNoise(p.x, p.y, 4, 'repair');
      if (q.progress >= 1) { p.action = null; this.completeQuest(q, p); }
      return;
    }
    a.t += dt;
    if (a.t < a.dur) return;
    p.action = null;
    if (a.kind === 'search') {
      const c = this.containers.get(a.objId);
      if (c.searched) return;
      c.searched = true;
      this.broadcast('container', { id: a.objId, searched: true });
      const found = [];
      for (const it of c.quest) { this.giveItem(p, it); found.push(ITEMS[it].name); }
      for (const it of c.loot.items) { this.giveItem(p, it); found.push(ITEMS[it].name); }
      const money = Math.round(c.loot.money * p.derived.lootMult);
      if (money > 0) { this.giveMoney(p, money); found.push(`$${money}`); }
      this.giveXp(p, 3);
      this.sendProgress(p);
      this.notify(p, found.length ? fala('achou', { itens: found.join(', ') }) : fala('nadaUtil'), found.length ? 'good' : 'info');
      if (c.quest.length) this.system(fala('rAchou', { nome: p.name, itens: c.quest.map((i) => ITEMS[i].name).join(', ') }));
    } else if (a.kind === 'investigate') {
      const q = this.quests.find((x) => x.id === a.questId);
      if (q && !q.done) this.completeQuest(q, p);
    }
  }

  cancelAction(p) {
    if (!p.action) return;
    p.action = null;
    this.sendTo(p, 'fx', { type: 'actionCancel' });
  }

  hide(p, o) {
    for (const other of this.players.values()) if (other.hidden === o.id) { this.notify(p, fala('ocupado'), 'warn'); return; }
    p.hideFrom = { x: p.x, y: p.y };
    p.hidden = o.id;
    p.flash = false;
    p.x = o.x + 0.5; p.y = o.y + 0.5;
    p.hideSeenBy = new Set();
    for (const a of this.anims) {
      if (a.state === 'CHASE' && a.targetId === p.id && Math.hypot(a.x - p.x, a.y - p.y) < 3.2
        && lineOfSight(a.x, a.y, p.hideFrom.x, p.hideFrom.y, (id) => this.isDoorClosed(id))) p.hideSeenBy.add(a.id);
    }
    this.emitSfx('hide', p.x, p.y, 6);
  }

  unhide(p) {
    if (!p.hidden) return;
    p.hidden = null;
    p.hideSeenBy = null;
    if (p.hideFrom) {
      p.x = p.hideFrom.x; p.y = p.hideFrom.y;
    }
    p.hideFrom = null;
    this.emitSfx('hide', p.x, p.y, 6);
  }

  pullFromHiding(p, anim) {
    this.unhide(p);
    this.notify(p, fala('viuEntrar', { anim: ANIMATRONIC_INFO[anim.type].short }), 'danger');
    this.damagePlayer(p, anim);
  }

  // ======================================================================
  // Combate, morte, respawn
  // ======================================================================
  damagePlayer(p, anim) {
    if (!p.alive || this.time < p.invulnUntil) return;
    const dmg = Math.round(anim.def.damage * (0.9 + 0.1 * this.aggression) * this.diff.damage * p.derived.damageMult);
    p.hp -= dmg;
    p.invulnUntil = this.time + 2.4;
    p.stunUntil = this.time + 1.0 * p.derived.stunMult;
    p.fear = Math.min(100, p.fear + 35 * p.derived.fearMult);
    p.stats.jumpscares++;
    p.cam = null;
    this.cancelAction(p);
    // empurrão
    const ang = Math.atan2(p.y - anim.y, p.x - anim.x);
    const pos = moveWithCollision(p.x, p.y, Math.cos(ang) * 0.9, Math.sin(ang) * 0.9, PLAYER_RADIUS, (id) => this.isDoorClosed(id));
    p.x = pos.x; p.y = pos.y;
    this.sendTo(p, 'fx', { type: 'jumpscare', anim: anim.type, dmg, fatal: p.hp <= 0 });
    this.emitSfx('scream', p.x, p.y, 16, { who: p.id });
    if (p.hp <= 0) this.kill(p, anim);
  }

  kill(p, anim) {
    p.alive = false;
    p.hp = 0;
    p.flash = false;
    p.hidden = null;
    p.action = null;
    p.cam = null;
    p.stats.deaths++;
    // derruba itens de missão
    for (const [id, q] of Object.entries(p.inv)) {
      if (ITEMS[id]?.type === 'quest') {
        for (let i = 0; i < q; i++) this.addGround(id, p.x + rnd(-0.4, 0.4), p.y + rnd(-0.4, 0.4));
        delete p.inv[id];
      }
    }
    this.sendInventory(p);
    if (this.respawnsLeft > 0) {
      this.respawnsLeft--;
      p.respawnAt = this.time + 12;
    } else p.respawnAt = 0;
    const who = anim ? ANIMATRONIC_INFO[anim.type].short : 'a escuridão';
    this.system(fala('rPego', { nome: p.name, anim: who }) + fala(p.respawnAt ? 'rVolta' : 'rSemVolta'));
    this.broadcast('fx', { type: 'death', id: p.id, respawn: !!p.respawnAt, respawnsLeft: this.respawnsLeft });
  }

  respawn(p) {
    p.alive = true;
    p.respawnAt = 0;
    p.x = RESPAWN_POINT.x; p.y = RESPAWN_POINT.y;
    p.hp = Math.round(p.derived.maxHp * 0.6);
    p.stamina = p.derived.maxStamina;
    p.fear = 20;
    p.invulnUntil = this.time + 3;
    p.inputs = [];
    this.sendTo(p, 'fx', { type: 'respawn', x: p.x, y: p.y });
    this.system(fala('rVoltou', { nome: p.name }));
  }

  onAnimNotice(anim, p) {
    this.sendTo(p, 'fx', { type: 'notice', anim: anim.type });
  }

  /** Quanto o jogador está sendo encarado agora (0..1), de onde e por quem. */
  watchOf(p) {
    let lvl = 0, who = null;
    for (const a of this.anims) {
      let v = 0;
      if (a.state === 'ALERT' && a.noticeTarget === p.id) v = Math.min(0.95, 0.15 + a.notice * 0.8);
      else if (a.state === 'CHASE' && a.targetId === p.id && a.lostTime < 0.6) v = 1;
      if (v > lvl) { lvl = v; who = a; }
    }
    return { lvl, who };
  }

  onAnimChase(anim) {
    const t = this.players.get(anim.targetId);
    for (const p of this.alivePlayers()) {
      if (p === t || Math.hypot(p.x - anim.x, p.y - anim.y) < 12) this.sendTo(p, 'fx', { type: 'chase', anim: anim.type, target: p === t });
    }
  }

  // Depois que um animatrônico acerta um jumpscare e teleporta pra longe
  // (ver Animatronic.teleportAfterAttack), quem estava perto ouve o
  // "sumiço" dele indo embora — reforça que ele já não está mais ali.
  onAnimTeleportAway(anim, target, ox, oy) {
    this.emitSfx('teleportOut', ox, oy, 20, { who: target.id });
  }

  conductAlert(maestro, target) {
    for (const a of this.anims) if (a !== maestro) a.investigate(target.x, target.y);
    this.emitSfx('conduct', maestro.x, maestro.y, Infinity);
  }

  animBlink(anim) {
    const players = [...this.alivePlayers()];
    if (!players.length) return;
    const t = pick(players);
    const area = areaAt(t.x, t.y);
    if (!area || !anim.def.patrol.includes(area.id)) return;
    // Quanto mais perto o Maestro já está de alguém, mais perto ele ousa
    // reaparecer (e mais assustador fica) — bem em cima às vezes.
    const dNow = Math.hypot(t.x - anim.x, t.y - anim.y);
    const bold = anim.def.blinks && dNow < 16;
    const minGap = bold ? 3.5 : 7;
    for (let i = 0; i < 12; i++) {
      const pt = randomFloorInArea(area.id);
      if (players.every((p) => Math.hypot(p.x - pt.x, p.y - pt.y) > minGap && !this.playerSees(p, pt.x, pt.y))) {
        anim.x = pt.x; anim.y = pt.y; anim.path = null;
        anim.setState('PATROL', 20);
        anim.goTo(t.x, t.y);
        this.emitSfx('musicbox', pt.x, pt.y, 22);
        // Se ele reapareceu bem perto, a tela treme/tremula um instante —
        // é o "piscar" do Maestro, sem chegar a ser um jumpscare de verdade.
        const d = Math.hypot(t.x - pt.x, t.y - pt.y);
        if (d < 6) {
          this.sendTo(t, 'fx', { type: 'flicker', area: area.id, until: 1.1 });
          this.emitSfx('static', pt.x, pt.y, 10);
          t.fear = Math.min(100, t.fear + 6 * t.derived.fearMult);
        }
        return;
      }
    }
  }

  // ======================================================================
  // Missões
  // ======================================================================
  onItemCollected(item) {
    for (const q of this.quests) {
      if (q.done || q.def.type !== 'collect' || q.def.item !== item) continue;
      let held = 0;
      for (const p of this.players.values()) held += p.inv[item] || 0;
      const delivered = this.quests.find((x) => x.def.type === 'deliver' && x.def.item === item)?.progress || 0;
      const prog = Math.min(q.def.count, held + delivered);
      if (prog > q.progress) q.progress = prog;
      if (q.progress >= q.def.count) this.completeQuest(q, null);
      else this.broadcastQuests();
    }
  }

  completeQuest(q, byPlayer) {
    if (q.done) return;
    q.done = true;
    if (q.def.type !== 'read' && q.def.type !== 'repair') q.progress = q.def.count || 1;
    const rw = q.def.reward || { xp: 0, money: 0 };
    for (const p of this.players.values()) {
      if (p.saved) continue;
      this.giveXp(p, rw.xp * this.diff.reward);
      this.giveMoney(p, rw.money * (1 + (this.diff.reward - 1) * 0.5));
      p.stats.missions++;
      this.sendProgress(p);
    }
    this.broadcast('fx', { type: 'questDone', title: q.def.title, line: q.def.done || null, xp: Math.round(rw.xp * this.diff.reward), money: Math.round(rw.money * (1 + (this.diff.reward - 1) * 0.5)) });
    this.system(q.def.done ? (byPlayer ? fala('rMissao', { nome: byPlayer.name, fala: q.def.done }) : fala('rMissaoEquipe', { fala: q.def.done })) : `✅ ${q.def.title}`);

    if (q.def.gives && byPlayer) {
      this.giveItem(byPlayer, q.def.gives);
      this.notify(byPlayer, fala('recebeu', { item: ITEMS[q.def.gives].name }), 'good');
    }
    const ef = q.def.effect || {};
    if (ef.power) { this.restorePower(ef.power); this.system(fala('rEnergia', { n: ef.power })); }
    if (ef.cameras) { this.camerasBroken = false; this.broadcast('fx', { type: 'camerasFixed' }); }
    if (ef.shutdown) this.shutdownMaestro();
    if (q.def.lore === 'tape') this.broadcast('fx', { type: 'lore', title: 'Fita do gerente', text: LORE.tape });
    this.broadcastQuests();
  }

  questView() {
    return this.quests.map((q) => ({
      id: q.id, title: q.def.title, desc: q.def.desc, type: q.def.type, done: q.done,
      active: this.questActive(q) || q.done, optional: !!q.def.optional,
      progress: q.def.type === 'repair' ? Math.round(q.progress * 100) : q.progress,
      count: q.def.type === 'repair' ? 100 : (q.def.count || q.def.targets?.length || 1),
      reward: q.def.reward,
    }));
  }

  broadcastQuests() {
    this.broadcast('quests', this.questView());
  }

  // ======================================================================
  // Eventos aleatórios
  // ======================================================================
  runRandomEvent() {
    const players = [...this.alivePlayers()];
    if (!players.length) return;
    const n = this.night;
    const events = [
      { t: 'flicker', w: 16 },
      { t: 'doorSlam', w: 10 },
      { t: 'camFail', w: this.camerasBroken ? 0 : 9 },
      { t: 'objectMove', w: 7 },
      { t: 'sound', w: 13 },
      { t: 'apparition', w: 7 + n },
      { t: 'routeChange', w: 8 + n },
      { t: 'whisper', w: 8 },
      { t: 'phone', w: this.phoneUntil ? 0 : 4 },
      { t: 'coin', w: 3 },
      { t: 'surge', w: this.power > 20 ? 5 : 0 },
      { t: 'thunder', w: 10 },
    ].filter((e) => e.w > 0 && e.t !== this.lastEventType);
    const total = events.reduce((s, e) => s + e.w, 0);
    let r = Math.random() * total, ev = events[0];
    for (const e of events) { if ((r -= e.w) <= 0) { ev = e; break; } }
    this.lastEventType = ev.t;
    this.eventLog.push({ t: ev.t, at: Math.round(this.time) });

    const target = pick(players);
    const tArea = areaAt(target.x, target.y);
    switch (ev.t) {
      case 'flicker': {
        const areaId = Math.random() < 0.6 && tArea ? tArea.id : pick(AREAS).id;
        this.flicker.set(areaId, this.time + rnd(3, 7));
        this.broadcast('fx', { type: 'flicker', area: areaId, until: rnd(3, 7) });
        for (const p of players) if (areaAt(p.x, p.y)?.id === areaId) p.fear = Math.min(100, p.fear + 6 * p.derived.fearMult);
        break;
      }
      case 'doorSlam': {
        const opts = DOORS.filter((d) => d.kind === 'normal' && this.doors.get(d.id).open && !this.doors.get(d.id).locked);
        const d = opts.length ? pick(opts) : null;
        if (d && this.setDoorOpen(d.id, false, null)) this.emitSfx('slam', d.x + 0.5, d.y + 0.5, 30);
        break;
      }
      case 'camFail': {
        const cam = pick(CAMERAS);
        this.camFail.set(cam.id, this.time + rnd(12, 25));
        this.broadcast('fx', { type: 'camFail', cam: cam.id });
        break;
      }
      case 'objectMove': {
        const g = [...this.ground.values()].find((x) => ITEMS[x.item]?.type !== 'quest');
        if (g) {
          const pt = randomFloorInArea(areaAt(g.x, g.y)?.id || 'salao');
          this.removeGround(g.id);
          this.addGround(g.item, pt.x, pt.y, g.amount);
          this.emitSfx('drag', pt.x, pt.y, 18);
        } else {
          const pt = randomFloorInArea(tArea?.id || 'salao');
          this.emitSfx('drag', pt.x, pt.y, 18);
        }
        this.broadcast('fx', { type: 'whisper', text: fala('arrastado') });
        break;
      }
      case 'sound': {
        const pt = randomFloorInArea(pick(AREAS.filter((a) => !a.outdoor)).id);
        const s = pick(['laugh', 'music', 'steps', 'metal', 'child']);
        this.emitSfx(s, pt.x, pt.y, 40);
        this.addNoise(pt.x, pt.y, 9, 'event');
        break;
      }
      case 'apparition': {
        const ang = Math.random() * Math.PI * 2;
        this.sendTo(target, 'fx', { type: 'apparition', x: r2(target.x + Math.cos(ang) * 3.5), y: r2(target.y + Math.sin(ang) * 3.5), kind: pick(TYPE_LIST.slice(0, 4)) });
        target.fear = Math.min(100, target.fear + 18 * target.derived.fearMult);
        break;
      }
      case 'routeChange': {
        const a = this.anims.filter((x) => !x.def.trap && x.def.patrol.length && ['IDLE', 'PATROL', 'RETURN'].includes(x.state));
        if (a.length) {
          const an = pick(a);
          const pt = randomFloorInArea(tArea && an.def.patrol.includes(tArea.id) ? tArea.id : pick(an.def.patrol));
          an.investigate(pt.x, pt.y);
          this.emitSfx('steps', an.x, an.y, 20);
        }
        break;
      }
      case 'whisper': {
        this.broadcast('fx', { type: 'whisper', text: pick(LORE.whispers) });
        this.room.systemMessage(`▒▒ ${pick(LORE.whispers)} ▒▒`, true);
        break;
      }
      case 'phone': {
        this.phoneUntil = this.time + 20;
        const o = OBJECT_BY_ID.o_telefone;
        this.emitSfx('phone', o.x + 0.5, o.y + 0.5, Infinity);
        this.broadcast('fx', { type: 'whisper', text: fala('telefoneTocando') });
        break;
      }
      case 'coin': {
        const gated = { porao: 'd_porao', sala_secreta: 'd_secreta', deposito: 'd_deposito' };
        const area = pick(AREAS.filter((a) => !gated[a.id] || !this.doors.get(gated[a.id]).locked));
        const pt = randomFloorInArea(area.id);
        this.addGround('money', pt.x, pt.y, 50 + Math.floor(Math.random() * 60));
        this.broadcast('fx', { type: 'whisper', text: fala('dourado', { area: area.name }) });
        break;
      }
      case 'thunder': {
        this.broadcast('fx', { type: 'thunder', i: Math.round(rnd(0.5, 1) * 100) / 100 });
        for (const pl of players) if (areaAt(pl.x, pl.y)?.outdoor) pl.fear = Math.min(100, pl.fear + 5);
        break;
      }
      case 'surge': {
        this.power = Math.max(0, this.power - 4);
        for (const a of AREAS) this.flicker.set(a.id, this.time + 2);
        this.broadcast('fx', { type: 'surge' });
        break;
      }
    }
  }

  triggerFinal() {
    this.finalTriggered = true;
    for (const a of this.anims) a.wake();
    for (const a of AREAS) this.flicker.set(a.id, this.time + 6);
    this.broadcast('fx', { type: 'final' });
    this.system(fala('rFinal'));
  }

  shutdownMaestro() {
    this.maestroDown = true;
    for (const a of this.anims) {
      if (a.type === 'maestro') a.disable();
      else a.stun(14);
    }
    this.broadcast('fx', { type: 'shutdown' });
    this.system(fala('rDesligado'));
  }

  // ======================================================================
  // Snapshots
  // ======================================================================
  sendSnapshots() {
    const list = this.inGamePlayers().filter((p) => p.online);
    const ps = this.inGamePlayers().map((p) => [
      p.id, r2(p.x), r2(p.y), Math.round(p.dir * 100) / 100,
      (p.alive ? 1 : 0) | (p.hidden ? 2 : 0) | (p.flash && p.battery > 0 ? 4 : 0) | (p.sprinting ? 8 : 0) | (p.online ? 16 : 0) | (p.cam ? 32 : 0) | (p.sneaking ? 64 : 0),
      Math.round((p.hp / p.derived.maxHp) * 100),
    ]);
    const base = {
      t: Math.round(this.time * 1000),
      d: this.duration,
      pw: Math.round(this.power * 10) / 10,
      li: this.lightsOn ? 1 : 0,
      bo: this.blackout ? 1 : 0,
      cb: this.camerasBroken ? 1 : 0,
      rs: this.respawnsLeft,
      ps,
    };
    for (const p of list) {
      const an = [];
      const heard = [];
      const eyes = [];
      const cam = p.cam && this.cameraWorking(p.cam) ? CAMERA_BY_ID[p.cam] : null;
      for (const a of this.anims) {
        if (a.state === 'DISABLED' && !this.playerSees(p, a.x, a.y)) continue;
        let visible = this.playerSees(p, a.x, a.y);
        if (!visible && cam && Math.abs(a.x - cam.cx) <= cam.vw / 2 && Math.abs(a.y - cam.cy) <= cam.vh / 2) visible = true;
        if (!p.alive && Math.hypot(a.x - p.x, a.y - p.y) < 9) visible = true;
        if (visible) {
          an.push([a.id, TYPE_LIST.indexOf(a.type), r2(a.x), r2(a.y), Math.round(a.dir * 100) / 100, STATE_CODE[a.state], a.moving ? 1 : 0]);
        } else {
          const d = Math.hypot(a.x - p.x, a.y - p.y);
          if (p.alive && d < 13 && !['DISABLED', 'DORMANT'].includes(a.state) && !a.def.trap
            && lineOfSight(p.x, p.y, a.x, a.y, (id) => this.isDoorClosed(id))) {
            eyes.push([TYPE_LIST.indexOf(a.type), Math.round(a.x * 2) / 2, Math.round(a.y * 2) / 2, a.state === 'CHASE' ? 1 : 0]);
          }
          if (!a.moving) continue;
          if (d < 15) heard.push([TYPE_LIST.indexOf(a.type), Math.round(d), Math.round((Math.atan2(a.y - p.y, a.x - p.x) / Math.PI) * 8), a.state === 'CHASE' ? 1 : 0]);
        }
      }
      const me = {
        hp: Math.max(0, Math.round(p.hp)), mhp: p.derived.maxHp,
        st: Math.round(p.stamina), mst: p.derived.maxStamina,
        fe: Math.round(p.fear), bat: Math.round(p.battery),
        seq: p.lastSeq,
        stun: this.time < p.stunUntil ? 1 : 0,
        boost: this.time < p.boostUntil ? 1 : 0,
        hid: p.hidden,
        cam: p.cam,
        camOk: cam ? 1 : 0,
        act: p.action ? [p.action.kind, Math.round(Math.min(1, p.action.kind === 'repair' ? p.action.t : p.action.t / p.action.dur) * 100) / 100] : null,
        rsp: p.respawnAt ? Math.max(0, Math.ceil(p.respawnAt - this.time)) : 0,
        hn: p.hints,
        lit: this.isLitAt(p.x, p.y) ? 1 : 0,
        br: Math.round(p.breath),
        wt: (() => { const w = this.watchOf(p); return w.lvl > 0 ? [Math.round(w.lvl * 100) / 100, Math.round((Math.atan2(w.who.y - p.y, w.who.x - p.x) / Math.PI) * 8), TYPE_LIST.indexOf(w.who.type), r2(Math.hypot(w.who.x - p.x, w.who.y - p.y))] : null; })(),
        hb: p.holdBreath ? 1 : 0,
        thr: p.threat ? 1 : 0,
      };
      this.sendTo(p, 'snap', { ...base, an, hr: heard, ey: eyes, me });
    }
  }

  /** Estado completo enviado ao entrar/reconectar */
  fullState(p) {
    return {
      night: this.night,
      difficulty: this.difficulty,
      title: this.cfg.title,
      intro: this.cfg.intro,
      duration: this.duration,
      you: p.id,
      animatronics: this.cfg.animatronics,
      players: this.inGamePlayers().map((o) => ({ id: o.id, name: o.name, color: o.color, level: o.level })),
      doors: [...this.doors].map(([id, st]) => ({ id, open: st.open, locked: !!st.locked })),
      containers: [...this.containers].filter(([, c]) => c.searched).map(([id]) => id),
      ground: [...this.ground.values()],
      quests: this.questView(),
      flicker: [],
      progress: { level: p.level, xp: p.xp, xpToNext: xpToNext(p.level), money: p.money, xpGained: p.xpGained, moneyGained: p.moneyGained },
      inventory: { inventory: p.inv, equipment: p.equipment, attrs: p.attrs, derived: p.derived },
      pos: { x: p.x, y: p.y },
      seq: p.lastSeq,
    };
  }

  // ======================================================================
  // Conexões
  // ======================================================================
  onDisconnect(accountId) {
    const p = this.players.get(accountId);
    if (!p || p.saved) return;
    p.online = false;
    p.offlineSince = this.time;
    p.inputs = [];
    p.cam = null;
    p.action = null;
    if (p.hidden) this.unhide(p);
    this.system(fala('rDesconectou', { nome: p.name }));
  }

  onReconnect(accountId, socketId) {
    const p = this.players.get(accountId);
    if (!p || p.saved) return false;
    p.online = true;
    p.socketId = socketId;
    p.inputs = [];
    this.sendTo(p, 'match:start', this.fullState(p));
    this.system(fala('rReconectou', { nome: p.name }));
    return true;
  }

  hasPlayer(accountId) {
    const p = this.players.get(accountId);
    return !!p && !p.saved;
  }

  removePlayer(p, reason) {
    if (p.saved) return;
    for (const [id, q] of Object.entries(p.inv)) {
      if (ITEMS[id]?.type === 'quest') {
        for (let i = 0; i < q; i++) this.addGround(id, p.x, p.y);
        delete p.inv[id];
      }
    }
    this.saveProgress(p, false);
    p.saved = true;
    p.online = false;
    if (reason) this.system(fala('rSaiu', { nome: p.name }));
  }

  saveProgress(p, won, trueEnding = false) {
    try {
      saveMatchProgress(p.id, {
        level: p.level, xp: p.xp, money: p.money, pointsGained: p.pointsGained,
        maxNight: won ? Math.min(FINAL_NIGHT, this.night + 1) : 1,
        inventory: p.inv, played: true, won, night: this.night,
        deaths: p.stats.deaths, missions: p.stats.missions, itemsFound: p.stats.itemsFound,
        jumpscares: p.stats.jumpscares, seconds: this.time, trueEnding,
      });
    } catch (err) {
      console.error('[match] falha ao salvar progresso', p.id, err);
    }
  }

  checkEnd() {
    if (this.ended) return;
    const inGame = this.inGamePlayers();
    if (!inGame.length) return this.endMatch('aborted', 'empty');
    if (inGame.every((p) => !p.online) && this.time - Math.max(...inGame.map((p) => p.offlineSince)) > 15) return this.endMatch('aborted', 'offline');
    const anyAlive = inGame.some((p) => p.alive);
    const anyRespawning = inGame.some((p) => !p.alive && p.respawnAt);
    if (!anyAlive && !anyRespawning) return this.endMatch('defeat', 'wiped');
    if (this.time >= this.duration) {
      const q = this.quests.find((x) => x.def.type === 'survive');
      if (q && !q.done) this.completeQuest(q, null);
      this.endMatch('victory', 'dawn');
    }
  }

  endMatch(result, reason) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.interval);
    const won = result === 'victory';
    const trueEnding = won && this.night === FINAL_NIGHT && this.maestroDown;
    const summary = [];
    for (const p of this.players.values()) {
      if (!p.saved) {
        if (result === 'defeat') { this.giveXp(p, 20); }
        for (const id of Object.keys(p.inv)) if (ITEMS[id]?.type === 'quest') delete p.inv[id];
        this.saveProgress(p, won, trueEnding);
        p.saved = true;
      }
      summary.push({
        id: p.id, name: p.name, level: p.level, levelsGained: p.levelsGained, pointsGained: p.pointsGained,
        xpGained: p.xpGained, moneyGained: p.moneyGained, deaths: p.stats.deaths, missions: p.stats.missions,
        itemsFound: p.stats.itemsFound, alive: p.alive,
      });
    }
    const payload = {
      result, reason, night: this.night, title: this.cfg.title, difficulty: this.diff.name,
      trueEnding, badEnding: won && this.night === FINAL_NIGHT && !this.maestroDown,
      nextNight: won && this.night < FINAL_NIGHT ? this.night + 1 : null,
      seconds: Math.round(this.time),
      quests: this.questView(),
      players: summary,
    };
    this.broadcast('match:end', payload);
    this.room.onMatchEnd(payload);
  }

  destroy() {
    this.ended = true;
    clearInterval(this.interval);
  }
}

export { tileAt, TILE };
