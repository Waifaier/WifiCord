// Cliente da partida: predição local, interpolação, renderização com shader, HUD, checklist, jumpscares e imersão.
import {
  OBJECTS, OBJECT_BY_ID, DOORS, DOOR_BY_ID, CAMERAS, CAMERA_BY_ID, moveWithCollision, areaAt, AREA_BY_ID, lineOfSight,
} from '/jogos/meia-lua/shared/map.js';
import { ITEMS, EQUIP_SLOTS, SLOT_NAMES } from '/jogos/meia-lua/shared/items.js';
import { ANIMATRONIC_INFO, NIGHTS, DIFFICULTIES } from '/jogos/meia-lua/shared/nights.js';
import { ATTRIBUTES, ATTR_NAMES } from '/jogos/meia-lua/shared/rpg.js';
import { areaProfile, AREA_AMBIENCE_LOOPS } from '/jogos/meia-lua/shared/areaProfiles.js';
import { Renderer, ANIM_TYPES, STATES } from './render.js';
import { PostFX } from './postfx.js';
import { audio } from './audio.js';
import { settings, isTouchDevice } from './settings.js';
import { $, el, toast, showScreen, PLAYER_COLORS } from './ui.js';
import { fala } from '/jogos/meia-lua/shared/falas.js';

const INPUT_MS = 50;
const INTERP_DELAY = 110;
const PLAYER_RADIUS = 0.3;
const INTERACT_RANGE = 1.7;

const BASICS = [
  { id: 'move', text: 'Dar uma volta pela pizzaria', hint: 'WASD ou joystick. Correr (Shift) faz barulho demais.' },
  { id: 'flash', text: 'Testar a lanterna', hint: 'F / 🔦. Gasta bateria... e a mariposa enxerga luz de longe.' },
  { id: 'sneak', text: 'Andar agachado quando tiver algo perto', hint: 'Segurar Espaço / 🤫. Assim quase não faço barulho.' },
  { id: 'search', text: 'Revirar alguma caixa ou armário', hint: 'E perto das caixas. Às vezes tem item, às vezes dinheiro.' },
  { id: 'hide', text: 'Achar um armário pra me esconder', hint: 'E no armário. Se chegar alguém perto, seguro o ar (Espaço).' },
  { id: 'cams', text: 'Dar uma olhada nas câmeras', hint: 'C perto de um monitor, na Segurança ou no Escritório.' },
  { id: 'map', text: 'Conferir o mapa', hint: 'M / 🗺. O que eu preciso fazer pisca em amarelo.' },
  { id: 'item', text: 'Usar alguma coisa da mochila', hint: 'Teclas 1-5. Bandagem cura, bateria volta a lanterna.' },
];

export class Game {
  constructor(app) {
    this.app = app;
    this.socket = app.socket;
    this.input = app.input;
    this.renderer = new Renderer();
    this.canvas = $('#game-canvas');
    this.ctx = this.canvas.getContext('2d');
    // Em celular, os shaders WebGL (CRT, aberração cromática etc.) deram
    // tela preta num aparelho de verdade mesmo com a opção desligada nas
    // configurações — o contexto WebGL ficava vivo (criado aqui sempre,
    // sem checar nada) mesmo sem uso, e algo nesse driver/GPU específico
    // não lidava bem com isso. Pra resolver de vez, em vez de só confiar
    // na configuração, nem criamos o contexto WebGL em celular: this.fx
    // fica null e as checagens abaixo (useFx/renderJumpscare) tratam isso
    // como "sem shader", igual a settings.fx === 'off'.
    this.fx = isTouchDevice() ? null : new PostFX($('#fx-canvas'));
    this.running = false;
    this.basicsDone = new Set();
    this.lastRenderErrorAt = 0;
    this.renderErrorStreak = 0;
    // Qualidade automática (ver watchAutoQuality() em frame()): fica ligada
    // só quando settings.quality === 'auto' e o FPS fica ruim por um tempo
    // sustentado — nunca mexe na escolha manual ('low' já força baixa
    // qualidade de qualquer jeito, ver resize()/frame()).
    this.autoLow = false;
    this._lowSince = 0;
    this._okSince = 0;
    this.bindSocket();
    this.bindInput();
    this.bindUi();
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    // Girar o celular (ou a barra de endereço do navegador
    // aparecer/sumir) às vezes não dispara um 'resize' a tempo — ou
    // dispara com innerHeight ainda desatualizado, um problema conhecido
    // em navegadores mobile enquanto a UI do navegador termina de
    // acomodar. Reforça com orientationchange + visualViewport, e mais
    // uma leitura um instante depois pra pegar o valor já assentado.
    window.addEventListener('orientationchange', () => { onResize(); setTimeout(onResize, 250); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    // Aba/app em segundo plano: suspende o áudio (silêncio "de verdade" em
    // vez do ambiente/loops continuarem consumindo bateria e CPU sem
    // ninguém ouvindo) e, ao voltar, religa e força um resize (a tela pode
    // ter mudado de tamanho enquanto estava em segundo plano). Não pausa o
    // resto do jogo: o rAF do loop de desenho já para sozinho em aba
    // oculta (comportamento padrão do navegador), e o servidor continua
    // sendo a fonte da verdade de qualquer forma.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (audio.ctx?.state === 'running') audio.ctx.suspend(); }
      else { audio.unlock(); if (this.running) this.resize(); }
    });
  }

  // ================================================================== ciclo de vida
  start(data) {
    this.stop();
    this.data = data;
    this.you = data.you;
    this.duration = data.duration;
    this.nightTitle = data.title;
    this.diffName = DIFFICULTIES[data.difficulty]?.name || '';
    this.names = new Map(data.players.map((p) => [p.id, p]));
    this.S = {
      t: performance.now() / 1000,
      doors: new Map(data.doors.map((d) => [d.id, { open: d.open, locked: d.locked }])),
      searched: new Set(data.containers),
      ground: new Map(data.ground.map((g) => [g.id, g])),
      hints: new Set(), targets: new Set(),
      players: [], anims: [], apparitions: [], flares: [], decoys: [], clashes: [], eyes: [], hallu: [],
      flicker: new Map(), lightsOn: true, blackout: false, phoneRinging: false, flash: 0, myHide: null,
      lowQuality: settings.quality === 'low',
    };
    this.autoLow = false;
    this._lowSince = 0;
    this._okSince = 0;
    this.snaps = [];
    this.offset = null;
    this.me = { hp: 100, mhp: 100, st: 100, mst: 100, fe: 0, bat: 100, seq: data.seq, alive: true, br: 100 };
    this.inv = data.inventory;
    this.progress = data.progress;
    this.quests = data.quests;
    this.updateTargets();
    this.pending = [];
    this.seq = data.seq || 0;
    this.pred = { ...data.pos };
    this.stepFrom = { ...data.pos };
    this.stepAt = performance.now();
    this.display = { ...data.pos };
    this.dir = -Math.PI / 2;
    this.lastSentMoving = false;
    this.camOpen = false;
    this.camId = this.camId || 'cam1';
    this.chaseUntil = 0;
    this.js = null;
    this.hurt = 0;
    this.glitch = 0;
    this.showActive = false;
    this.showLoopTimer = null;
    this.showBreakAt = Infinity;
    this.clockGlitchUntil = 0;
    this.walkAcc = 0;
    this.stepAcc = new Map();
    this.heardCd = new Map();
    this.nextHallu = 0;
    this.lastHud = 0;
    this.fps = 60;
    this.powerLow = false;
    this.breathHeld = false;
    this.tension = 0;
    this.zoom = 1;
    this.noticeToastAt = 0;
    this.beatAt = 0;

    showScreen('game', { push: false });
    document.body.classList.add('in-game');
    document.body.classList.toggle('touch', isTouchDevice());
    $('#touch').hidden = !isTouchDevice();
    for (const id of ['ov-cams', 'ov-map', 'ov-inv', 'ov-pause', 'ov-lore', 'ov-check']) $(`#${id}`).hidden = true;
    $('#game-chat').replaceChildren(...[...$('#lobby-chat').children].slice(-6).map((n) => n.cloneNode(true)));
    this.renderHotbar();
    this.renderQuests();
    this.showIntro();
    this.resize();
    this.input.enabled = true;
    this.input.clear();
    audio.unlock();
    this.running = true;
    this.inputTimer = setInterval(() => this.inputTick(), INPUT_MS);
    this.raf = requestAnimationFrame((ts) => this.frame(ts));
  }

  stop() {
    this.running = false;
    clearInterval(this.inputTimer);
    cancelAnimationFrame(this.raf);
    this.input.enabled = false;
    document.body.classList.remove('in-game');
    audio.stopAll();
    if (this.camOpen) this.closeCams(false);
    this.showActive = false;
    this.showBreakAt = Infinity;
    clearInterval(this.showLoopTimer);
    this.showLoopTimer = null;
    clearTimeout(this._showSafety);
    clearTimeout(this._showBreakSfx);
    $('#show-overlay')?.classList.remove('active');
    if ($('#show-overlay')) $('#show-overlay').hidden = true;
    $('#show-blackout')?.classList.remove('active');
    if ($('#show-blackout')) $('#show-blackout').hidden = true;
  }

  showIntro() {
    const ov = $('#ov-intro');
    $('#intro-title').textContent = this.data.title;
    $('#intro-text').textContent = this.data.intro;
    $('#intro-anims').textContent = `${this.diffName} · Hoje aqui dentro: ` + this.data.animatronics.map((a) => ANIMATRONIC_INFO[a].short).join(', ') + ' · (J: minhas anotações)';
    ov.hidden = false;
    ov.style.animation = 'none'; void ov.offsetWidth; ov.style.animation = '';
    setTimeout(() => { ov.hidden = true; }, 6200);
  }

  resize() {
    const low = this.S?.lowQuality || settings.quality === 'low';
    const dpr = low ? 1 : Math.min(settings.fx === 'high' ? 1.5 : 1.25, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.w = w; this.h = h;
  }

  mark(id) {
    if (this.basicsDone.has(id)) return;
    this.basicsDone.add(id);
    if (!$('#ov-check').hidden) this.renderChecklist();
  }

  // ================================================================== rede
  bindSocket() {
    const s = this.socket;
    s.on('snap', (m) => this.running && this.onSnap(m));
    s.on('door', (d) => { if (!this.running) return; this.S.doors.set(d.id, { open: d.open, locked: d.locked }); });
    s.on('container', (d) => this.running && this.S.searched.add(d.id));
    s.on('ground', (d) => {
      if (!this.running) return;
      if (d.add) this.S.ground.set(d.add.id, d.add);
      if (d.remove) this.S.ground.delete(d.remove);
    });
    s.on('quests', (q) => { if (!this.running) return; this.quests = q; this.updateTargets(); this.renderQuests(); if (!$('#ov-check').hidden) this.renderChecklist(); });
    s.on('inv', (inv) => { if (!this.running) return; this.inv = inv; this.renderHotbar(); if (!$('#ov-inv').hidden) this.renderInventory(); });
    s.on('progress', (p) => { if (this.running) this.progress = p; });
    s.on('fx', (f) => this.running && this.onFx(f));
  }

  onSnap(m) {
    const now = performance.now();
    const est = m.t - now;
    this.offset = this.offset === null ? est : this.offset * 0.92 + est * 0.08;
    if (Math.abs(est - this.offset) > 500) this.offset = est;
    this.snaps.push(m);
    if (this.snaps.length > 30) this.snaps.shift();
    this.last = m;
    this.me = { ...m.me, alive: false };
    const row = m.ps.find((p) => p[0] === this.you);
    if (row) {
      this.me.alive = !!(row[4] & 1);
      this.pending = this.pending.filter((i) => i.s > m.me.seq);
      let pos = { x: row[1], y: row[2] };
      let st = m.me.st;
      for (const i of this.pending) { const r = this.simulate(pos, i, st); pos = r.pos; st = r.st; }
      const err = Math.hypot(pos.x - this.pred.x, pos.y - this.pred.y);
      if (err > 0.02) {
        if (err > 2.5) this.display = { ...pos };
        this.pred = pos;
        this.stepFrom = { ...pos };
      }
    }
    this.S.lightsOn = !!m.li;
    if (m.bo && !this.S.blackout) audio.play('blackout');
    this.S.blackout = !!m.bo;
    this.S.hints = new Set(m.me.hn || []);
    this.S.myHide = m.me.hid;
    this.S.snapEyes = (m.ey || []).map(([ti, x, y, chase]) => ({ type: ANIM_TYPES[ti], x, y, chase, key: ti * 97 }));
    if (m.me.hid) this.mark('hide');
    if (m.me.cam) this.mark('cams');
    if (this.camOpen && (!this.me.alive || m.me.cam === null) && performance.now() - this.camOpenedAt > 800) this.closeCams(false);
    if (!m.me.hid && this.breathHeld) this.setBreath(false);
    for (const [ti, d, ang, chase] of m.hr) {
      const cd = this.heardCd.get(ti) || 0;
      if (now < cd) continue;
      this.heardCd.set(ti, now + (chase ? 280 : 520));
      const a = (ang / 8) * Math.PI;
      const type = ANIM_TYPES[ti];
      const vol = Math.max(0, 1 - d / 15);
      audio.play(type === 'lume' ? 'wings' : d < 5 ? 'stepNear' : 'animStep', { vol: vol * 0.95, pan: Math.cos(a) });
      if (type === 'gregorio' && d < 7 && settings.shake) this.shakeUntil = performance.now() + 120;
    }
  }

  simulate(pos, inp, st) {
    const me = this.me;
    const d = this.inv?.derived;
    if (!d || !this.meAliveNow() || me.hid || me.cam || me.stun) return { pos, st };
    const len = Math.hypot(inp.x, inp.y);
    if (len < 0.05) return { pos, st };
    const dx = len > 1 ? inp.x / len : inp.x, dy = len > 1 ? inp.y / len : inp.y;
    const sneak = !!inp.c;
    const sprint = !sneak && inp.r && st > 1;
    let speed = d.speed * (sprint ? 1.55 : sneak ? 0.5 : 1);
    if (me.fe >= 75) speed *= 0.85;
    if (me.boost) speed *= 1.2;
    const dt = INPUT_MS / 1000;
    const p = moveWithCollision(pos.x, pos.y, dx * speed * dt, dy * speed * dt, PLAYER_RADIUS, (id) => !this.S.doors.get(id)?.open);
    return { pos: p, st: sprint ? Math.max(0, st - 28 * dt) : st };
  }

  meAliveNow() {
    const row = this.last?.ps.find((p) => p[0] === this.you);
    return row ? !!(row[4] & 1) : true;
  }

  inputTick() {
    const v = this.input.vector();
    const moving = Math.hypot(v.x, v.y) > 0.05;
    if (!moving && !this.lastSentMoving) { this.stepFrom = { ...this.pred }; this.stepAt = performance.now(); return; }
    this.lastSentMoving = moving;
    const inp = { s: ++this.seq, x: v.x, y: v.y, r: v.sprint, c: v.sneak && !this.me.hid };
    this.socket.emit('input', inp);
    this.pending.push(inp);
    if (this.pending.length > 40) this.pending.shift();
    this.stepFrom = { ...this.pred };
    const r = this.simulate(this.pred, inp, this.me.st);
    this.pred = r.pos;
    this.stepAt = performance.now();
    if (moving) {
      this.dir = Math.atan2(v.y, v.x);
      this.mark('move');
      if (inp.c) this.mark('sneak');
    }
  }

  setBreath(hold) {
    if (this.breathHeld === hold) return;
    this.breathHeld = hold;
    this.socket.emit('breath', { hold });
  }

  // ================================================================== efeitos
  onFx(f) {
    const nowS = performance.now() / 1000;
    const pos = this.display;
    const spatial = (x, y, radius = 20) => {
      const d = Math.hypot(x - pos.x, y - pos.y);
      return { vol: Math.max(0, 1 - d / radius), pan: Math.max(-1, Math.min(1, (x - pos.x) / 10)) };
    };
    switch (f.type) {
      case 'notify':
        toast(f.text, f.kind);
        if (/^Encontrou|nada útil|vazio/.test(f.text)) this.mark('search');
        break;
      case 'sfx': {
        const far = ['phone', 'musicbox', 'conduct', 'laugh', 'music', 'child', 'metal', 'steps', 'slam', 'doorBreak', 'cymbals', 'radio'].includes(f.s) ? 40 : 20;
        const sp = f.s === 'conduct' ? { vol: 0.8, pan: 0 } : spatial(f.x, f.y, far);
        if (f.s === 'scream' && f.who === this.you) break;
        audio.play(f.s, sp);
        if (f.s === 'use') this.mark('item');
        if (f.s === 'click') this.mark('flash');
        if (f.s === 'phone') { this.S.phoneRinging = true; clearTimeout(this.phoneT); this.phoneT = setTimeout(() => (this.S.phoneRinging = false), 20000); }
        if (f.s === 'phonePick') this.S.phoneRinging = false;
        break;
      }
      case 'jumpscare': this.jumpscare(f.anim, f.fatal); break;
      case 'chase':
        if (f.target && nowS > this.chaseUntil - 3) {
          audio.play('chaseSting', { vol: 0.9 });
          toast(fala('meViu', { anim: ANIMATRONIC_INFO[f.anim].short }), 'danger', 2500);
          navigator.vibrate?.(120);
          this.glitch = Math.max(this.glitch, 0.8);
        }
        this.chaseUntil = nowS + 7;
        break;
      case 'flicker': this.S.flicker.set(f.area, nowS + (f.until || 4)); break;
      case 'surge': for (const id of Object.keys(AREA_BY_ID)) this.S.flicker.set(id, nowS + 2); audio.play('static', { vol: 0.6 }); this.glitch = 1; break;
      case 'blackout': toast(fala('apagao'), 'danger', 5000); this.glitch = 1; break;
      case 'powerRestored': audio.play('powerOn', { vol: 0.8 }); toast(fala('energiaVoltou'), 'good'); break;
      case 'lights': audio.play('breaker', { vol: 0.5 }); break;
      case 'camFail': if (this.camOpen && this.camId === f.cam) { audio.play('static', { vol: 0.8 }); this.glitch = 1; } break;
      // Câmera "de verdade" (ver o bloco de p.camGlanceCd em Match.js,
      // server) — a maior parte das vezes o servidor nem manda isso; a
      // câmera já mostra o mundo de verdade (animatrônicos de verdade
      // passando ali de vez em quando, ver render.js drawCamera), então
      // aqui só entra uma pitada sonora, nada visual forçado.
      case 'camGlitch':
        if (this.camOpen && this.camId === f.cam) {
          if (f.variant === 'flicker') audio.play('static', { vol: 0.32 });
          else if (f.variant === 'staticBlip') audio.play('static', { vol: 0.2 });
          else audio.play('breathDistant', { vol: 0.22 });
        }
        break;
      case 'camerasFixed': toast(fala('camerasOk'), 'good'); break;
      case 'camClose': this.closeCams(false); break;
      case 'openCams': this.openCams(); break;
      case 'apparition':
        this.S.hallu.push({ kind: 'figure', type: f.kind, x: f.x, y: f.y, dir: Math.random() * 6, start: nowS, dur: 0.9 });
        audio.play('whisper', { vol: 0.8 });
        this.glitch = Math.max(this.glitch, 0.6);
        break;
      case 'whisper': toast(f.text, 'whisper'); audio.play('whisper', { vol: 0.5 }); break;
      // "Silêncio" (ver o case 'silencio' em Match.js, server) — sem
      // toast, sem vibração, sem nada visual de propósito: é só o
      // ambiente sumindo por uns segundos (ver AudioSystem.duckAmbient) e
      // voltando sozinho, sem explicar o porquê.
      case 'silence': audio.duckAmbient(f.dur || 5); break;
      // "Presença" — um único jogador ouve isso (sendTo no servidor, não
      // broadcast), sem nenhuma imagem/aparição acompanhando: a
      // ambiguidade de "será que teve alguém aí?" é o ponto.
      case 'presence': audio.play('presence', { vol: 0.9 }); this.glitch = Math.max(this.glitch, 0.4); break;
      // Vulto rápido no limite da visão (ver o case 'vultoRapido' em
      // Match.js, server) — mesma técnica visual da apparition (silhueta
      // em S.hallu), só que bem mais curta e sem som/glitch/medo: às
      // vezes o "monstro" só passa e some, sem virar um susto de verdade.
      case 'glimpse':
        this.S.hallu.push({ kind: 'figure', type: f.kind, x: f.x, y: f.y, dir: Math.random() * 6, start: nowS, dur: 0.35 });
        break;
      // A criatura observando de longe, sem se aproximar (ver o case
      // 'observando' em Match.js) — usa o tipo real do animatrônico e
      // fica visível bem mais tempo que o glimpse acima, mas discreta:
      // nem todo encontro termina em ataque.
      case 'sighting':
        this.S.hallu.push({ kind: 'figure', type: f.kind, x: f.x, y: f.y, dir: Math.random() * 6, start: nowS, dur: 1.8 });
        audio.play('breathDistant', { vol: 0.3 });
        this.glitch = Math.max(this.glitch, 0.2);
        break;
      // Pulso de um susto falso (ver o case 'falsoAlarme' em Match.js) —
      // a tensão sobe e às vezes não dá em nada mesmo; o evento de
      // verdade, se vier, chega bem depois disso.
      case 'tensionPulse':
        audio.play('tensionPulse', spatial(f.x, f.y, 26));
        this.glitch = Math.max(this.glitch, 0.25);
        break;
      case 'questDone': toast(`${f.line || f.title}  (+${f.xp} XP, +$${f.money})`, 'quest', 5500); audio.play('quest', { vol: 0.8 }); break;
      case 'levelup': toast(fala('nivel', { n: f.level }), 'quest', 5000); audio.play('levelup', { vol: 0.8 }); break;
      case 'lore': this.showLore(f.title, f.text); break;
      case 'death':
        if (f.id === this.you) { toast(fala(f.respawn ? 'pego' : 'pegoFim'), 'danger', 5000); this.pending = []; }
        break;
      case 'respawn': this.pred = { x: f.x, y: f.y }; this.display = { x: f.x, y: f.y }; this.stepFrom = { ...this.pred }; this.pending = []; break;
      case 'final': toast(fala('cortinas'), 'whisper'); audio.play('final', { vol: 1 }); this.glitch = 1; break;
      case 'shutdown': toast(fala('desligouMaestro'), 'quest', 6000); audio.play('powerOn', { vol: 1 }); break;
      case 'flare': this.S.flares.push({ x: f.x, y: f.y, start: nowS }); break;
      case 'decoy': this.S.decoys.push({ x: f.x, y: f.y, until: nowS + f.dur }); break;
      case 'clash': {
        this.S.clashes.push({ x: f.x, y: f.y, start: nowS });
        const d = Math.hypot(f.x - pos.x, f.y - pos.y);
        if (d < 14) { this.glitch = Math.max(this.glitch, 0.9 - d / 20); if (settings.shake) this.shakeUntil = performance.now() + 350; }
        break;
      }
      case 'thunder':
        this.S.flash = f.i;
        setTimeout(() => { if (this.S) this.S.flash = Math.max(this.S.flash, f.i * 0.7); }, 140);
        setTimeout(() => audio.play('thunder', { vol: 0.9 }), 250 + Math.random() * 900);
        break;
      case 'notice':
        audio.play('notice', { vol: 0.9 });
        this.glitch = Math.max(this.glitch, 0.5);
        if (nowS - this.noticeToastAt > 7) { this.noticeToastAt = nowS; toast(fala('notando'), 'whisper'); }
        navigator.vibrate?.([40, 80, 40]);
        break;
      case 'actionCancel': break;
      case 'show':
        if (f.phase === 'start') this.startShowEvent(f.dur);
        else if (f.phase === 'end') this.endShowEvent();
        break;
      // Fases de verdade da "Hora do Show" (ver runShowEvent em Match.js)
      // — antes era só "começou/terminou"; agora cada fase intermediária
      // chega aqui com nome próprio, e é o que faz o show parecer uma
      // sequência (contexto → preparação → expectativa → evento → reação
      // → consequência → silêncio) em vez de um "liga/desliga".
      case 'showPhase':
        if (f.phase === 'atuacao' && f.feature) {
          this.showFeature = f.feature;
          const motif = { tonho: 'showFeatureTonho', marola: 'showFeatureMarola', lume: 'showFeatureLume', gregorio: 'showFeatureGregorio', maestro: 'showFeatureMaestro' }[f.feature];
          if (motif) audio.play(motif, { vol: this.showMusicVol ?? 0.6 });
        } else if (f.phase === 'falhaSutil') {
          // só a luz pisca (já tratado pelo fx 'flicker' que o servidor
          // manda junto) — nenhuma reação extra aqui de propósito, é pra
          // "ninguém perceber".
        } else if (f.phase === 'estranho') {
          audio.play('showGlitch', { vol: 0.5 });
          this.glitch = Math.max(this.glitch, 0.18);
        }
        // 'quebra' não precisa de reação própria aqui — o cliente já tem
        // seu próprio timer local pra esse instante (showBreakAt, ver
        // startShowEvent), que dispara a quebra visual/sonora sozinho.
        // Este fx existe só pra manter a narrativa de fases consistente
        // caso algo no futuro precise reagir a ela também.
        break;
      case 'choir':
        audio.play('choir', { vol: 0.7 });
        this.glitch = Math.max(this.glitch, 0.35);
        navigator.vibrate?.(60);
        break;
      case 'clockGlitch':
        this.clockGlitchUntil = nowS + (f.secs || 4);
        audio.play('static', { vol: 0.3 });
        this.glitch = Math.max(this.glitch, 0.3);
        break;
    }
  }

  // Evento "O Show": susto muito do nada — animatrônicos somem do mapa e
  // reaparecem no palco, portas ao redor travam, luzes coloridas + música.
  // Ver Match.runShowEvent/endShowEvent no servidor.
  startShowEvent(dur) {
    this.showActive = true;
    const d = dur || 18;
    // últimos ~1.8s: eles "quebram" (ver sprites.js) pouco antes do apagão
    this.showBreakAt = performance.now() / 1000 + Math.max(2, d - 1.8);
    const ov = $('#show-overlay');
    ov.hidden = false;
    requestAnimationFrame(() => ov.classList.add('active'));
    $('#show-overlay-text').textContent = 'O SHOW VAI COMEÇAR...';
    setTimeout(() => { if (this.showActive) $('#show-overlay-text').textContent = ''; }, 2200);
    audio.play('showtimeSting', { vol: 1 });
    navigator.vibrate?.([200, 100, 200, 100, 400]);
    this.glitch = 1;
    if (settings.shake) this.shakeUntil = performance.now() + 600;
    clearInterval(this.showLoopTimer);
    // o loop de música (showtimeLoop) dura ~4s de fato (ver audio.js) —
    // reencadeia um pouco antes de terminar pra não deixar buraco de silêncio.
    this.showLoopTimer = setInterval(() => { if (this.showActive) audio.play('showtimeLoop', { vol: this.showMusicVol ?? 0.7 }); }, 3700);
    clearTimeout(this._showBreakSfx);
    this._showBreakSfx = setTimeout(() => {
      if (!this.showActive) return;
      audio.play('metal', { vol: 0.6 });
      audio.play('static', { vol: 0.5 });
      navigator.vibrate?.([80, 40, 80, 40, 160]);
    }, Math.max(0, d - 1.8) * 1000);
    clearTimeout(this._showSafety);
    this._showSafety = setTimeout(() => { if (this.showActive) this.endShowEvent(); }, (d + 3) * 1000);
  }

  endShowEvent() {
    this.showActive = false;
    this.showBreakAt = Infinity;
    clearInterval(this.showLoopTimer);
    this.showLoopTimer = null;
    clearTimeout(this._showSafety);
    clearTimeout(this._showBreakSfx);
    const ov = $('#show-overlay');
    ov.classList.remove('active');
    ov.hidden = true;
    const bo = $('#show-blackout');
    bo.hidden = false;
    bo.classList.add('active');
    this.glitch = 1;
    setTimeout(() => {
      bo.classList.remove('active');
      setTimeout(() => { bo.hidden = true; }, 950);
    }, 950);
  }

  jumpscare(type, fatal) {
    const now = performance.now() / 1000;
    this.js = { type, fatal, start: now, dur: fatal ? 1.9 : 1.1 };
    audio.play(fatal ? 'jumpscareFatal' : 'jumpscare', { vol: 1, variant: type });
    navigator.vibrate?.(fatal ? [300, 80, 500] : [180, 60, 250]);
    if (this.camOpen) this.closeCams(false);
    this.hurt = 1;
    this.glitch = 1;
    if (settings.shake) this.shakeUntil = performance.now() + (fatal ? 1400 : 700);
    for (const id of ['ov-map', 'ov-inv', 'ov-check', 'ov-lore']) $(`#${id}`).hidden = true;
  }

  showLore(title, text) {
    $('#lore-title').textContent = title;
    $('#lore-text').textContent = text;
    $('#ov-lore').hidden = false;
  }

  updateTargets() {
    const t = new Set();
    for (const q of this.quests) {
      if (q.done || !q.active) continue;
      const def = this.findQuestDef(q.id);
      if (!def) continue;
      if (def.target && OBJECT_BY_ID[def.target]) t.add(def.target);
      for (const x of def.targets || []) t.add(x);
    }
    if (this.S) this.S.targets = t;
  }

  findQuestDef(id) {
    return NIGHTS[this.data.night]?.quests.find((q) => q.id === id);
  }

  /** Próximo objetivo com posição conhecida (para a seta). */
  currentObjective() {
    for (const q of this.quests) {
      if (q.done || !q.active) continue;
      const def = this.findQuestDef(q.id);
      if (!def) continue;
      let pt = null;
      if (def.type === 'unlock') { const d = DOOR_BY_ID[def.target]; pt = { x: d.x + 0.5, y: d.y + 0.5 }; }
      else if (def.targets) {
        const o = def.targets.map((id) => OBJECT_BY_ID[id]).sort((a, b) => Math.hypot(a.x - this.pred.x, a.y - this.pred.y) - Math.hypot(b.x - this.pred.x, b.y - this.pred.y))[0];
        pt = { x: o.x + 0.5, y: o.y + 0.5 };
      } else if (def.target && OBJECT_BY_ID[def.target]) {
        const o = OBJECT_BY_ID[def.target];
        pt = { x: o.x + 0.5, y: o.y + 0.5 };
      } else if (def.type === 'collect') {
        const near = [...this.S.hints].map((id) => OBJECT_BY_ID[id]).sort((a, b) => Math.hypot(a.x - this.pred.x, a.y - this.pred.y) - Math.hypot(b.x - this.pred.x, b.y - this.pred.y))[0];
        if (near) pt = { x: near.x + 0.5, y: near.y + 0.5 };
      }
      if (def.type === 'deliver' && !((this.inv?.inventory?.[def.item] || 0) > 0)) {
        return { q, def, pt: null, text: `${q.title}: alguém precisa trazer ${ITEMS[def.item].name.toLowerCase()}` };
      }
      if (def.type === 'survive') continue;
      return { q, def, pt, text: q.title };
    }
    const sv = this.quests.find((q) => !q.done && this.findQuestDef(q.id)?.type === 'survive');
    return sv ? { q: sv, def: this.findQuestDef(sv.id), pt: null, text: 'Aguentar até as 6:00' } : null;
  }

  // ================================================================== entrada/UI
  bindInput() {
    const I = this.input;
    I.on('interact', () => this.interact());
    I.on('flash', () => this.socket.emit('flashlight', {}));
    I.on('cams', () => (this.camOpen ? this.closeCams() : this.openCams()));
    I.on('map', () => { this.toggleOverlay('map'); this.mark('map'); });
    I.on('inv', () => this.toggleOverlay('inv'));
    I.on('checklist', () => this.toggleOverlay('check'));
    I.on('menu', () => this.escape());
    I.on('chat', () => this.openChat());
    I.on('chatClose', () => this.closeChat());
    I.on('hotbar', (i) => { const it = this.hotbarItems()[i]; if (it) this.socket.emit('useItem', { item: it }); });
    I.on('camPrev', () => this.camOpen && this.switchCam(-1));
    I.on('camNext', () => this.camOpen && this.switchCam(1));
    I.on('pttDown', () => this.app.voice?.active && this.app.voice.setTalking(true));
    I.on('pttUp', () => this.app.voice?.active && this.app.voice.setTalking(false));
    I.on('spaceDown', () => { if (this.me.hid) this.setBreath(true); });
    I.on('spaceUp', () => this.setBreath(false));
  }

  bindUi() {
    $('#game-chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('#game-chat-form input');
      if (inp.value.trim()) this.socket.emit('chat:send', { text: inp.value });
      inp.value = '';
      this.closeChat();
    });
    $('#btn-close-cams').addEventListener('click', () => this.closeCams());
    $('#hb-menu').addEventListener('click', () => this.escape());
    $('#hb-check').addEventListener('click', () => this.toggleOverlay('check'));
    for (const b of document.querySelectorAll('#scr-game [data-close]')) b.addEventListener('click', () => { $(`#ov-${b.dataset.close}`).hidden = true; });
    $('#btn-leave-match').addEventListener('click', () => {
      if (!confirm('Abandonar a partida? Seu progresso até agora será salvo.')) return;
      this.socket.emit('match:leave', {});
      this.stop();
      this.app.backToLobby();
    });
    $('#btn-pause-settings').addEventListener('click', () => { $('#ov-pause').hidden = true; showScreen('settings'); });
    const buttons = $('#cam-buttons');
    for (const cam of CAMERAS) {
      buttons.append(el('button', { 'data-cam': cam.id, text: cam.name.split('·')[0].trim(), title: cam.name, onclick: () => this.setCam(cam.id) }));
    }
  }

  escape() {
    if (!$('#game-chat-form').hidden) return this.closeChat();
    if (this.camOpen) return this.closeCams();
    for (const id of ['ov-map', 'ov-inv', 'ov-lore', 'ov-check']) if (!$(`#${id}`).hidden) { $(`#${id}`).hidden = true; return; }
    $('#ov-pause').hidden = !$('#ov-pause').hidden;
  }

  toggleOverlay(name) {
    const ov = $(`#ov-${name}`);
    const show = ov.hidden;
    for (const id of ['ov-map', 'ov-inv', 'ov-check']) $(`#${id}`).hidden = true;
    if (show && this.camOpen) this.closeCams();
    ov.hidden = !show;
    if (show && name === 'map') this.renderer.drawFullMap($('#map-canvas'), this.S, this.you);
    if (show && name === 'inv') this.renderInventory();
    if (show && name === 'check') this.renderChecklist();
  }

  openChat() {
    const f = $('#game-chat-form');
    f.hidden = false;
    this.input.clear();
    f.querySelector('input').focus();
  }
  closeChat() {
    const f = $('#game-chat-form');
    f.hidden = true;
    f.querySelector('input').blur();
  }

  nearConsole() {
    return OBJECTS.some((o) => o.type === 'console' && Math.hypot(o.x + 0.5 - this.pred.x, o.y + 0.5 - this.pred.y) <= 2.3);
  }

  openCams() {
    if (!this.me.alive && this.last) { toast(fala('semCameras')); return; }
    if (!this.inv?.derived?.tablet && !this.nearConsole()) { toast(fala('camSemMonitor'), 'warn'); return; }
    this.camOpen = true;
    this.camOpenedAt = performance.now();
    $('#ov-cams').hidden = false;
    for (const id of ['ov-map', 'ov-inv', 'ov-check']) $(`#${id}`).hidden = true;
    this.setCam(this.camId);
    audio.play('static', { vol: 0.5 });
    this.renderCamDoors();
  }

  closeCams(notify = true) {
    this.camOpen = false;
    $('#ov-cams').hidden = true;
    audio.setLoop('static', 0);
    if (notify) this.socket.emit('camera', { cam: null });
  }

  setCam(id) {
    this.camId = id;
    this.camOpenedAt = performance.now();
    this.socket.emit('camera', { cam: id });
    for (const b of $('#cam-buttons').children) b.classList.toggle('active', b.dataset.cam === id);
    audio.play('static', { vol: 0.35 });
    this.glitch = Math.max(this.glitch, 0.7);
  }

  switchCam(d) {
    const i = CAMERAS.findIndex((c) => c.id === this.camId);
    this.setCam(CAMERAS[(i + d + CAMERAS.length) % CAMERAS.length].id);
  }

  renderCamDoors() {
    const box = $('#cam-doors');
    box.replaceChildren();
    if (!this.nearConsole()) return;
    for (const d of DOORS.filter((x) => x.kind === 'power')) {
      const st = this.S.doors.get(d.id);
      box.append(el('button', { class: st?.open ? '' : 'closed', text: `${st?.open ? '🔓' : '🔒'} ${d.name.replace('Porta Blindada ', '')}`, onclick: () => { this.socket.emit('remoteDoor', { door: d.id }); setTimeout(() => this.renderCamDoors(), 150); } }));
    }
  }

  // ------------------------------------------------------------------ interação
  candidates() {
    const p = this.pred;
    const list = [];
    for (const o of OBJECTS) {
      const d = Math.hypot(o.x + 0.5 - p.x, o.y + 0.5 - p.y);
      if (d <= INTERACT_RANGE) list.push({ kind: 'obj', id: o.id, d, o });
    }
    for (const dr of DOORS) {
      const d = Math.hypot(dr.x + 0.5 - p.x, dr.y + 0.5 - p.y);
      if (d <= INTERACT_RANGE) list.push({ kind: 'door', id: dr.id, d: d + 0.05, dr });
    }
    for (const g of this.S.ground.values()) {
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d <= 1.3) list.push({ kind: 'ground', id: 'g' + g.id, d: d - 0.3, g });
    }
    return list.sort((a, b) => a.d - b.d);
  }

  promptText(c) {
    if (c.kind === 'ground') return `Pegar ${c.g.item === 'money' ? `$${c.g.amount}` : ITEMS[c.g.item]?.name}`;
    if (c.kind === 'door') {
      const st = this.S.doors.get(c.id);
      if (st?.locked) return `${c.dr.name} (trancada)`;
      return `${st?.open ? 'Fechar' : 'Abrir'} ${c.dr.name}${c.dr.kind === 'power' ? ' ⚡' : ''}`;
    }
    const o = c.o;
    switch (o.type) {
      case 'container': return this.S.searched.has(o.id) ? `${o.name} (vazio)` : `Revistar ${o.name}`;
      case 'hide': return `Esconder-se: ${o.name}`;
      case 'console': return 'Ver câmeras';
      case 'breaker': return this.S.lightsOn ? 'Desligar luzes' : 'Ligar luzes';
      case 'campanel': case 'generator': return `Consertar ${o.name} (fique perto)`;
      case 'phone': return this.S.phoneRinging ? 'Atender telefone!' : 'Telefone';
      case 'document': return `Ler ${o.name}`;
      case 'lore': return `Ver ${o.name}`;
      case 'gate': return 'Abrir portão';
      default: return `Usar ${o.name}`;
    }
  }

  interact() {
    if (this.js) return;
    if (this.me.hid) { this.socket.emit('interact', {}); return; }
    const c = this.candidates()[0];
    this.socket.emit('interact', { target: c?.id });
  }

  // Reduz efeitos sozinho se o FPS ficar ruim por um tempo sustentado, e só
  // volta a subir depois de ficar bom por bem mais tempo ainda — essa
  // assimetria (histerese) é de propósito, pra não ficar oscilando entre
  // qualidade alta/baixa quadro a quadro perto do limiar. Só age quando a
  // pessoa deixou em "Automática"; a escolha manual ('low') nunca é
  // sobrescrita por isto aqui.
  watchAutoQuality(now) {
    if (settings.quality !== 'auto') { this.autoLow = false; this._lowSince = 0; this._okSince = 0; return; }
    if (this.fps < 40) { this._okSince = 0; if (!this._lowSince) this._lowSince = now; if (now - this._lowSince > 2500) this.autoLow = true; }
    else { this._lowSince = 0; }
    if (this.fps > 52) { this._lowSince = 0; if (!this._okSince) this._okSince = now; if (now - this._okSince > 5000) this.autoLow = false; }
    else { this._okSince = 0; }
    if (this.S) this.S.lowQuality = settings.quality === 'low' || this.autoLow;
  }

  // ================================================================== render loop
  frame() {
    if (!this.running) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05;
    this.watchAutoQuality(now);
    const S = this.S;
    S.t = now / 1000;
    S.flash = Math.max(0, S.flash - dt * 2.2);
    this.hurt = Math.max(0, this.hurt - dt * 1.1);
    this.glitch = Math.max(0, this.glitch - dt * 1.6);

    const k = Math.min(1, (now - this.stepAt) / INPUT_MS);
    const tx = this.stepFrom.x + (this.pred.x - this.stepFrom.x) * k;
    const ty = this.stepFrom.y + (this.pred.y - this.stepFrom.y) * k;
    const sm = 1 - Math.exp(-dt * 22);
    const oldX = this.display.x, oldY = this.display.y;
    this.display.x += (tx - this.display.x) * sm;
    this.display.y += (ty - this.display.y) * sm;
    const moved = Math.hypot(this.display.x - oldX, this.display.y - oldY);

    this.buildEntities(now, moved);
    S.hallu = S.hallu.filter((a) => S.t - a.start < a.dur);
    S.flares = S.flares.filter((f) => S.t - f.start < 6);
    S.decoys = S.decoys.filter((d) => S.t < d.until);
    S.clashes = S.clashes.filter((c) => S.t - c.start < 1.3);
    this.updateHallucinations();

    // tensão: alguém está me encarando
    const wt = this.me.wt;
    const target = wt && this.me.alive ? wt[0] : 0;
    this.tension += (target - this.tension) * Math.min(1, dt * (target > this.tension ? 6 : 1.4));
    this.zoom += ((1 + this.tension * 0.16) - this.zoom) * Math.min(1, dt * 3);
    if (this.tension > 0.25) {
      const bpm = 70 + this.tension * 110;
      if (S.t - this.beatAt > 60 / bpm) {
        this.beatAt = S.t;
        audio.play('heartbeatFast', { vol: 0.35 + this.tension * 0.6 });
        if (this.tension > 0.7) navigator.vibrate?.(30);
      }
    }

    // proximidade de perseguidor aumenta o glitch
    let nearest = Infinity;
    for (const a of S.anims) if (a.state === 'CHASE' && a.type !== 'pipoca') nearest = Math.min(nearest, Math.hypot(a.x - this.display.x, a.y - this.display.y));
    if (nearest < 4) this.glitch = Math.max(this.glitch, (4 - nearest) / 5);

    if (this.me.alive && !this.me.hid) {
      const v = this.input.vector();
      this.walkAcc += moved;
      if (this.walkAcc > (v.sprint ? 0.9 : 0.7)) { this.walkAcc = 0; if (!v.sneak) audio.play('step', { vol: v.sprint ? 0.6 : 0.4 }); }
    }

    let view = { x: this.display.x, y: this.display.y };
    if (!this.me.alive && !this.me.rsp) {
      const ally = S.players.find((p) => p.alive && !p.self);
      if (ally) view = { x: ally.x, y: ally.y };
    }
    const scale = Math.max(30, Math.min(64, Math.min(this.w, this.h) / 15)) * this.zoom;
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.shakeUntil && now < this.shakeUntil) {
      const m = (this.js ? 14 : 5);
      c.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }

    // ---- Tudo daqui pra baixo desenha o mundo/câmeras/jumpscare no canvas.
    // drawWorld() começa limpando pra preto (ctx.fillRect preto) e só DEPOIS
    // desenha o cenário por cima — então qualquer exceção no meio desse
    // bloco (um sprite faltando, um dado inesperado vindo do servidor etc.)
    // deixava a tela travada nesse preto inicial PRA SEMPRE, silenciosamente,
    // porque o requestAnimationFrame do próximo quadro já tinha sido
    // reagendado lá em cima (de propósito, pra um erro não travar o loop
    // inteiro) — só que sem isso aqui, cada novo quadro repetia o mesmo erro
    // e nunca sobrava nada visível além do preto. Agora qualquer falha
    // aparece num aviso na tela (com a mensagem do erro) em vez de só
    // desaparecer, então dá pra saber exatamente o que quebrou.
    try {
      if (this.js && S.t - this.js.start < this.js.dur) {
        this.renderer.drawJumpscare(c, this.w, this.h, this.js, S.t);
        const e = S.t - this.js.start;
        this.hurt = e < 0.2 ? 0.9 : 0.35;
        this.glitch = e < 0.2 ? 0.8 : 0.25;
      } else if (this.camOpen) {
        this.js = null;
        const cam = CAMERA_BY_ID[this.camId];
        const ok = !!this.me.camOk;
        this.renderer.drawCamera(c, this.w, this.h, cam, S, ok);
        $('#cam-name').textContent = cam.name;
        $('#cam-time').textContent = this.clockText();
        $('#cam-status').textContent = ok ? '' : this.last?.cb ? 'CÂMERAS DANIFICADAS' : this.last?.pw <= 0 ? 'SEM ENERGIA' : 'SINAL PERDIDO';
        audio.setLoop('static', ok ? 0.08 : 0.35);
      } else {
        this.js = null;
        const v = { cx: view.x, cy: view.y, scale };
        this.renderer.drawWorld(c, this.w, this.h, v, S);
        this.renderer.drawLighting(c, this.w, this.h, v, S, { light: this.inv?.derived?.light || 3.5, alive: this.me.alive, battery: this.me.bat });
        if (this.tension > 0.02) {
          // barras de cinema fechando e borda avermelhada
          const bar = this.h * 0.11 * Math.min(1, this.tension * 1.3);
          c.fillStyle = '#000';
          c.fillRect(0, 0, this.w, bar);
          c.fillRect(0, this.h - bar, this.w, bar);
          const pulse = 0.5 + 0.5 * Math.sin(S.t * (6 + this.tension * 10));
          const g = c.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * (0.42 - this.tension * 0.18), this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.62);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(1, `rgba(${90 + pulse * 60},0,4,${this.tension * (0.45 + pulse * 0.2)})`);
          c.fillStyle = g;
          c.fillRect(0, 0, this.w, this.h);
        }
        if (this.me.hid) {
          c.fillStyle = 'rgba(0,0,0,.72)'; c.fillRect(0, 0, this.w, this.h);
          for (let i = 0; i < 9; i++) { c.fillStyle = 'rgba(0,0,0,.92)'; c.fillRect(0, (i * this.h) / 9, this.w, this.h / 15); }
        }
        if (!settings.fx || settings.fx === 'off' || !this.fx || !this.fx.ok) {
          const fear = this.me.fe || 0;
          if (fear > 30 || this.me.hp < this.me.mhp * 0.35) {
            const g = c.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.25, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.7);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, `rgba(60,0,10,${Math.min(0.6, (fear - 30) / 120 + (this.me.hp < this.me.mhp * 0.35 ? 0.3 : 0))})`);
            c.fillStyle = g;
            c.fillRect(0, 0, this.w, this.h);
          }
        }
      }
      this.renderErrorStreak = 0;
    } catch (err) {
      this.renderErrorStreak++;
      // listra vermelha diagonal em vez de deixar preto puro — dá pra
      // distinguir "travou desenhando" de "ainda carregando"/tela preta comum
      c.fillStyle = '#1a0000';
      c.fillRect(0, 0, this.w, this.h);
      c.strokeStyle = 'rgba(220,40,40,.5)';
      c.lineWidth = 3;
      for (let i = -this.h; i < this.w; i += 26) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + this.h, this.h); c.stroke(); }
      if (now - this.lastRenderErrorAt > 4000) {
        this.lastRenderErrorAt = now;
        console.error('[game] falha ao desenhar o quadro:', err);
        toast(`Erro ao desenhar o jogo: ${err?.message || err} — manda um print disso pro suporte`, 'danger', 8000);
      }
    }
    if (settings.showFps) { c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.fillStyle = '#7f7'; c.font = '12px monospace'; c.fillText(`${Math.round(this.fps)} fps`, 8, this.h - 8); }

    // pós-processamento (this.fx é null em celular — ver construtor)
    const useFx = settings.fx !== 'off' && !!this.fx && this.fx.ok;
    const scr = $('#scr-game');
    scr.classList.toggle('fx-on', useFx);
    scr.classList.toggle('cam-open', this.camOpen && !this.js);
    scr.classList.toggle('js-on', !!this.js);
    if (useFx) {
      const lit = !!this.me.lit;
      this.fx.render(this.canvas, {
        time: (now / 1000) % 1000,
        fear: Math.min(1, Math.max((this.me.fe || 0) / 100, this.tension * 0.95)),
        hurt: Math.min(1, this.hurt + (this.me.hp < this.me.mhp * 0.3 ? 0.15 + Math.sin(S.t * 5) * 0.08 : 0)),
        glitch: Math.min(1, this.glitch + this.tension * (0.12 + 0.12 * Math.sin(S.t * 13))),
        blackout: S.blackout ? 1 : 0,
        cam: this.camOpen ? 1 : 0,
        flash: S.flash,
        // autoLow (ver watchAutoQuality) também baixa o nível do shader,
        // não só o resto do jogo — é o efeito mais caro de todos.
        high: settings.fx === 'high' && !this.autoLow ? 1 : 0,
        dark: lit ? 0 : 1,
      });
    }

    this.updateAudio(now);
    if (now - this.lastHud > 100) { this.lastHud = now; this.updateHud(); }
  }

  updateHallucinations() {
    const S = this.S;
    const fear = this.me.fe || 0;
    if (!this.me.alive || this.me.hid || this.camOpen || fear < 55 || S.t < this.nextHallu) return;
    this.nextHallu = S.t + 4 + Math.random() * (14 - fear / 10);
    if (Math.random() > (fear - 45) / 80) return;
    const ang = Math.random() * Math.PI * 2;
    const dist = 4.5 + Math.random() * 3.5;
    const x = this.display.x + Math.cos(ang) * dist, y = this.display.y + Math.sin(ang) * dist;
    if (!lineOfSight(this.display.x, this.display.y, x, y, (id) => !S.doors.get(id)?.open)) return;
    const types = this.data.animatronics.filter((t) => t !== 'pipoca');
    const type = types[Math.floor(Math.random() * types.length)];
    const r = Math.random();
    if (r < 0.45) {
      const fake = { type, x, y, chase: Math.random() < 0.3, key: Math.random() * 1000, alpha: 0.8 };
      S.hallu.push({ kind: 'eyes', start: S.t, dur: 1.2, e: fake });
    } else if (r < 0.8) {
      S.hallu.push({ kind: 'figure', type, x, y, dir: Math.random() * 6, start: S.t, dur: 0.35 + Math.random() * 0.4 });
      this.glitch = Math.max(this.glitch, 0.5);
    } else {
      audio.play(Math.random() < 0.5 ? 'stepNear' : 'whisper', { vol: 0.7, pan: Math.cos(ang) });
    }
  }

  buildEntities(now, movedSelf) {
    const S = this.S;
    const snaps = this.snaps;
    if (!snaps.length) { S.players = []; S.anims = []; return; }
    const rt = now + this.offset - INTERP_DELAY;
    let a = snaps[0], b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1].t <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
    }
    const span = b.t - a.t;
    const f = span > 0 ? Math.max(0, Math.min(1, (rt - a.t) / span)) : 1;
    const lerp = (x, y) => x + (y - x) * f;
    const latest = snaps[snaps.length - 1];
    const v = this.input.vector();

    const players = [];
    for (const row of latest.ps) {
      const id = row[0];
      const info = this.names.get(id) || { name: '?', color: 0 };
      const flags = row[4];
      if (id === this.you) {
        players.push({ id, self: true, x: this.display.x, y: this.display.y, dir: this.dir, alive: !!(flags & 1), hidden: !!(flags & 2), flash: !!(flags & 4), moving: movedSelf > 0.001, sprinting: v.sprint, sneaking: v.sneak, name: info.name, color: info.color, hp: row[5] });
        continue;
      }
      if (!(flags & 16)) continue;
      const ra = a.ps.find((p) => p[0] === id) || row;
      const rb = b.ps.find((p) => p[0] === id) || row;
      players.push({ id, x: lerp(ra[1], rb[1]), y: lerp(ra[2], rb[2]), dir: rb[3], alive: !!(flags & 1), hidden: !!(flags & 2), flash: !!(flags & 4), sprinting: !!(flags & 8), sneaking: !!(flags & 64), moving: Math.hypot(rb[1] - ra[1], rb[2] - ra[2]) > 0.01, name: info.name, color: info.color, hp: row[5] });
    }
    const anims = [];
    for (const row of latest.an) {
      const id = row[0];
      const ra = a.an.find((x) => x[0] === id) || row;
      const rb = b.an.find((x) => x[0] === id) || row;
      const x = lerp(ra[2], rb[2]), y = lerp(ra[3], rb[3]);
      const e = { id, type: ANIM_TYPES[row[1]], x, y, dir: rb[4], state: STATES[row[5]], moving: !!row[6] };
      anims.push(e);
      const prev = this.stepAcc.get(id);
      if (prev) {
        const d = Math.hypot(x - prev.x, y - prev.y);
        prev.acc += d;
        if (prev.acc > 0.95) {
          prev.acc = 0;
          const dist = Math.hypot(x - this.display.x, y - this.display.y);
          audio.play(e.type === 'lume' ? 'wings' : dist < 5 ? 'stepNear' : 'animStep', { vol: Math.max(0, 1 - dist / 16), pan: Math.max(-1, Math.min(1, (x - this.display.x) / 10)) });
          if (e.type === 'gregorio' && dist < 8 && settings.shake) this.shakeUntil = now + 100;
        }
        prev.x = x; prev.y = y;
      } else this.stepAcc.set(id, { x, y, acc: 0 });
    }
    S.players = players;
    S.anims = anims;
    S.showActive = this.showActive;
    S.showBreaking = this.showActive && now / 1000 >= (this.showBreakAt || Infinity);
    // olhos de alucinação somam aos reais
    S.eyes = (S.snapEyes || []).concat(S.hallu.filter((h) => h.kind === 'eyes').map((h) => h.e));
  }

  updateAudio(now) {
    const nowS = now / 1000;
    const p = this.display;
    const near = (x, y, r) => Math.max(0, 1 - Math.hypot(x - p.x, y - p.y) / r);
    const area = areaAt(p.x, p.y);
    audio.setLoop('ambient', 0.55);
    // Paisagem sonora por área (ver shared/areaProfiles.js): antes 'hum'
    // era o único loop indoor e tocava igual em toda sala — agora cada
    // área liga só os loops do próprio perfil, com volume próprio; zera
    // primeiro todos os nomes conhecidos e depois só sobe os que a área
    // atual pede, então trocar de sala já crossfada sozinho (setLoop usa
    // rampa, não corte seco — ver AREA_AMBIENCE_LOOPS/setTargetAtTime).
    const powered = this.S.lightsOn && !this.S.blackout; // sem luz, a paisagem sonora quase some — o silêncio é parte do susto
    for (const name of AREA_AMBIENCE_LOOPS) audio.setLoop(name, 0);
    if (area && !area.outdoor && powered) {
      const prof = areaProfile(area.id);
      for (const [name, vol] of prof?.ambience || []) audio.setLoop(name, vol);
    }
    audio.setLoop('generator', near(40.5, 4.5, 14) * 0.6);
    // "Hora do Show" (pedido #11): o som precisa parecer vir do
    // palco/alto-falantes — mais presente perto, mais distante longe. A
    // fonte re-toca a cada ~3.7s (ver startShowEvent), então recalcular o
    // volume aqui todo frame já garante que o PRÓXIMO disparo saia no
    // volume certo pra onde a pessoa está AGORA, sem precisar de um nó de
    // ganho contínuo à parte.
    if (this.showActive) {
      const stage = AREA_BY_ID.palco;
      const scx = (stage.x1 + stage.x2 + 1) / 2, scy = (stage.y1 + stage.y2 + 1) / 2;
      this.showMusicVol = Math.max(0.08, near(scx, scy, 34)) * 0.75;
    }
    audio.setLoop('freezer', near(66.5, 34.5, 8) * 0.5);
    audio.setLoop('wind', area?.outdoor ? 0.3 : 0.04);
    audio.setLoop('rain', area?.outdoor ? 0.5 : Math.max(0.03, near(32, 40, 10) * 0.25));
    const chasing = nowS < this.chaseUntil;
    audio.setLoop('chase', chasing ? 0.4 : 0);
    audio.setLoop('tension', this.tension > 0.05 ? this.tension * 0.75 : 0);
    audio.setLoop('breath', (this.me.fe || 0) > 70 && !this.breathHeld ? ((this.me.fe - 70) / 30) * 0.5 : 0);
    audio.update(this.tension > 0.25 ? 0 : Math.max(this.me.fe || 0, this.me.thr ? 90 : 0), chasing, {
      tension: this.tension,
      dist: this.me.wt ? this.me.wt[3] : null,
    });
    this.app.voice?.updateVolumes((id) => {
      const pl = this.S.players.find((x) => x.id === id);
      return pl ? Math.hypot(pl.x - p.x, pl.y - p.y) : null;
    });
  }

  clockText(offsetMin = 0) {
    if (!this.last) return '12:00 AM';
    const mins = Math.max(0, Math.min(360, (this.last.t / 1000 / this.last.d) * 360) + offsetMin);
    const h = Math.floor(mins / 60);
    const m = Math.floor((mins % 60) / 10) * 10;
    return `${h === 0 ? 12 : h}:${String(m).padStart(2, '0')} AM`;
  }

  // ================================================================== HUD
  updateHud() {
    const me = this.me, m = this.last;
    if (!m) return;
    const pct = (v, max) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
    $('#hud-hp').style.width = pct(me.hp, me.mhp);
    $('#hud-hp-t').textContent = `${me.hp}`;
    $('#hud-st').style.width = pct(me.st, me.mst);
    $('#hud-fear').style.width = pct(me.fe, 100);
    $('#hud-bat').style.width = pct(me.bat, 100);
    const pr = this.progress;
    if (pr) {
      $('#hud-level').textContent = `Nv ${pr.level}`;
      $('#hud-xp').style.width = pct(pr.xp, pr.xpToNext);
      $('#hud-money').textContent = `$${pr.money}`;
    }
    // relógio com glitch quando o medo está alto (ou durante o evento "relógio trava")
    const nowSClock = performance.now() / 1000;
    const clockGlitching = nowSClock < this.clockGlitchUntil;
    let clock;
    if (clockGlitching) {
      clock = Math.random() < 0.55 ? this.clockText(-(10 + Math.floor(Math.random() * 3) * 10)) : this.clockText();
      if (Math.random() < 0.45) clock = clock.replace(/\d/g, () => '▒░█'[Math.floor(Math.random() * 3)]);
    } else {
      clock = this.clockText();
      if ((me.fe || 0) > 80 && Math.random() < 0.15) clock = clock.replace(/\d/g, () => '▒░█'[Math.floor(Math.random() * 3)]);
    }
    $('#hud-clock').textContent = clock;
    $('#hud-clock').classList.toggle('glitching', clockGlitching);
    $('#hud-night').textContent = `${this.nightTitle.toUpperCase()} · ${this.diffName.toUpperCase()}`;
    $('#hud-power').style.width = `${m.pw}%`;
    $('#hud-power').parentElement.classList.toggle('low', m.pw < 25);
    $('#hud-power-t').textContent = `${Math.ceil(m.pw)}%`;
    let usage = 1;
    for (const d of DOORS) if (d.kind === 'power' && !this.S.doors.get(d.id)?.open) usage++;
    if (m.li) usage++;
    usage += m.ps.filter((p) => p[4] & 32).length;
    $('#hud-usage').textContent = '▮'.repeat(Math.min(6, usage)) + '▯'.repeat(Math.max(0, 6 - usage));
    if (m.pw < 20 && !this.powerLow && m.pw > 0) { this.powerLow = true; toast(fala('energiaBaixa'), 'warn'); }
    $('#hud-respawns').textContent = `Retornos da equipe: ${m.rs}`;

    const team = $('#hud-team');
    team.replaceChildren(...m.ps.map((row) => {
      const info = this.names.get(row[0]) || { name: '?', color: 0 };
      const alive = row[4] & 1, online = row[4] & 16;
      return el('li', { class: alive ? '' : 'dead', style: online ? '' : 'opacity:.4' },
        el('i', { style: `background:${PLAYER_COLORS[info.color % PLAYER_COLORS.length]}` }),
        `${info.name}${row[0] === this.you ? ' (você)' : ''}`,
        el('span', { class: 'mini' }, el('b', { style: `width:${row[5]}%` })),
        row[4] & 2 ? '🫥' : row[4] & 32 ? '📷' : row[4] & 64 ? '🤫' : '');
    }));

    const prompt = $('#hud-prompt');
    const c = !this.camOpen && me.alive && !me.hid ? this.candidates()[0] : null;
    if (me.hid) { prompt.hidden = false; prompt.textContent = '[E] Sair do esconderijo'; }
    else if (c && !me.act) { prompt.hidden = false; prompt.textContent = `[E] ${this.promptText(c)}`; }
    else prompt.hidden = true;
    const act = $('#hud-action');
    if (me.act) {
      act.hidden = false;
      act.querySelector('i').style.width = `${me.act[1] * 100}%`;
      act.querySelector('span').textContent = { search: 'Revistando…', repair: 'Consertando… (fique perto)', investigate: 'Investigando…' }[me.act[0]] || '';
    } else act.hidden = true;

    // respiração no esconderijo
    const br = $('#hud-breath');
    if (me.hid) {
      br.hidden = false;
      $('#hud-breath-bar').style.width = `${me.br}%`;
      const danger = me.thr && !me.hb;
      br.classList.toggle('danger', !!danger);
      $('#hud-breath-t').textContent = me.thr
        ? (me.hb ? '...não respira. não respira.' : `Tem algo bem aqui fora! Segura o ar! [${isTouchDevice() ? '🤫' : 'ESPAÇO'}]`)
        : (me.hb ? 'Segurando o ar...' : 'Tô escondido. Quietinho.');
    } else br.hidden = true;

    // seta de objetivo
    const obj = this.camOpen || !me.alive ? null : this.currentObjective();
    const ob = $('#hud-objective');
    if (obj) {
      ob.hidden = false;
      $('#obj-text').textContent = obj.text;
      if (obj.pt) {
        const dx = obj.pt.x - this.display.x, dy = obj.pt.y - this.display.y;
        const dist = Math.hypot(dx, dy);
        $('#obj-arrow').style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        $('#obj-arrow').style.opacity = 1;
        $('#obj-dist').textContent = dist < 1.8 ? fala('aquiE') : `uns ${Math.round(dist * 2)} metros`;
      } else {
        $('#obj-arrow').style.opacity = 0.25;
        $('#obj-dist').textContent = obj.def?.hint ? obj.def.hint.slice(0, 70) + (obj.def.hint.length > 70 ? '…' : '') : '';
      }
    } else ob.hidden = true;

    const eye = $('#hud-eye');
    const watcher = $('#hud-watcher');
    if (this.tension > 0.04 && me.alive && !this.camOpen) {
      eye.hidden = false;
      eye.style.setProperty('--open', Math.min(1, 0.15 + this.tension).toFixed(2));
      eye.classList.toggle('full', this.tension > 0.9);
      const a = me.wt ? (me.wt[1] / 8) * Math.PI : 0;
      const dist = me.wt ? me.wt[3] : 99;
      const r = Math.min(this.w, this.h) * 0.46;
      const onScreen = dist * (Math.max(30, Math.min(64, Math.min(this.w, this.h) / 15)) * this.zoom) < r;
      watcher.hidden = onScreen || !me.wt;
      watcher.style.left = `${this.w / 2 + Math.cos(a) * r}px`;
      watcher.style.top = `${this.h / 2 + Math.sin(a) * r}px`;
      watcher.style.opacity = this.tension.toFixed(2);
    } else { eye.hidden = true; watcher.hidden = true; }

    const st = $('#status-center');
    if (!me.alive && !this.js) { st.hidden = false; st.textContent = me.rsp ? `ME PEGARAM... ACORDANDO EM ${me.rsp}s` : 'SÓ ME RESTA OUVIR O RÁDIO'; }
    else if (me.stun && !this.js) { st.hidden = false; st.textContent = 'TUDO RODANDO...'; }
    else st.hidden = true;

    const heard = $('#hud-heard');
    heard.replaceChildren(...(m.hr || []).map(([ti, d, ang, chase]) => {
      const a = (ang / 8) * Math.PI;
      const r = Math.min(this.w, this.h) * 0.42;
      const x = this.w / 2 + Math.cos(a) * r, y = this.h / 2 + Math.sin(a) * r;
      return el('span', { style: `left:${x}px;top:${y}px;opacity:${Math.max(0.25, 1 - d / 15)};color:${chase ? '#ff3b3b' : '#ffb36b'}`, title: ANIMATRONIC_INFO[ANIM_TYPES[ti]].short, text: chase ? '‼' : '♪' });
    }));

    if (this.camOpen) for (const b of $('#cam-buttons').children) b.classList.toggle('active', b.dataset.cam === this.camId);
    const vb = $('#hb-voice');
    vb.classList.toggle('on', !!this.app.voice?.active);
    vb.classList.toggle('talking', !!this.app.voice?.talking);
  }

  renderQuests() {
    const box = $('#hud-quests');
    box.replaceChildren(el('h4', { text: 'Anotações [J]' }), ...this.quests.map((q) => el('div', { class: `q ${q.done ? 'done' : q.active ? '' : 'locked'}` },
      q.done ? '✔' : q.active ? '▸' : '·',
      el('span', { text: q.title + (q.optional ? ' (opcional)' : '') }),
      !q.done && q.count > 1 && q.active ? el('em', { text: q.type === 'repair' ? `${q.progress}%` : `${q.progress}/${q.count}` }) : null)));
  }

  renderChecklist() {
    const night = NIGHTS[this.data.night];
    $('#check-quests').replaceChildren(...this.quests.map((q) => {
      const def = this.findQuestDef(q.id) || {};
      const prog = !q.done && q.count > 1 ? ` (${q.type === 'repair' ? `${q.progress}%` : `${q.progress}/${q.count}`})` : '';
      const req = !q.active && !q.done && def.requires ? `Antes eu preciso: ${def.requires.map((id) => this.quests.find((x) => x.id === id)?.title.toLowerCase()).join(', ')}.` : '';
      return el('li', { class: q.done ? 'done' : q.active ? '' : 'locked' },
        el('span', { class: 'box', text: q.done ? '☑' : '☐' }),
        el('b', { text: q.title + prog + (q.optional ? ' (opcional)' : '') }),
        el('small', { text: [q.done && def.done ? def.done : (def.hint || q.desc), req].filter(Boolean).join(' ') }));
    }));
    $('#check-basics').replaceChildren(...BASICS.map((b) => el('li', { class: this.basicsDone.has(b.id) ? 'done' : '' },
      el('span', { class: 'box', text: this.basicsDone.has(b.id) ? '☑' : '☐' }), el('b', { text: b.text }), el('small', { text: b.hint }))));
    $('#check-anims').replaceChildren(...night.animatronics.map((a) => el('li', {},
      el('span', { class: 'box', text: '⚠' }), el('b', { text: ANIMATRONIC_INFO[a].name }), el('small', { text: ANIMATRONIC_INFO[a].desc }))));
  }

  hotbarItems() {
    const inv = this.inv?.inventory || {};
    return Object.keys(ITEMS).filter((id) => ITEMS[id].type === 'consumable' && inv[id] > 0).slice(0, 5);
  }

  renderHotbar() {
    const bar = $('#hud-hotbar');
    const inv = this.inv?.inventory || {};
    bar.replaceChildren(...this.hotbarItems().map((id, i) => el('button', { title: `${ITEMS[id].name}: ${ITEMS[id].desc}`, onclick: () => this.socket.emit('useItem', { item: id }) },
      el('small', { text: String(i + 1) }), ITEMS[id].icon, el('b', { text: inv[id] }))));
  }

  renderInventory() {
    const inv = this.inv;
    if (!inv) return;
    $('#g-equip').replaceChildren(...EQUIP_SLOTS.map((slot) => {
      const id = inv.equipment[slot];
      return el('div', { class: 'slot' }, el('span', { text: SLOT_NAMES[slot] }), id ? `${ITEMS[id].icon} ${ITEMS[id].name}` : '— vazio —',
        id ? el('button', { class: 'btn tiny', text: 'Remover', onclick: () => this.socket.emit('unequip', { slot }) }) : null);
    }));
    const entries = Object.entries(inv.inventory).filter(([id, q]) => ITEMS[id] && q > 0);
    $('#g-items').replaceChildren(...entries.map(([id, q]) => {
      const it = ITEMS[id];
      const equipped = Object.values(inv.equipment).includes(id);
      return el('div', { class: `item ${equipped ? 'equipped' : ''} ${it.type === 'quest' ? 'quest' : ''}` },
        el('div', { class: 'top' }, el('span', { class: 'ico', text: it.icon }), el('span', { class: 'nm', text: it.name }), el('span', { class: 'qty', text: `x${q}` })),
        el('div', { class: 'ds', text: it.desc }),
        it.type === 'consumable' ? el('button', { class: 'btn tiny', text: 'Usar', onclick: () => this.socket.emit('useItem', { item: id }) }) : null,
        it.type === 'equip' && !equipped ? el('button', { class: 'btn tiny', text: 'Equipar', onclick: () => this.socket.emit('equip', { item: id }) }) : null);
    }));
    $('#g-attrs').replaceChildren(...ATTRIBUTES.map((a) => el('span', {}, `${ATTR_NAMES[a]} `, el('b', { text: inv.attrs[a] }))));
  }
}
