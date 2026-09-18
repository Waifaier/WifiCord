// IA de animatrônico executada no servidor (máquina de estados).
// IDLE → PATROL → INVESTIGATE → CHASE → SEARCH → RETURN (+ STUNNED, DORMANT, DISABLED)
import { ANIM_TYPES } from './types.js';
import { findPath } from './pathfinding.js';
import { lineOfSight, randomFloorInArea, areaAt, doorAtTile, DOOR_BY_ID } from '../../shared/map.js';

let nextId = 1;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Animatronic {
  constructor(type, match, activationAt) {
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
    this.blackoutHunt = false;
    this.blackoutTrackCd = 0;
    // Cooldown do EncounterResolver (ver server/ai/EncounterResolver.js e
    // Match.resolveEncounter) — sem isso, sense() rodando 5x/s reamostraria
    // o sorteio a cada 0.2s enquanto o jogador continuasse visível, o que
    // na prática anularia desfechos como 'nothing' (virariam só um atraso
    // de 1 tick em vez de um "não aconteceu nada" de verdade).
    this.encounterCd = 0;
    // Cooldown próprio do desfecho 'relocate' (pedido #6: deslocamento
    // anômalo precisa de cooldown — nunca virar um botão de teleporte).
    // Nome deliberadamente DIFERENTE do `relocateCd` que a Pipoca (armadilha,
    // ver def.trap) já usa pra própria mecânica de "só some se ninguém
    // vir" — são caminhos de código mutuamente exclusivos (Pipoca nunca
    // passa por sense()/updateAlert()/startBlackoutHunt(), só por
    // updateTrap()), mas reaproveitar o mesmo nome ia confundir leitura.
    this.encounterRelocateCd = 0;
    // Evento "O Show" (ver Match.runShowEvent) — enquanto true, a IA
    // normal fica pausada e ele só balança no palco, sem perceber nem
    // atacar ninguém (ver o early-return em update()).
    this.performing = false;
    // "Observante" (ver def.observant em types.js e OBSERVE abaixo):
    // cooldown antes da próxima tentativa, pra não ficar tentando entrar
    // em OBSERVE toda hora — e quem ele está observando agora, se algum.
    this.observeCd = rnd(10, 25);
    this.observeTargetId = null;
    // "Ligando": ficam desligados no palco até a hora combinada (ver
    // Match.js, que escalona cada um deles pra uma hora diferente da
    // noite em vez de todo mundo começar a andar quase junto). Se por
    // algum motivo não vier uma hora pronta, cai no sorteio antigo (só
    // pros primeiros segundos) como rede de segurança.
    const baseAggr = (match.cfg?.aggression || 1) + (match.diff?.aggr || 0);
    this.bootUntil = this.def.trap || this.def.dormant
      ? 0
      : (activationAt != null ? activationAt : rnd(16, 30) / (0.7 + 0.3 * baseAggr));
    if (this.def.trap) {
      const spot = pick(this.def.spots.filter((sp) => match.areaAccessible(areaAt(sp.x, sp.y)?.id)));
      if (spot) { this.x = spot.x; this.y = spot.y; }
      this.dir = Math.PI / 2;
      this.trapCd = 4;
      this.relocateCd = rnd(35, 60);
      this.hauntCd = rnd(18, 28);
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
    this.doorForce = null;
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

  // ---------- evento do apagão (Gregório) ----------
  // Chamado pelo Match quando a energia acaba. Ele para de rondar normal
  // e passa a "ouvir" o jogador mais próximo através das paredes — não
  // precisa mais enxergar de verdade, então só dá pra notar os olhos
  // vermelhos dele brilhando no escuro (o cliente já desenha isso sozinho
  // quando ele tá perto mas fora do campo de visão claro — ver S.eyes em
  // render.js). Esconder-se ainda funciona (updateChase trata isso).
  startBlackoutHunt() {
    if (this.blackoutHunt || this.state === 'DISABLED') return;
    const target = this.pickNearestPlayer();
    if (!target) return;
    // Passa pelo EncounterResolver com o gatilho 'blackout' — que pesa MUITO
    // mais chase que um relance normal (o apagão do Gregório precisa
    // continuar genuinamente perigoso), mas ainda não é garantido: às vezes
    // vira bloqueio de rota, porta se mexendo sozinha no escuro, um som
    // inexplicável — sem nunca deixar de passar pelo mesmo portão de
    // qualquer outra perseguição (firstChaseUnlocked, ver
    // Match.requestChase, chamado por dentro de resolveEncounter quando o
    // sorteio realmente dá 'chase').
    const outcome = this.match.resolveEncounter(this, target, 'blackout');
    if (outcome !== 'chase') return;
    this.blackoutHunt = true;
    this.blackoutTrackCd = 0;
    this.lastSeen = { x: target.x, y: target.y };
  }

  endBlackoutHunt() {
    if (!this.blackoutHunt) return;
    this.blackoutHunt = false;
    if (this.state === 'CHASE') this.setState('SEARCH', rnd(4, 7));
  }

  pickNearestPlayer() {
    let best = null, bestD = Infinity;
    for (const p of this.match.alivePlayers()) {
      if (p.hidden) continue;
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
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
    // Evento do Tonho: ele fica ousado quando ninguém tá de olho nas
    // câmeras faz tempo (é o oposto do congelar-quando-observado dele).
    if (this.def.shyOnCamera && this.state !== 'CHASE'
      && this.match.time - this.match.lastCamCheckAt > 18) s *= 1.18;
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
      if (flash) {
        sight = this.def.lightSight; fov = 360;
        // Evento da Lume: lanterna acesa direto por muito tempo vira uma
        // obsessão pra ela — passa a enxergar de bem mais longe.
        if (this.match.time - (p.flashOnSince || 0) > 12) sight *= 1.6;
      } else if (!lit) sight = 2.5;
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
    // Só quem tem o ouvido "ligado" no microfone (ver Match.playerVoiceNoise)
    // percebe barulho vindo da voz — os outros ignoram completamente,
    // mesmo perto, porque nunca chegam a "ouvir" isso de verdade.
    if (noise.source === 'voice' && !this.def.hearsVoice) return;
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
    if (this.performing) { this.moving = false; this.dir += dt * 0.4; return; }
    if (this.def.trap) { this.updateTrap(dt); return; }
    // O apagão do Gregório pula a espera de "ligar": se a energia acabar
    // antes da hora dele, o susto vale mais que a escala — ele já entra
    // caçando por audição em vez de ficar parado esperando o relógio.
    if (m.time < this.bootUntil && !this.blackoutHunt) { this.moving = false; this.dir += dt * 0.2; return; }
    this.stateTime += dt;
    this.attackCd -= dt;
    this.alertCd -= dt;
    this.encounterCd -= dt;

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
        // OBSERVE fica de fora dessa escalada automática de propósito —
        // enquanto ele está observando, "ver" o jogador é exatamente o
        // que está fazendo, não motivo pra virar ALERT/CHASE sozinho
        // (isso é decidido por updateObserve(), que só reage a distância
        // de verdade — ver lá embaixo). Sem essa exclusão, todo OBSERVE
        // viraria uma perseguição real quase na mesma hora, o que
        // contradiz o pedido de "presença sem ataque".
        if (this.state !== 'CHASE' && this.state !== 'ALERT' && this.state !== 'OBSERVE' && m.time >= this.tiredUntil) {
          const d = Math.hypot(seen.x - this.x, seen.y - this.y);
          const instant = d < 2.3 || (m.blackout && d < 4) || (this.state === 'SEARCH' && d < 3.5);
          if (instant) {
            // ANTES: chamava m.requestChase() direto — "viu de perto" SEMPRE
            // virava perseguição (ou aparição calma, antes do 1º chase
            // liberado). Isso era exatamente a regra fundamental que o
            // pedido de reformulação queria eliminar ("animatronic
            // apareceu = vai perseguir"). Agora passa pelo
            // EncounterResolver (ver Match.resolveEncounter) — só ELE pode
            // decidir chamar requestChase de verdade, entre 10 outras
            // possibilidades (nada acontece, observa, some, evento
            // ambiental, bloqueia rota, mexe na porta, aparição rápida,
            // desloca, foge, ou algo inexplicável). encounterCd evita
            // reamostrar isso a cada 0.2s enquanto o jogador continuar à
            // vista.
            if (this.encounterCd <= 0) m.resolveEncounter(this, seen, 'sense');
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

    // Tentativa de entrar em OBSERVE (ver types.js def.observant e
    // updateObserve() abaixo) — só a partir de PATROL/IDLE, só quem tem a
    // flag, com um cooldown entre tentativas e a chance vindo do
    // TensionDirector (mais provável quanto mais tensa a partida — ver
    // TensionDirector.observeBias, pedido #25).
    if (this.def.observant && (this.state === 'PATROL' || this.state === 'IDLE')) {
      this.observeCd -= dt;
      if (this.observeCd <= 0) {
        this.observeCd = rnd(14, 26);
        this.tryObserve();
      }
    }

    // Evento do apagão (Gregório): enquanto durar, ele atualiza a posição
    // "ouvida" do alvo direto (sem precisar de linha de visão), com uma
    // pequena folga pra não ficar oniscente — dá pra despistar se esconder.
    if (this.blackoutHunt && m.blackout) {
      this.blackoutTrackCd -= dt;
      if (this.blackoutTrackCd <= 0) {
        this.blackoutTrackCd = 1.6;
        const t = m.players.get(this.targetId);
        if (t && t.alive && !t.hidden) this.lastSeen = { x: t.x, y: t.y };
      }
    } else if (this.blackoutHunt && !m.blackout) {
      this.endBlackoutHunt();
    }

    switch (this.state) {
      case 'IDLE': this.moving = false; this.dir += dt * 0.7; if (this.stateTime >= this.stateDur) this.startPatrol(); break;
      case 'PATROL': this.updatePatrol(dt); break;
      case 'INVESTIGATE': this.updateInvestigate(dt); break;
      case 'CHASE': this.updateChase(dt); break;
      case 'SEARCH': this.updateSearch(dt); break;
      case 'RETURN': this.updateReturn(dt); break;
      case 'ALERT': this.updateAlert(dt); break;
      case 'OBSERVE': this.updateObserve(dt); break;
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
      return;
    }
    // Assombração: de vez em quando ela se teleporta pra um dos "spots"
    // mais perto de alguém — sem ninguém vendo — só pra tremeluzir a tela
    // e sussurrar. Não machuca, não persegue: é só pra mexer com a cabeça.
    this.hauntCd -= dt;
    if (this.hauntCd <= 0) {
      this.hauntCd = rnd(24, 40);
      const near = players.find((p) => !p.hidden
        && Math.hypot(p.x - this.x, p.y - this.y) > 5 && Math.hypot(p.x - this.x, p.y - this.y) < 22);
      if (!near) return;
      const watched = players.some((p) => m.playerSees(p, this.x, this.y)) || m.isWatchedOnCamera(this.x, this.y);
      if (watched) return;
      const spots = this.def.spots.filter((sp) => {
        const d = Math.hypot(sp.x - near.x, sp.y - near.y);
        return d > 2.5 && d < 8 && m.areaAccessible(areaAt(sp.x, sp.y)?.id) && !m.playerSees(near, sp.x, sp.y);
      });
      if (spots.length) {
        const sp = pick(spots);
        this.x = sp.x; this.y = sp.y;
        m.animHaunt(this, near);
      }
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
      if (this.notice >= 1) {
        this.notice = 0;
        // Mesma troca da percepção instantânea acima: a suspeita encheu,
        // mas o que acontece a seguir não é mais garantidamente uma
        // perseguição — passa pelo mesmo resolver (trigger 'alert' pesa
        // diferente de 'sense': já ficou de olho por um tempo, "nada
        // aconteceu" fica bem mais raro, mas ainda não impossível).
        if (this.encounterCd <= 0) m.resolveEncounter(this, t, 'alert');
      }
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

  // ---------- OBSERVE: presença sem ataque, com animatrônico de verdade ----------
  // Ver def.observant (types.js), o gatilho em update() e
  // TensionDirector.observeBias(). Reaproveita o mesmo fx 'sighting' que
  // o evento 'observando' de Match.js já manda quando NÃO tem bicho real
  // por trás — de propósito: o jogador nunca consegue diferenciar "isso é
  // de verdade" de "isso é só um efeito" só pelo que aparece na tela, e é
  // exatamente esse o ponto (pedido: "Eu realmente vi aquilo?").
  tryObserve() {
    const m = this.match;
    const bias = m.director?.observeBias() ?? 0;
    if (bias <= 0 || Math.random() > bias * 0.5) return;
    let best = null, bestD = Infinity;
    for (const p of m.alivePlayers()) {
      if (p.hidden) continue;
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < 7 || d > 15) continue;
      if (!lineOfSight(this.x, this.y, p.x, p.y, (id) => m.isDoorClosed(id))) continue;
      if (d < bestD) { best = p; bestD = d; }
    }
    if (best) this.startObserve(best);
  }

  startObserve(target) {
    this.setState('OBSERVE', rnd(3.5, 7));
    this.observeTargetId = target.id;
    this.path = null; this.goal = null;
    this.face(target.x, target.y);
    this.moving = false;
    // Só quem está sendo observado recebe o aviso — quem estiver em outra
    // sala não vê, não ouve, não sabe de nada (pedido #17: usar o
    // multiplayer como ferramenta de terror, eventos diferentes pra
    // jogadores diferentes).
    this.match.sendTo(target, 'fx', { type: 'sighting', x: this.x, y: this.y, kind: this.type });
  }

  updateObserve(dt) {
    const m = this.match;
    this.moving = false;
    const t = m.players.get(this.observeTargetId);
    if (!t || !t.alive || t.hidden) { this.endObserve(); return; }
    const d = Math.hypot(t.x - this.x, t.y - this.y);
    // Chegou perto demais: foge, não ataca — "presença sem ataque" de
    // verdade, nunca vira susto (pedido #15: nenhum jumpscare, nenhum
    // ataque, só a dúvida).
    if (d < 3) { this.endObserve(); return; }
    if (!lineOfSight(this.x, this.y, t.x, t.y, (id) => m.isDoorClosed(id))) { this.endObserve(); return; }
    this.face(t.x, t.y);
    if (this.stateTime >= this.stateDur) this.endObserve();
  }

  // Some sem ninguém ver pra onde foi — mesma técnica de
  // teleportAfterAttack (ponto longe de todo mundo, fora de linha de
  // visão de qualquer jogador), mas sem nenhuma das penalidades de "acabou
  // de atacar" (sem tiredUntil, sem susto pra ninguém).
  endObserve() {
    const m = this.match;
    const t = m.players.get(this.observeTargetId);
    this.observeTargetId = null;
    const areas = this.def.patrol.length ? this.def.patrol : [areaAt(this.x, this.y)?.id].filter(Boolean);
    for (let tries = 0; tries < 10; tries++) {
      const areaId = pick(areas);
      if (!m.areaAccessible(areaId)) continue;
      const pt = randomFloorInArea(areaId);
      if (!pt) continue;
      if (t && Math.hypot(pt.x - t.x, pt.y - t.y) < 5) continue;
      const seen = [...m.alivePlayers()].some((p) => !p.hidden && m.playerSees(p, pt.x, pt.y));
      if (seen) continue;
      this.x = pt.x; this.y = pt.y;
      break;
    }
    this.path = null; this.goal = null;
    this.dir = Math.random() * Math.PI * 2;
    this.setState('SEARCH', rnd(2, 4));
  }

  startPatrol() {
    const m = this.match;
    let areaId;
    const players = [...m.alivePlayers()];
    // Evento da Marola: quem fica parado no mesmo lugar por muito tempo
    // (acampando) vira o alvo preferido da próxima ronda dela — ela é
    // lenta, mas se ninguém se mexe, mais cedo ou mais tarde ela chega.
    const camper = this.def.campPunish
      ? players.find((p) => m.time - (p.stillSince || 0) > 25 && Math.hypot(p.x - this.x, p.y - this.y) < 16)
      : null;
    // comportamento influenciado pelos jogadores: às vezes vai para a área onde há alguém
    if (camper || (players.length && Math.random() < 0.22 + 0.1 * this.aggression)) {
      let target = camper || pick(players);
      if (this.def.lightSeeker) {
        const lit = players.filter((p) => p.flash && p.battery > 0);
        if (lit.length) target = pick(lit);
      }
      const a = areaAt(target.x, target.y);
      if (a && this.def.patrol.includes(a.id)) areaId = a.id;
    }
    if (!areaId) areaId = pick(this.def.patrol);
    let pt = randomFloorInArea(areaId);
    if (camper && areaId === areaAt(camper.x, camper.y)?.id) {
      // A área às vezes é grande (palco, salão...) e um ponto uniforme
      // nela pode cair longe demais de quem acampou pra "castigo" fazer
      // sentido — sorteia mais de um ponto e fica com o mais pertinho.
      let bestD = Math.hypot(pt.x - camper.x, pt.y - camper.y);
      for (let i = 0; i < 5; i++) {
        const cand = randomFloorInArea(areaId);
        const d = Math.hypot(cand.x - camper.x, cand.y - camper.y);
        if (d < bestD) { pt = cand; bestD = d; }
      }
    }
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
      // Gregório perseguindo e a porta comum é a única coisa entre ele e o
      // alvo: sequência em estágios (pedido #4), não uma espera silenciosa
      // de fração de segundo — ver forceDoorSequence() acima. Fora de
      // perseguição (rondando, investigando) ele continua abrindo do jeito
      // de sempre logo abaixo, sem drama nenhum.
      if (this.def.doorBreaker && this.state === 'CHASE') return this.forceDoorSequence(door, dt);
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
      this.teleportAfterAttack(target);
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

  // Depois de acertar o jogador, ele some dali em vez de ficar rondando
  // perto — teleporta pra outro ponto da própria rota de patrulha, longe
  // de quem acabou de atacar e fora da linha de visão de qualquer um, e
  // só depois entra em SEARCH (então quando o jogador se recupera do
  // susto, o bicho já não está mais ali).
  teleportAfterAttack(target) {
    const m = this.match;
    const ox = this.x, oy = this.y;
    const areas = this.def.patrol.length ? this.def.patrol : [areaAt(this.x, this.y)?.id].filter(Boolean);
    let placed = false;
    for (let tries = 0; tries < 14 && !placed; tries++) {
      const areaId = pick(areas);
      if (!m.areaAccessible(areaId)) continue;
      const pt = randomFloorInArea(areaId);
      if (!pt) continue;
      const d = Math.hypot(pt.x - target.x, pt.y - target.y);
      if (d < 5.5) continue;
      const seen = [...m.alivePlayers()].some((p) => !p.hidden && m.playerSees(p, pt.x, pt.y));
      if (seen) continue;
      this.x = pt.x; this.y = pt.y;
      placed = true;
    }
    this.path = null;
    this.goal = null;
    this.dir = Math.random() * Math.PI * 2;
    this.lostTime = 0;
    this.setState('SEARCH', rnd(3, 5));
    this.stateTime = 0;
    this.tiredUntil = m.time + 1.2; // recuo após atacar
    m.onAnimTeleportAway(this, target, ox, oy);
  }

  // ---------- reposicionamento silencioso (EncounterResolver) ----------
  // Mesmo algoritmo de busca de ponto que teleportAfterAttack/endObserve já
  // usavam (área da própria rota de patrulha, longe o bastante de quem se
  // quer evitar, fora da linha de visão de QUALQUER jogador) — extraído
  // aqui pra ser reaproveitado pelos desfechos 'vanish'/'flee'/'relocate'
  // do resolver (ver Match.resolveEncounter) sem duplicar a busca em cada
  // um. Só reposiciona — quem chama decide o estado/som depois.
  quietRelocate(minDist = 6, avoidTarget = null) {
    const m = this.match;
    const areas = this.def.patrol.length ? this.def.patrol : [areaAt(this.x, this.y)?.id].filter(Boolean);
    for (let tries = 0; tries < 14; tries++) {
      const areaId = pick(areas);
      if (!m.areaAccessible(areaId)) continue;
      const pt = randomFloorInArea(areaId);
      if (!pt) continue;
      if (avoidTarget && Math.hypot(pt.x - avoidTarget.x, pt.y - avoidTarget.y) < minDist) continue;
      const seen = [...m.alivePlayers()].some((p) => !p.hidden && m.playerSees(p, pt.x, pt.y));
      if (seen) continue;
      this.x = pt.x; this.y = pt.y;
      break;
    }
    this.path = null;
    this.goal = null;
    this.dir = Math.random() * Math.PI * 2;
  }

  // ---------- Gregório: forçar uma porta comum durante perseguição ----------
  // Pedido #4 explícito: NÃO instantâneo. Antes, doorTime do Gregório (0.4s
  // em types.js) fazia ele abrir qualquer porta comum quase sem o jogador
  // perceber — a "porta fechada" nunca chegava a parecer um obstáculo de
  // verdade. Isso só entra em ação quando ele está de fato perseguindo
  // (`this.state === 'CHASE'`) e tem a flag `doorBreaker` (só o Gregório,
  // ver types.js) — fora de perseguição ele continua abrindo portas comuns
  // do jeito antigo (silencioso, sem drama, porque não faria sentido rondar
  // arrombando toda porta fechada da pizzaria à toa).
  //
  // Estágios, cada um com um som PRÓPRIO (ver client/js/audio.js — todos já
  // existiam, nenhum som novo precisou ser inventado):
  //   1) silêncio total (~1-2s) — ele parou, o jogador só sabe disso pela
  //      ausência de qualquer outro som;
  //   2) 'locked' — um teste rápido, baixo, quase nada;
  //   3) 'drag'/'metal' repetidos — ele está pressionando/forçando de
  //      verdade, o som cresce;
  //   4) depois de tempo suficiente (~8-11s no total), 'doorBreak' de
  //      verdade via forceDoorOpen (mesma função que já existia).
  forceDoorSequence(door, dt) {
    const m = this.match;
    this.moving = false;
    this.face(door.x, door.y);
    if (!this.doorForce || this.doorForce.id !== door.id) {
      this.doorForce = { id: door.id, t: 0, stage: 0, hits: 0 };
    }
    const f = this.doorForce;
    f.t += dt;
    switch (f.stage) {
      case 0: // silêncio — o jogador só ouve o próprio coração
        if (f.t >= rnd(1.2, 2)) { f.stage = 1; f.t = 0; m.emitSfx('locked', door.x + 0.5, door.y + 0.5, 10); }
        break;
      case 1: // teste — pequeno movimento, som contido
        if (f.t >= rnd(1, 1.8)) {
          f.stage = 2; f.t = 0;
          m.emitSfx('drag', door.x + 0.5, door.y + 0.5, 16);
          m.addNoise(door.x + 0.5, door.y + 0.5, 8, 'forceDoor');
        }
        break;
      case 2: // forçando de verdade — cada golpe é mais alto que o anterior
        if (f.t >= 1.3) {
          f.t = 0;
          f.hits++;
          m.emitSfx('metal', door.x + 0.5, door.y + 0.5, 20);
          m.addNoise(door.x + 0.5, door.y + 0.5, 10, 'forceDoor');
          if (f.hits >= 3) {
            m.forceDoorOpen(door.id, 10);
            this.doorForce = null;
          }
        }
        break;
    }
    return false;
  }
}

export { DOOR_BY_ID };
