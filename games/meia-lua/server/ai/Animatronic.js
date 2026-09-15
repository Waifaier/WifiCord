// IA de animatrônico executada no servidor (máquina de estados).
// IDLE → PATROL → INVESTIGATE → CHASE → SEARCH → RETURN (+ STUNNED, DORMANT, DISABLED)
import { ANIM_TYPES } from './types.js';
import { findPath } from './pathfinding.js';
import { lineOfSight, randomFloorInArea, areaAt, doorAtTile, DOOR_BY_ID } from '../../shared/map.js';

let nextId = 1;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Animatronic {
  constructor(type, match) {
    this.id = nextId++;
    this.type = type;
    this.def = ANIM_TYPES[type];
    this.match = match;
    this.x = this.def.home.x;
    this.y = this.def.home.y;
    this.dir = Math.PI / 2;
    this.state = this.def.dormant ? 'DORMANT' : 'IDLE';
    this.stateTime = 0;
    this.stateDur = rnd(...this.def.idle) + Math.random() * 6; // escalonamento inicial
    this.path = null;
    this.pathIdx = 0;
    this.goal = null;
    this.repath = 0;
    this.targetId = null;
    this.lastSeen = null;
    this.lostTime = 0;
    this.attackCd = 0;
    this.chaseTime = 0;
    this.tiredUntil = 0;
    this.rollUntil = 0;
    this.doorWait = null;
    this.bash = null;
    this.alertCd = 0;
    this.blinkCd = 25;
    this.senseCd = Math.random() * 0.2;
    this.moving = false;
    this.stepAcc = 0;
    // "Ligando": ficam desligados no palco nos primeiros segundos da noite
    const baseAggr = (match.cfg?.aggression || 1) + (match.diff?.aggr || 0);
    this.bootUntil = this.def.trap || this.def.dormant ? 0 : rnd(16, 30) / (0.7 + 0.3 * baseAggr);
    if (this.def.trap) {
      const spot = pick(this.def.spots.filter((sp) => match.areaAccessible(areaAt(sp.x, sp.y)?.id)));
      if (spot) { this.x = spot.x; this.y = spot.y; }
      this.dir = Math.PI / 2;
      this.trapCd = 4;
      this.relocateCd = rnd(35, 60);
    }
  }

  get aggression() { return this.match.aggression; }

  setState(s, dur = 0) {
    if (this.state === 'DISABLED') return;
    const prev = this.state;
    this.state = s;
    this.stateTime = 0;
    this.stateDur = dur;
    this.path = null;
    this.doorWait = null;
    this.bash = null;
    if (s !== 'CHASE') this.chaseTime = 0;
    if (s === 'CHASE' && prev !== 'CHASE') {
      this.match.onAnimChase(this);
    }
  }

  goTo(x, y) {
    const cost = (id) => this.match.doorCostFor(this, id);
    const p = findPath(this.x, this.y, x, y, cost);
    this.goal = { x, y };
    if (p && p.length) { this.path = p; this.pathIdx = 0; return true; }
    this.path = null;
    return false;
  }

  stun(seconds) {
    if (this.state === 'DISABLED' || this.state === 'DORMANT') return;
    this.setState('STUNNED', seconds);
    this.targetId = null;
  }

  disable() {
    this.state = 'DISABLED';
    this.path = null;
    this.targetId = null;
  }

  wake() {
    if (this.state === 'DORMANT') this.setState('PATROL');
  }

  speedNow() {
    const m = 0.9 + 0.1 * this.aggression;
    let s = this.def.speed * m;
    if (this.state === 'CHASE') s = this.def.chase * m;
    if (this.state === 'INVESTIGATE') s = this.def.speed * m * 1.35;
    if (this.state === 'SEARCH') s = this.def.speed * m * 0.9;
    if (this.match.time < this.tiredUntil) s *= 0.5;
    if (this.match.time < this.rollUntil) s *= 1.35;
    if (this.match.blackout) s *= 1.1;
    return s;
  }

  // ---------- percepção ----------
  canSee(p) {
    if (!p.alive || p.hidden) return false;
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    const lit = this.match.isLitAt(p.x, p.y);
    let sight = this.def.sight * (0.85 + 0.15 * this.aggression);
    if (!lit) sight *= 0.6;
    const flash = p.flash && p.battery > 0;
    if (flash) sight *= 1.25;
    let fov = this.def.fov;
    if (this.def.lightSeeker) {
      if (flash) { sight = this.def.lightSight; fov = 360; }
      else if (!lit) sight = 2.5;
    }
    if (d > sight) return false;
    if (d > 1.6 && fov < 360) {
      const ang = Math.atan2(p.y - this.y, p.x - this.x);
      let diff = Math.abs(ang - this.dir) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff > (fov * Math.PI) / 360) return false;
    }
    return lineOfSight(this.x, this.y, p.x, p.y, (id) => this.match.isDoorClosed(id));
  }

  sense() {
    let best = null, bestD = Infinity;
    for (const p of this.match.alivePlayers()) {
      if (!this.canSee(p)) continue;
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  hear(noise) {
    if (['DISABLED', 'DORMANT', 'STUNNED', 'CHASE'].includes(this.state)) return;
    const d = Math.hypot(noise.x - this.x, noise.y - this.y);
    const range = Math.min(noise.radius * (this.def.hearing / 8), this.def.hearing) * (0.85 + 0.15 * this.aggression);
    if (d > range) return;
    if (this.state === 'INVESTIGATE' && this.goal && Math.hypot(this.goal.x - noise.x, this.goal.y - noise.y) < 2) return;
    this.investigate(noise.x, noise.y);
  }

  investigate(x, y) {
    if (this.def.trap) return;
    if (['DISABLED', 'DORMANT', 'STUNNED', 'CHASE'].includes(this.state)) return;
    this.setState('INVESTIGATE', 20);
    if (!this.goTo(x, y)) this.setState('SEARCH', 4);
  }

  // ---------- atualização ----------
  update(dt) {
    const m = this.match;
    if (this.state === 'DISABLED' || this.state === 'DORMANT') { this.moving = false; return; }
    if (this.def.trap) { this.updateTrap(dt); return; }
    if (m.time < this.bootUntil) { this.moving = false; this.dir += dt * 0.2; return; }
    this.stateTime += dt;
    this.attackCd -= dt;
    this.alertCd -= dt;

    if (this.state === 'STUNNED') {
      this.moving = false;
      if (this.stateTime >= this.stateDur) this.setState('SEARCH', 3);
      return;
    }

    // Percepção (5x por segundo)
    this.senseCd -= dt;
    if (this.senseCd <= 0) {
      this.senseCd = 0.2;
      const seen = this.sense();
      if (seen) {
        if (this.state !== 'CHASE' && this.state !== 'ALERT' && m.time >= this.tiredUntil) {
          const d = Math.hypot(seen.x - this.x, seen.y - this.y);
          const instant = d < 2.3 || (m.blackout && d < 4) || (this.state === 'SEARCH' && d < 3.5);
          if (instant) {
            this.targetId = seen.id;
            this.setState('CHASE');
          } else {
            // percebeu algo: para, encara e a suspeita vai enchendo
            const wasInvestigating = this.state === 'INVESTIGATE';
            this.setState('ALERT');
            this.noticeTarget = seen.id;
            this.notice = wasInvestigating ? 0.35 : 0.05;
            this.lastSeen = { x: seen.x, y: seen.y };
            m.onAnimNotice(this, seen);
          }
        } else if (this.state === 'ALERT' && seen.id !== this.noticeTarget) {
          const cur = m.players.get(this.noticeTarget);
          if (!cur || !this.canSee(cur)) this.noticeTarget = seen.id;
        }
        if (this.state === 'CHASE' && seen.id === this.targetId) {
          this.lastSeen = { x: seen.x, y: seen.y };
          this.lostTime = 0;
        } else if (this.state === 'CHASE') {
          // trocar de alvo se o novo estiver bem mais perto
          const t = m.players.get(this.targetId);
          if (!t || !this.canSee(t)) { this.targetId = seen.id; this.lastSeen = { x: seen.x, y: seen.y }; this.lostTime = 0; }
        }
      }
    }

    // Tonho congela quando observado pela câmera (fora de perseguição)
    if (this.def.shyOnCamera && this.state !== 'CHASE' && m.isWatchedOnCamera(this.x, this.y)) {
      this.moving = false;
      return;
    }

    switch (this.state) {
      case 'IDLE': this.moving = false; this.dir += dt * 0.7; if (this.stateTime >= this.stateDur) this.startPatrol(); break;
      case 'PATROL': this.updatePatrol(dt); break;
      case 'INVESTIGATE': this.updateInvestigate(dt); break;
      case 'CHASE': this.updateChase(dt); break;
      case 'SEARCH': this.updateSearch(dt); break;
      case 'RETURN': this.updateReturn(dt); break;
      case 'ALERT': this.updateAlert(dt); break;
    }

    // Maestro: pisca para perto dos jogadores quando está entediado
    if (this.def.blinks && (this.state === 'PATROL' || this.state === 'IDLE')) {
      this.blinkCd -= dt;
      if (this.blinkCd <= 0) { this.blinkCd = rnd(22, 34) / this.aggression; m.animBlink(this); }
    }
  }

  // Pipoca: armadilha sonora parada que muda de lugar quando ninguém vê
  updateTrap(dt) {
    const m = this.match;
    this.moving = false;
    this.stateTime += dt;
    if (this.state === 'STUNNED') { if (this.stateTime >= this.stateDur) { this.state = 'IDLE'; this.stateTime = 0; } return; }
    if (this.state === 'CHASE') { if (this.stateTime > 2.4) { this.state = 'IDLE'; this.stateTime = 0; } return; }
    this.trapCd -= dt;
    this.relocateCd -= dt;
    const players = [...m.alivePlayers()];
    if (this.trapCd <= 0) {
      for (const p of players) {
        if (p.hidden) continue;
        const d = Math.hypot(p.x - this.x, p.y - this.y);
        const flash = p.flash && p.battery > 0;
        const loud = p.sprinting || (p.moved && !p.sneaking);
        const range = 3.8 + 0.4 * this.aggression;
        if (!((d < range && loud) || (d < range + 3 && flash) || (d < 1.3 && p.moved))) continue;
        if (!lineOfSight(this.x, this.y, p.x, p.y, (id) => m.isDoorClosed(id))) continue;
        this.face(p.x, p.y);
        this.state = 'CHASE';
        this.stateTime = 0;
        this.trapCd = 10 / (0.8 + 0.2 * this.aggression);
        m.trapClash(this, p);
        return;
      }
    }
    if (this.relocateCd <= 0) {
      this.relocateCd = rnd(40, 70);
      const watched = players.some((p) => m.playerSees(p, this.x, this.y)) || m.isWatchedOnCamera(this.x, this.y);
      if (watched) return;
      const spots = this.def.spots.filter((sp) => m.areaAccessible(areaAt(sp.x, sp.y)?.id)
        && players.every((p) => Math.hypot(p.x - sp.x, p.y - sp.y) > 6 && !m.playerSees(p, sp.x, sp.y)));
      if (spots.length) { const sp = pick(spots); this.x = sp.x; this.y = sp.y; }
    }
  }

  updateAlert(dt) {
    const m = this.match;
    this.moving = false;
    const t = m.players.get(this.noticeTarget);
    if (t && this.canSee(t)) {
      this.face(t.x, t.y);
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      let rate = 0.75 + (1 - Math.min(1, d / (this.def.sight + 2))) * 2.1;
      if (m.isLitAt(t.x, t.y)) rate *= 1.25;
      if (t.flash && t.battery > 0) rate *= 1.4;
      if (t.sprinting) rate *= 1.6;
      if (t.sneaking) rate *= 0.55;
      if (d < 2.3) rate = 99;
      rate *= 0.75 + 0.25 * this.aggression;
      this.notice += rate * dt;
      this.lastSeen = { x: t.x, y: t.y };
      if (this.notice >= 1) { this.targetId = t.id; this.notice = 0; this.setState('CHASE'); }
    } else {
      this.notice -= dt * 0.4;
      if (this.notice <= 0) {
        this.notice = 0;
        const ls = this.lastSeen;
        if (ls) this.investigate(ls.x, ls.y);
        else this.startPatrol();
      }
    }
  }

  startPatrol() {
    const m = this.match;
    let areaId;
    const players = [...m.alivePlayers()];
    // comportamento influenciado pelos jogadores: às vezes vai para a área onde há alguém
    if (players.length && Math.random() < 0.22 + 0.1 * this.aggression) {
      let target = pick(players);
      if (this.def.lightSeeker) {
        const lit = players.filter((p) => p.flash && p.battery > 0);
        if (lit.length) target = pick(lit);
      }
      const a = areaAt(target.x, target.y);
      if (a && this.def.patrol.includes(a.id)) areaId = a.id;
    }
    if (!areaId) areaId = pick(this.def.patrol);
    const pt = randomFloorInArea(areaId);
    this.setState('PATROL', 40);
    if (!this.goTo(pt.x, pt.y)) this.setState('IDLE', 1.5);
  }

  followPath(dt) {
    if (!this.path || this.pathIdx >= this.path.length) { this.moving = false; return true; }
    const m = this.match;
    const node = this.path[this.pathIdx];
    const tx = Math.floor(node.x), ty = Math.floor(node.y);
    const door = doorAtTile(tx, ty);
    if (door && m.isDoorClosed(door.id)) {
      const st = m.doors.get(door.id);
      if (st.locked) { this.path = null; this.moving = false; return true; }
      if (door.kind === 'power' && m.power > 0) {
        if (this.def.bashDoors) return this.bashDoor(door, dt);
        this.path = null; this.moving = false; return true;
      }
      // abrir porta normal
      this.moving = false;
      if (!this.doorWait || this.doorWait.id !== door.id) this.doorWait = { id: door.id, t: 0 };
      this.doorWait.t += dt;
      this.face(node.x, node.y);
      if (this.doorWait.t >= this.def.doorTime / (0.8 + 0.2 * this.aggression)) {
        m.setDoorOpen(door.id, true, null);
        this.doorWait = null;
      }
      return false;
    }
    const step = this.speedNow() * dt;
    const dx = node.x - this.x, dy = node.y - this.y;
    const d = Math.hypot(dx, dy);
    this.face(node.x, node.y);
    this.moving = true;
    if (d <= step) {
      this.x = node.x; this.y = node.y; this.pathIdx++;
      return this.pathIdx >= this.path.length;
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    return false;
  }

  bashDoor(door, dt) {
    const m = this.match;
    this.moving = false;
    if (!this.bash || this.bash.id !== door.id) this.bash = { id: door.id, t: 0, hits: 0 };
    this.bash.t += dt;
    if (this.bash.t >= 1.6) {
      this.bash.t = 0;
      this.bash.hits++;
      m.power = Math.max(0, m.power - 3);
      m.emitSfx('bash', door.x + 0.5, door.y + 0.5, 16);
      m.addNoise(door.x + 0.5, door.y + 0.5, 6, 'bash');
      if (this.bash.hits >= 4) {
        m.forceDoorOpen(door.id, 8);
        this.bash = null;
      }
    }
    return false;
  }

  face(x, y) {
    const a = Math.atan2(y - this.y, x - this.x);
    if (Number.isFinite(a)) this.dir = a;
  }

  updatePatrol(dt) {
    const done = this.followPath(dt);
    if (done || this.stateTime > this.stateDur) {
      if (Math.random() < 0.25) this.setState('RETURN');
      else this.setState('IDLE', rnd(...this.def.idle) / this.aggression * 0.6);
    }
  }

  updateInvestigate(dt) {
    const done = this.followPath(dt);
    if (done || this.stateTime > this.stateDur) this.setState('SEARCH', rnd(3, 6));
  }

  updateSearch(dt) {
    if (!this.path || this.pathIdx >= this.path.length) {
      const base = this.lastSeen || { x: this.x, y: this.y };
      const tx = base.x + rnd(-4, 4), ty = base.y + rnd(-4, 4);
      if (!this.goTo(tx, ty)) { this.dir += dt * 3; this.moving = false; }
    } else this.followPath(dt);
    if (this.stateTime >= this.stateDur) { this.lastSeen = null; this.setState('RETURN'); }
  }

  updateReturn(dt) {
    if (!this.path) {
      if (!this.goTo(this.def.home.x, this.def.home.y)) { this.startPatrol(); return; }
    }
    const done = this.followPath(dt);
    if (done) this.setState('IDLE', rnd(...this.def.idle) / this.aggression);
  }

  updateChase(dt) {
    const m = this.match;
    const target = m.players.get(this.targetId);
    if (!target || !target.alive) { this.setState('SEARCH', 4); return; }

    // Alvo se escondeu
    if (target.hidden) {
      const d = Math.hypot(target.x - this.x, target.y - this.y);
      if (d < 1.4 && target.hideSeenBy?.has(this.id)) {
        m.pullFromHiding(target, this);
        return;
      }
      if (!target.hideSeenBy?.has(this.id)) { this.lastSeen = { x: target.x, y: target.y }; this.setState('SEARCH', rnd(4, 7)); return; }
    }

    this.chaseTime += dt;
    this.lostTime += dt;
    if (this.lostTime > 1.6 + 0.3 * this.aggression) { this.setState('SEARCH', rnd(5, 9)); return; }

    // habilidades
    if (this.def.chaseLimit && this.chaseTime > this.def.chaseLimit) {
      this.tiredUntil = m.time + this.def.tiredTime;
      m.emitSfx('tired', this.x, this.y, 10);
      this.setState('SEARCH', this.def.tiredTime);
      return;
    }
    if (this.def.rolls && this.chaseTime > 3 && m.time > this.rollUntil + 4) {
      this.rollUntil = m.time + 2;
      m.emitSfx('roll', this.x, this.y, 12);
    }
    if (this.def.conductor && this.alertCd <= 0) {
      this.alertCd = 3.5;
      m.conductAlert(this, target);
    }

    const dist = Math.hypot(target.x - this.x, target.y - this.y);
    if (dist < 0.85 && this.attackCd <= 0 && !target.hidden) {
      this.attackCd = 2.2;
      m.damagePlayer(target, this);
      if (this.def.rolls && m.time < this.rollUntil) { this.stun(1.4); return; }
      this.setState('SEARCH', 3);
      this.stateTime = 0;
      this.tiredUntil = m.time + 1.2; // recuo após atacar
      return;
    }

    this.repath -= dt;
    const goal = this.lastSeen || { x: target.x, y: target.y };
    if (this.repath <= 0 || !this.path) {
      this.repath = 0.35;
      if (!this.goTo(goal.x, goal.y)) {
        // caminho bloqueado (porta blindada?) — vai até perto e procura
        this.setState('SEARCH', 4);
        return;
      }
    }
    if (dist < 1.2 && this.lostTime < 0.3) {
      // perto: vai direto
      const step = this.speedNow() * dt;
      this.face(target.x, target.y);
      const nx = this.x + Math.cos(this.dir) * Math.min(step, dist);
      const ny = this.y + Math.sin(this.dir) * Math.min(step, dist);
      if (lineOfSight(this.x, this.y, nx, ny, (id) => m.isDoorClosed(id)) && m.walkableFor(nx, ny)) { this.x = nx; this.y = ny; }
      this.moving = true;
    } else {
      this.followPath(dt);
    }
  }
}

export { DOOR_BY_ID };
