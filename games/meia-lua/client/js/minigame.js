// Motor de minigames — cenas curtas e isoladas no estilo "flashback" 8-bit
// (referência aos minigames clássicos do FNAF entre as noites). Roda só no
// cliente, num canvas próprio de baixa resolução (320×180), sem nenhuma
// dependência do servidor de partida: é uma lembrança interativa curta, não
// multiplayer. Cada cena é um roteiro de passos (script) executado em
// sequência por run(); o desenho roda num loop de requestAnimationFrame
// separado.
import { audio } from './audio.js';

const SEEN_KEY = 'meialua.minigames.seen';
function getSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; }
}
function markSeenStorage(id) {
  try { const s = getSeen(); s[id] = true; localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* sem storage */ }
}
export function hasSeenMinigame(id) { return !!getSeen()[id]; }
export function anySeenMinigame() { return Object.keys(getSeen()).length > 0; }

const W = 320, H = 180;

// Paleta reduzida de propósito — poucas cores, alto contraste — pra marcar
// visualmente que isso é uma lembrança, não o jogo "de verdade".
export const PAL = {
  bg: '#0b0710', floor: '#241a2e', floor2: '#2c2038', wall: '#120c18',
  accent: '#e7b04a', warn: '#ff3b3b', text: '#f3e6c8', dim: '#7a6f8c',
  skin: '#e8b98a', hair: '#3a2a20', shirt: '#4a90c2', shirt2: '#c25a5a',
};

class Actor {
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.id = opts.id;
    this.kind = opts.kind || 'kid'; // kid | anim | prop
    this.color = opts.color || PAL.shirt;
    this.eye = opts.eye || '#fff';
    this.label = opts.label || '';
    this.dir = opts.dir || 'down';
    this.bob = Math.random() * 10;
    this.alert = false;
  }
  draw(ctx, t) {
    const px = Math.round(this.x), py = Math.round(this.y);
    const bob = this.kind === 'anim' ? Math.sin(t / 340 + this.bob) * (this.alert ? 2.4 : 1) : 0;
    ctx.save();
    ctx.translate(px, py + bob);
    if (this.kind === 'anim') {
      // animatrônico simplificado: bloco + cabeça + olhos que acendem
      ctx.fillStyle = '#000'; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.ellipse(0, 15, 11, 3, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = this.color;
      ctx.fillRect(-9, -20, 18, 32);
      ctx.fillRect(-8, -34, 16, 16);
      ctx.fillStyle = this.alert ? PAL.warn : this.eye;
      const glow = this.alert ? 3 : 1.4;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = this.alert ? 10 : 3;
      ctx.fillRect(-5, -28, glow, glow + 1);
      ctx.fillRect(2, -28, glow, glow + 1);
      ctx.shadowBlur = 0;
    } else if (this.kind === 'kid') {
      ctx.fillStyle = '#000'; ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.ellipse(0, 9, 6, 2, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = this.color; ctx.fillRect(-4, -8, 8, 12);
      ctx.fillStyle = PAL.skin; ctx.fillRect(-3, -16, 6, 8);
      ctx.fillStyle = PAL.hair; ctx.fillRect(-3, -18, 6, 3);
      if (this.dir === 'left') ctx.fillRect(-4, -16, 2, 3); else if (this.dir === 'right') ctx.fillRect(2, -16, 2, 3);
    } else {
      ctx.fillStyle = this.color; ctx.fillRect(-this.w / 2 || -6, -(this.h || 10), this.w || 12, this.h || 10);
    }
    ctx.restore();
    if (this.label && this.showLabel) {
      ctx.fillStyle = PAL.text; ctx.font = '6px monospace'; ctx.textAlign = 'center';
      ctx.fillText(this.label, px, py - (this.kind === 'anim' ? 42 : 24));
    }
  }
}

export class Minigame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.canvas.width = W; this.canvas.height = H;
    this.keys = new Set();
    this._onKeyDown = (e) => { this.keys.add(e.key.toLowerCase()); if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault(); };
    this._onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
    this.running = false;
    this.shake = 0;
    this.flashA = 0;
    this.fadeA = 0; // 0..1, preto por cima de tudo
    this.caption = null;
    this.dialogue = null; // { speaker, text }
    this.onAdvance = null; // resolve pendente de diálogo/input
  }

  start(scene, { onDone, onDialogue, onCaption } = {}) {
    this.scene = scene;
    this.actors = new Map(scene.actors.map((a) => [a.id, new Actor(a.x, a.y, a)]));
    this.player = this.actors.get('player');
    this.walls = scene.walls || [];
    this.onDone = onDone;
    this.onDialogueUi = onDialogue;
    this.onCaptionUi = onCaption;
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.running = true;
    this._t0 = performance.now();
    this._raf = requestAnimationFrame((t) => this._loop(t));
    this._runScript(scene.script).catch((e) => { console.error('[minigame]', e); this.finish(); });
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  finish() {
    if (this.scene?.id) markSeenStorage(this.scene.id);
    this.stop();
    this.onDone?.();
  }

  skip() { this.finish(); }

  // -------------------------------------------------------------- roteiro
  async _runScript(script) {
    for (const step of script) {
      if (!this.running) return;
      await this._runStep(step);
    }
    this.finish();
  }

  _runStep(step) {
    switch (step.type) {
      case 'caption': return this._caption(step.text, step.ms || 2200);
      case 'wait': return new Promise((r) => setTimeout(r, step.ms));
      case 'say': return this._say(step.speaker, step.text);
      case 'walkTo': return this._walkTo(step.actor, step.x, step.y, step.speed || 34);
      case 'freeMove': return this._freeMove(step);
      case 'flag': { const a = this.actors.get(step.actor); if (a) Object.assign(a, step.set); return Promise.resolve(); }
      case 'flicker': return this._flicker(step.ms || 900, step.times || 6);
      case 'scare': return this._scare(step);
      case 'fadeOut': return this._fadeTo(1, step.ms || 900);
      case 'fadeIn': return this._fadeTo(0, step.ms || 900);
      default: return Promise.resolve();
    }
  }

  _caption(text, ms) {
    this.caption = text;
    this.onCaptionUi?.(text);
    return new Promise((res) => setTimeout(() => { this.caption = null; this.onCaptionUi?.(null); res(); }, ms));
  }

  _say(speaker, text) {
    this.dialogue = { speaker, text };
    this.onDialogueUi?.(this.dialogue);
    return new Promise((res) => {
      this._advanceDialogue = () => {
        this.dialogue = null; this.onDialogueUi?.(null); this._advanceDialogue = null; res();
      };
    });
  }

  advanceDialogue() { this._advanceDialogue?.(); }

  _walkTo(id, tx, ty, speed) {
    const a = this.actors.get(id);
    if (!a) return Promise.resolve();
    return new Promise((res) => {
      const step = () => {
        if (!this.running) return res();
        const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
        if (d < 1.5) { a.x = tx; a.y = ty; return res(); }
        a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : a.dir;
        a.x += (dx / d) * speed * (1 / 60); a.y += (dy / d) * speed * (1 / 60);
        this._walkRaf = requestAnimationFrame(step);
      };
      step();
    });
  }

  // jogador se move livre com as setas/WASD até entrar na zona de gatilho
  _freeMove({ zone, hintText }) {
    this.freeMoveActive = true;
    if (hintText) { this.caption = hintText; this.onCaptionUi?.(hintText); }
    return new Promise((res) => {
      this._checkZone = () => {
        const p = this.player;
        if (p.x >= zone.x1 && p.x <= zone.x2 && p.y >= zone.y1 && p.y <= zone.y2) {
          this.freeMoveActive = false; this._checkZone = null;
          if (hintText) { this.caption = null; this.onCaptionUi?.(null); }
          res();
        }
      };
    });
  }

  _flicker(ms, times) {
    return new Promise((res) => {
      let i = 0;
      const iv = setInterval(() => {
        this.flashA = i % 2 === 0 ? 0.5 : 0;
        i++;
        if (i >= times) { clearInterval(iv); this.flashA = 0; res(); }
      }, ms / times);
    });
  }

  _scare({ shakeMs = 500 } = {}) {
    audio.play('jumpscare', { vol: 0.7, variant: 'maestro' });
    navigator.vibrate?.([220, 60, 260]);
    this.shake = 1;
    this.flashA = 1;
    return new Promise((res) => {
      setTimeout(() => { this.flashA = 0; }, 90);
      setTimeout(res, shakeMs);
    });
  }

  _fadeTo(target, ms) {
    return new Promise((res) => {
      const t0 = performance.now(); const from = this.fadeA;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms);
        this.fadeA = from + (target - from) * k;
        if (k < 1 && this.running) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }

  // ------------------------------------------------------------- desenho
  _loop(t) {
    if (!this.running) return;
    this._update(t);
    this._draw(t);
    this._raf = requestAnimationFrame((n) => this._loop(n));
  }

  _update(t) {
    if (this.freeMoveActive && this.player) {
      const p = this.player, sp = 46 / 60;
      let dx = 0, dy = 0;
      if (this.keys.has('arrowleft') || this.keys.has('a')) dx -= 1;
      if (this.keys.has('arrowright') || this.keys.has('d')) dx += 1;
      if (this.keys.has('arrowup') || this.keys.has('w')) dy -= 1;
      if (this.keys.has('arrowdown') || this.keys.has('s')) dy += 1;
      if (dx || dy) {
        const n = Math.hypot(dx, dy) || 1;
        const nx = p.x + (dx / n) * sp, ny = p.y + (dy / n) * sp;
        if (!this._blocked(nx, p.y)) p.x = nx;
        if (!this._blocked(p.x, ny)) p.y = ny;
        p.dir = dx > 0 ? 'right' : dx < 0 ? 'left' : p.dir;
      }
      this._checkZone?.();
    }
    if (this.dialogue && (this.keys.has('e') || this.keys.has('enter') || this.keys.has(' '))) {
      this.keys.delete('e'); this.keys.delete('enter'); this.keys.delete(' ');
      this.advanceDialogue();
    }
    this.shake = Math.max(0, this.shake - (1 / 60) * 2.2);
  }

  _blocked(x, y) {
    for (const w of this.walls) if (x > w.x1 && x < w.x2 && y > w.y1 && y < w.y2) return true;
    return x < 6 || x > W - 6 || y < 30 || y > H - 6;
  }

  _draw(t) {
    const ctx = this.ctx;
    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * 6 * this.shake, (Math.random() - 0.5) * 6 * this.shake);
    ctx.fillStyle = PAL.bg; ctx.fillRect(-8, -8, W + 16, H + 16);
    // chão xadrez simples
    ctx.fillStyle = PAL.floor; ctx.fillRect(0, 30, W, H - 36);
    for (let y = 30; y < H - 6; y += 12) for (let x = (Math.floor(y / 12) % 2) * 12; x < W; x += 24) { ctx.fillStyle = PAL.floor2; ctx.fillRect(x, y, 12, 12); }
    // parede
    ctx.fillStyle = PAL.wall; ctx.fillRect(0, 0, W, 30);

    const order = [...this.actors.values()].sort((a, b) => a.y - b.y);
    for (const a of order) a.draw(ctx, t);

    if (this.flashA > 0) { ctx.fillStyle = '#fff'; ctx.globalAlpha = this.flashA; ctx.fillRect(-8, -8, W + 16, H + 16); ctx.globalAlpha = 1; }
    if (this.fadeA > 0) { ctx.fillStyle = '#000'; ctx.globalAlpha = this.fadeA; ctx.fillRect(-8, -8, W + 16, H + 16); ctx.globalAlpha = 1; }
    ctx.restore();
  }
}

// -------------------------------------------------------------- cenas
export const SCENES = {
  lucas: {
    id: 'lucas',
    title: 'Feliz Aniversário, Lucas',
    walls: [{ x1: -10, y1: -10, x2: 0, y2: 200 }],
    actors: [
      { id: 'player', x: 60, y: 140, kind: 'kid', color: PAL.shirt },
      { id: 'colega', x: 110, y: 130, kind: 'kid', color: PAL.shirt2, label: 'Bia' },
      { id: 'tonho', x: 150, y: 60, kind: 'anim', color: '#b0703a', eye: '#ffcf4a', label: 'Tonho' },
      { id: 'marola', x: 200, y: 60, kind: 'anim', color: '#5d7c8f', eye: '#8ff7ff', label: 'Marola' },
      { id: 'lume', x: 250, y: 60, kind: 'anim', color: '#c9b67a', eye: '#ff7af2', label: 'Lume' },
    ],
    script: [
      { type: 'caption', text: '12 de agosto. Anos atrás.', ms: 2400 },
      { type: 'freeMove', zone: { x1: 80, y1: 110, x2: 145, y2: 158 }, hintText: 'Use as setas ou WASD pra andar até a Bia.' },
      { type: 'say', speaker: 'Bia', text: 'Feliz aniversário, Lucas! Vem ver o show, eles vão tocar só pra você hoje!' },
      { type: 'freeMove', zone: { x1: 140, y1: 65, x2: 260, y2: 135 }, hintText: 'Anda até o palco.' },
      { type: 'say', speaker: '', text: 'Eles tão tocando só pra mim hoje...' },
      { type: 'wait', ms: 600 },
      { type: 'flicker', ms: 700, times: 4 },
      { type: 'flag', actor: 'tonho', set: { alert: true } },
      { type: 'flag', actor: 'marola', set: { alert: true } },
      { type: 'flag', actor: 'lume', set: { alert: true } },
      { type: 'wait', ms: 500 },
      { type: 'say', speaker: '', text: '...por que ele tá olhando pra mim?' },
      { type: 'scare', shakeMs: 550 },
      { type: 'fadeOut', ms: 500 },
      { type: 'caption', text: 'ELE NÃO DEIXA A GENTE IR', ms: 2600 },
      { type: 'fadeIn', ms: 700 },
    ],
  },
};
