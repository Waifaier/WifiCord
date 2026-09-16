// Renderização do mundo em Canvas 2D: mapa em cache (pixel art), entidades, iluminação dinâmica,
// olhos brilhando no escuro, chuva, luzes de emergência e jumpscares.
import {
  MAP_W, MAP_H, TILE, grid, areaGrid, AREAS, DOORS, PROPS, OBJECTS, CAMERAS, AREA_BY_ID,
} from '/jogos/meia-lua/shared/map.js';
import { ITEMS } from '/jogos/meia-lua/shared/items.js';
import { ANIMATRONIC_INFO } from '/jogos/meia-lua/shared/nights.js';
import {
  drawFloorTile, drawWall, drawProp, drawObject, drawDoor, drawPlayer, drawAnimatronic, drawItemIcon, drawJumpscare,
} from './sprites.js';
import { assets, drawFrame, drawProp32 } from './assets.js';
import { PLAYER_COLORS } from './ui.js';

const BASE = 32; // px por tile no cache
const ANIM_TYPES = ['tonho', 'marola', 'lume', 'gregorio', 'maestro', 'pipoca'];
const STATES = ['IDLE', 'PATROL', 'INVESTIGATE', 'CHASE', 'SEARCH', 'RETURN', 'STUNNED', 'DORMANT', 'DISABLED', 'ALERT'];
const POSES = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'chase0', 'chase1', 'stun'];
const TAU = Math.PI * 2;

// posição dos olhos em cada folha (px do quadro, virado para a direita)
const EYE_POS = {
  tonho: [[34, 14]], marola: [[32, 13]], lume: [[32, 21]], gregorio: [[40, 17], [44, 17]],
  maestro: [[31, 11], [36, 11]], pipoca: [[21, 17], [27, 17]],
};
const PROP_SPRITE = {
  mesa: 'mesa', fliperama: 'fliperama', bancada: 'bancada', balcao: 'bancada', fogao: 'fogao', geladeira: 'geladeira',
  pia: 'pia', prateleira: 'prateleira', caixotes: 'caixote', caixa_som: 'caixa_som', bateria: 'bateria_musical', arvore: 'arvore',
};
const OBJ_SPRITE = {
  generator: 'gerador', console: 'console', fusebox: 'painel', campanel: 'painel', breaker: 'painel', altar: 'altar',
  phone: 'telefone', document: 'documento', keycutter: 'painel',
};
const EMERGENCY = [[14.5, 6], [14.5, 28], [33, 10.5], [48.5, 15], [48.5, 32], [31.5, 35.5], [6, 17], [6, 29], [60, 29]];

const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

export class Renderer {
  constructor() {
    this.cache = document.createElement('canvas');
    this.cache.width = MAP_W * BASE;
    this.cache.height = MAP_H * BASE;
    this.light = document.createElement('canvas');
    this.noise = [];
    this.silhouettes = {};
    this.buildCache();
    this.buildNoise();
    this.buildSilhouettes();
  }

  // ------------------------------------------------------------------ cache do mapa
  tile(c, name, variant, px, py) {
    const m = assets.manifest?.tiles;
    const i = m?.names.indexOf(name);
    if (!assets.ready || i < 0) return false;
    return drawFrame(c, assets.img.tiles, m.fw, m.fh, variant % m.variants, i, px, py, BASE, BASE);
  }

  buildCache() {
    const c = this.cache.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#050407';
    c.fillRect(0, 0, this.cache.width, this.cache.height);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = grid[y * MAP_W + x];
        const px = x * BASE, py = y * BASE;
        const ai = areaGrid[y * MAP_W + x];
        const v = Math.floor(hash(x * 31 + y * 17) * 4);
        if (t === TILE.WALL && ai < 0) {
          const below = y + 1 < MAP_H && grid[(y + 1) * MAP_W + x] !== TILE.WALL;
          if (!this.tile(c, below ? 'parede_face' : 'parede_topo', v, px, py)) drawWall(c, px, py, BASE, below);
        } else if (ai >= 0) {
          let floor = AREAS[ai].floor;
          if (floor === 'externo' && y <= 40 && (x <= 16 || x >= 56)) floor = 'grama';
          const tv = floor === 'xadrez' ? ((x + y) % 2 ? 0 : 2) + (v % 2) : v;
          if (!this.tile(c, floor, tv, px, py)) drawFloorTile(c, floor === 'grama' ? 'externo' : floor, px, py, BASE, x, y);
          if (floor === 'externo' && y === 43 && x % 4 === 0) { c.fillStyle = '#6f6a4c'; c.fillRect(px, py + BASE / 2 - 1, BASE * 0.6, 2); }
        }
      }
    }
    // sombra projetada pelas paredes no chão
    for (let y = 1; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (grid[y * MAP_W + x] !== TILE.WALL && grid[(y - 1) * MAP_W + x] === TILE.WALL) {
          const g = c.createLinearGradient(0, y * BASE, 0, y * BASE + 10);
          g.addColorStop(0, 'rgba(0,0,0,.55)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g;
          c.fillRect(x * BASE, y * BASE, BASE, 10);
        }
      }
    }
    const pa = AREA_BY_ID.palco;
    c.fillStyle = '#5a1216';
    c.fillRect(pa.x1 * BASE, (pa.y2 + 1) * BASE - 5, (pa.x2 - pa.x1 + 1) * BASE, 5);
    // manchas e poças de óleo
    for (let i = 0; i < 70; i++) {
      const x = hash(i * 3.1) * MAP_W, y = hash(i * 7.7) * MAP_H;
      const a = areaGrid[Math.floor(y) * MAP_W + Math.floor(x)];
      if (a < 0 || AREAS[a].outdoor) continue;
      c.fillStyle = `rgba(${hash(i) < 0.3 ? '40,6,6' : '8,6,4'},${0.25 + hash(i * 9) * 0.3})`;
      c.beginPath(); c.ellipse(x * BASE, y * BASE, 6 + hash(i * 5) * 18, 4 + hash(i * 6) * 10, hash(i) * 3, 0, TAU); c.fill();
    }
    for (const p of PROPS) {
      const spr = PROP_SPRITE[p.type];
      const big = p.type === 'arvore' ? 1.6 : 1;
      const s = BASE * big;
      if (!(spr && drawProp32(c, spr, p.x * BASE - (s - BASE) / 2, p.y * BASE - (s - BASE), s))) drawProp(c, p.type, p.x * BASE, p.y * BASE, BASE, 0);
    }
    c.font = `${BASE * 0.7}px VT323, monospace`;
    c.textAlign = 'center';
    c.fillStyle = 'rgba(255,255,255,.04)';
    for (const a of AREAS) c.fillText(a.name.toUpperCase(), ((a.x1 + a.x2 + 1) / 2) * BASE, ((a.y1 + a.y2 + 1) / 2) * BASE);
  }

  buildNoise() {
    for (let i = 0; i < 4; i++) {
      const n = document.createElement('canvas');
      n.width = 256; n.height = 256;
      const c = n.getContext('2d');
      const img = c.createImageData(256, 256);
      for (let j = 0; j < img.data.length; j += 4) {
        const v = Math.random() * 255;
        img.data[j] = img.data[j + 1] = img.data[j + 2] = v;
        img.data[j + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      this.noise.push(n);
    }
  }

  buildSilhouettes() {
    if (!assets.ready) return;
    for (const t of ANIM_TYPES) {
      const img = assets.img[`anim_${t}`];
      if (!img) continue;
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const c = cv.getContext('2d');
      c.drawImage(img, 0, 0);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = '#020103';
      c.fillRect(0, 0, cv.width, cv.height);
      this.silhouettes[t] = cv;
    }
  }

  // ------------------------------------------------------------------ entidades
  animSprite(ctx, a, sx, sy, scale, t, { silhouette = false, alpha = 1 } = {}) {
    const m = assets.manifest?.anims?.[a.type];
    const img = silhouette ? this.silhouettes[a.type] : assets.img[`anim_${a.type}`];
    if (!m || !img) return false;
    let pose;
    if (a.state === 'STUNNED' || a.state === 'DISABLED') pose = 'stun';
    else if (a.state === 'CHASE') pose = `chase${Math.floor(t * 9) % 2}`;
    else if (a.state === 'ALERT') pose = Math.floor(t * 3) % 5 === 0 ? 'chase0' : 'idle0';
    else if (a.moving || a.type === 'lume') pose = `walk${Math.floor(t * (a.type === 'lume' ? 12 : 7) + a.id) % 4}`;
    else pose = `idle${Math.floor(t * 2 + a.id) % 2}`;
    const idx = POSES.indexOf(pose);
    const h = scale * (m.fh / 32) * 0.95;
    const w = h * (m.fw / m.fh);
    const flip = Math.cos(a.dir) < -0.05;
    const dx = sx - w / 2 + (a.state === 'CHASE' ? (Math.random() - 0.5) * scale * 0.06 : 0);
    const dy = sy + scale * 0.42 - h;
    ctx.save();
    ctx.globalAlpha = alpha * (a.state === 'DORMANT' ? 0.8 : 1);
    drawFrame(ctx, img, m.fw, m.fh, idx, 0, dx, dy, w, h, flip);
    ctx.restore();
    a._eyes = (EYE_POS[a.type] || []).map(([ex, ey]) => ({
      x: flip ? dx + w - (ex / m.fw) * w : dx + (ex / m.fw) * w,
      y: dy + (ey / m.fh) * h,
    }));
    return true;
  }

  playerSprite(ctx, p, sx, sy, scale, t) {
    const m = assets.manifest?.players;
    if (!m || !assets.img.players) return false;
    let pose = p.moving ? `walk${Math.floor(t * (p.sneaking ? 5 : p.sprinting ? 12 : 8)) % 4}` : `idle${Math.floor(t * 1.5) % 2}`;
    if (!p.alive) pose = 'hurt';
    const idx = m.poses.indexOf(pose);
    const h = scale * 1.25 * (p.sneaking ? 0.88 : 1);
    const w = scale * 1.25;
    ctx.save();
    if (!p.alive) ctx.globalAlpha = 0.35;
    drawFrame(ctx, assets.img.players, m.fw, m.fh, idx, p.color % m.colors, sx - w / 2, sy + scale * 0.4 - h, w, h, Math.cos(p.dir) < -0.05);
    ctx.restore();
    return true;
  }

  drawWorld(ctx, w, h, view, S, opts = {}) {
    const scale = view.scale;
    const k = scale / BASE;
    const ox = w / 2 - view.cx * scale;
    const oy = h / 2 - view.cy * scale;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const sx = Math.max(0, -ox / k), sy = Math.max(0, -oy / k);
    const sw = Math.min(this.cache.width - sx, w / k), sh = Math.min(this.cache.height - sy, h / k);
    if (sw > 0 && sh > 0) ctx.drawImage(this.cache, sx, sy, sw, sh, ox + sx * k, oy + sy * k, sw * k, sh * k);

    const x0 = view.cx - w / 2 / scale - 2, x1 = view.cx + w / 2 / scale + 2;
    const y0 = view.cy - h / 2 / scale - 2, y1 = view.cy + h / 2 / scale + 2;
    const inView = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const t = S.t;

    for (const d of DOORS) if (inView(d.x, d.y)) drawDoor(ctx, d, ox + d.x * scale, oy + d.y * scale, scale, S.doors.get(d.id));

    for (const o of OBJECTS) {
      if (!inView(o.x, o.y)) continue;
      const px = ox + o.x * scale, py = oy + o.y * scale;
      const st = { searched: S.searched.has(o.id), hint: S.hints.has(o.id), target: S.targets.has(o.id), ringing: o.type === 'phone' && S.phoneRinging };
      let spr = OBJ_SPRITE[o.type];
      if (o.type === 'container') spr = st.searched ? 'caixa_aberta' : 'caixa';
      if (o.type === 'hide') spr = o.id === S.myHide ? 'armario_ocupado' : 'armario';
      if (st.target) {
        ctx.strokeStyle = `rgba(255,210,110,${0.5 + Math.sin(t * 5) * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px + scale / 2, py + scale / 2, scale * (0.6 + Math.sin(t * 5) * 0.08), 0, TAU); ctx.stroke();
      }
      if (spr && assets.ready) {
        drawProp32(ctx, spr, px, py, scale);
        if (st.hint && !st.searched) {
          ctx.save(); ctx.shadowColor = '#b28bff'; ctx.shadowBlur = 16;
          ctx.fillStyle = `rgba(210,170,255,${0.5 + Math.sin(t * 7) * 0.4})`;
          ctx.font = `${scale * 0.45}px monospace`; ctx.textAlign = 'center'; ctx.fillText('✦', px + scale / 2, py + 4);
          ctx.restore();
        }
        if (st.ringing) { ctx.fillStyle = '#ffd98a'; ctx.font = `${scale * 0.4}px monospace`; ctx.textAlign = 'center'; ctx.fillText('☎', px + scale / 2 + Math.sin(t * 40) * 2, py); }
      } else {
        drawObject(ctx, o, px, py, scale, t, { ...st, target: false });
      }
    }

    for (const g of S.ground.values()) {
      if (inView(g.x, g.y)) drawItemIcon(ctx, g.item === 'money' ? '💰' : ITEMS[g.item]?.icon || '?', ox + g.x * scale, oy + g.y * scale, scale, t + g.id);
    }
    for (const dc of S.decoys) {
      if (S.t > dc.until) continue;
      const px = ox + dc.x * scale, py = oy + dc.y * scale;
      const r = ((S.t * 1.5) % 1) * scale * 3;
      ctx.strokeStyle = `rgba(126,231,224,${0.5 * (1 - r / (scale * 3))})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.stroke();
      drawItemIcon(ctx, '📻', px, py, scale, t);
    }

    const ents = [];
    for (const p of S.players) if (inView(p.x, p.y) && !p.hidden) ents.push({ y: p.y, p });
    for (const a of S.anims) if (inView(a.x, a.y)) ents.push({ y: a.y, a });
    ents.sort((m, n) => m.y - n.y);
    for (const e of ents) {
      if (e.p) {
        const p = e.p;
        const sx2 = ox + p.x * scale, sy2 = oy + p.y * scale;
        ctx.fillStyle = 'rgba(0,0,0,.4)';
        ctx.beginPath(); ctx.ellipse(sx2, sy2 + scale * 0.35, scale * 0.3, scale * 0.12, 0, 0, TAU); ctx.fill();
        if (!this.playerSprite(ctx, p, sx2, sy2, scale, t)) {
          drawPlayer(ctx, sx2, sy2, scale, PLAYER_COLORS[p.color % PLAYER_COLORS.length], p.dir, t, { moving: p.moving, dead: !p.alive, flash: p.flash });
        }
        if (!opts.noNames) {
          ctx.font = `${Math.max(10, scale * 0.28)}px 'Share Tech Mono', monospace`;
          ctx.textAlign = 'center';
          const nm = p.name;
          const tw = ctx.measureText(nm).width + 6;
          ctx.fillStyle = 'rgba(0,0,0,.55)';
          ctx.fillRect(sx2 - tw / 2, sy2 - scale * 1.25, tw, scale * 0.32);
          ctx.fillStyle = p.self ? '#ffe2a8' : PLAYER_COLORS[p.color % PLAYER_COLORS.length];
          ctx.fillText(nm, sx2, sy2 - scale * 1.0);
        }
      } else {
        const a = e.a;
        const sx2 = ox + a.x * scale, sy2 = oy + a.y * scale;
        ctx.fillStyle = 'rgba(0,0,0,.5)';
        ctx.beginPath(); ctx.ellipse(sx2, sy2 + scale * 0.38, scale * 0.45, scale * 0.16, 0, 0, TAU); ctx.fill();
        if (!this.animSprite(ctx, a, sx2, sy2, scale, t)) {
          const size = scale * (a.type === 'gregorio' ? 1.35 : a.type === 'maestro' ? 1.5 : 1.15);
          drawAnimatronic(ctx, a.type === 'pipoca' ? 'tonho' : a.type, sx2, sy2, size, a.dir, t, { state: a.state, moving: a.moving });
        }
      }
    }

    // ondas de choque dos pratos
    for (const cl of S.clashes) {
      const p = (S.t - cl.start) / 1.2;
      if (p > 1) continue;
      ctx.strokeStyle = `rgba(255,230,140,${1 - p})`;
      ctx.lineWidth = 3;
      for (const k2 of [1, 0.6]) {
        ctx.beginPath(); ctx.arc(ox + cl.x * scale, oy + cl.y * scale, p * scale * 6 * k2, 0, TAU); ctx.stroke();
      }
    }
    return { ox, oy };
  }

  // ------------------------------------------------------------------ iluminação
  drawLighting(ctx, w, h, view, S, me) {
    const q = S.lowQuality ? 0.35 : 0.5;
    const lw = Math.ceil(w * q), lh = Math.ceil(h * q);
    if (this.light.width !== lw || this.light.height !== lh) { this.light.width = lw; this.light.height = lh; }
    const c = this.light.getContext('2d');
    const scale = view.scale * q;
    const ox = lw / 2 - view.cx * scale;
    const oy = lh / 2 - view.cy * scale;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = S.blackout ? 'rgba(3,0,2,0.985)' : 'rgba(2,2,6,0.975)';
    c.fillRect(0, 0, lw, lh);
    c.globalCompositeOperation = 'destination-out';

    for (const a of AREAS) {
      let alpha = 0;
      if (a.outdoor) alpha = 0.32;
      else if (!a.dark && S.lightsOn && !S.blackout) {
        alpha = a.safeLight ? 0.66 : 0.5;
        const fl = S.flicker.get(a.id);
        if (fl && S.t < fl) alpha *= Math.random() < 0.4 ? 0.05 : 0.85;
      }
      if (alpha <= 0) continue;
      c.fillStyle = `rgba(0,0,0,${alpha})`;
      c.fillRect(ox + (a.x1 - 0.5) * scale, oy + (a.y1 - 0.5) * scale, (a.x2 - a.x1 + 2) * scale, (a.y2 - a.y1 + 2) * scale);
    }
    if (S.flash > 0.02) { c.fillStyle = `rgba(0,0,0,${Math.min(0.9, S.flash)})`; c.fillRect(0, 0, lw, lh); }

    const glow = (x, y, r, strength = 1) => {
      const gx = ox + x * scale, gy = oy + y * scale, gr = r * scale;
      const g = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.55})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(gx, gy, gr, 0, TAU); c.fill();
    };
    const cone = (x, y, dir, range, flick = 1) => {
      const gx = ox + x * scale, gy = oy + y * scale, gr = range * scale;
      const g = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, `rgba(0,0,0,${flick})`);
      g.addColorStop(0.65, `rgba(0,0,0,${0.8 * flick})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(gx, gy); c.arc(gx, gy, gr, dir - 0.45, dir + 0.45); c.closePath(); c.fill();
    };

    for (const p of S.players) {
      if (!p.alive || p.hidden) continue;
      if (p.flash) {
        const lowBat = p.self && me.battery < 20;
        const flick = lowBat && Math.random() < 0.25 ? 0.2 : 1;
        cone(p.x, p.y, p.dir, p.self ? me.light + 1.5 : 6, flick);
      }
      glow(p.x, p.y, p.self ? (p.flash ? 2.3 : 1.9) : 1.2, p.self ? 0.9 : 0.55);
    }
    if (me && !me.alive) glow(view.cx, view.cy, 6, 0.8);
    for (const f of S.flares) if (S.t - f.start < 5) glow(f.x, f.y, 8 * (1 - (S.t - f.start) / 6), 1);
    for (const o of OBJECTS) if ((o.type === 'console' || o.type === 'altar') && !S.blackout) glow(o.x + 0.5, o.y + 0.5, 1.5, 0.45);
    if (S.blackout) {
      for (const [ex, ey] of EMERGENCY) glow(ex, ey, 3.2, 0.35 + 0.3 * Math.max(0, Math.sin(S.t * 3 + ex)));
    }

    c.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.light, 0, 0, w, h);

    // ---------- camada aditiva: luzes coloridas, olhos, poeira, chuva ----------
    const sox = w / 2 - view.cx * view.scale, soy = h / 2 - view.cy * view.scale;
    const S2 = view.scale;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (S.blackout) {
      for (const [ex, ey] of EMERGENCY) {
        const a = Math.max(0, Math.sin(S.t * 3 + ex));
        const gx = sox + ex * S2, gy = soy + ey * S2;
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, S2 * 3);
        g.addColorStop(0, `rgba(255,20,10,${0.35 * a})`);
        g.addColorStop(1, 'rgba(255,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(gx - S2 * 3, gy - S2 * 3, S2 * 6, S2 * 6);
      }
    }
    // poeira no feixe da lanterna
    const self = S.players.find((p) => p.self);
    if (self && self.flash && self.alive && !self.hidden) {
      const range = me.light + 1.2;
      for (let i = 0; i < 36; i++) {
        const r = (hash(i * 1.3) * 0.85 + 0.1) * range;
        const ang = self.dir + (hash(i * 2.7) - 0.5) * 0.8 + Math.sin(S.t * 0.7 + i) * 0.04;
        const px = sox + (self.x + Math.cos(ang) * r + Math.sin(S.t * 0.5 + i * 3) * 0.15) * S2;
        const py = soy + (self.y + Math.sin(ang) * r + Math.cos(S.t * 0.4 + i * 5) * 0.15) * S2;
        ctx.fillStyle = `rgba(255,240,200,${0.12 + 0.1 * hash(i + Math.floor(S.t * 2))})`;
        ctx.fillRect(px, py, 2, 2);
      }
    }
    // olhos: dos animatrônicos visíveis e dos que estão só na escuridão
    const drawEyePair = (points, color, intensity) => {
      for (const pt of points) {
        const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, S2 * 0.35);
        g.addColorStop(0, color.replace('A', String(0.9 * intensity)));
        g.addColorStop(1, color.replace('A', '0'));
        ctx.fillStyle = g;
        ctx.fillRect(pt.x - S2 * 0.35, pt.y - S2 * 0.35, S2 * 0.7, S2 * 0.7);
      }
    };
    const rgba = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},A)`;
    };
    for (const a of S.anims) {
      if (!a._eyes || a.state === 'STUNNED' || a.state === 'DISABLED') continue;
      const alert = a.state === 'ALERT';
      drawEyePair(a._eyes, a.state === 'CHASE' || (alert && Math.floor(S.t * 6) % 2) ? 'rgba(255,30,20,A)' : rgba(ANIMATRONIC_INFO[a.type]?.eye || '#ffffff'), alert ? 1.2 : 0.8);
    }
    for (const e of S.eyes) {
      const blink = hash(e.key + Math.floor(S.t * 1.3)) < 0.08;
      if (blink) continue;
      const cx = sox + e.x * S2, cy = soy + (e.y - 0.8) * S2;
      const col = e.chase ? 'rgba(255,30,20,A)' : rgba(ANIMATRONIC_INFO[e.type]?.eye || '#ffffff');
      drawEyePair([{ x: cx - S2 * 0.1, y: cy }, { x: cx + S2 * 0.1, y: cy }], col, e.alpha ?? 1);
      ctx.fillStyle = e.chase ? '#ff9a90' : '#ffffff';
      ctx.fillRect(cx - S2 * 0.1 - 1, cy - 1, 2, 2);
      ctx.fillRect(cx + S2 * 0.1 - 1, cy - 1, 2, 2);
    }
    ctx.restore();

    // silhuetas de alucinação
    for (const hl of S.hallu) {
      const p = (S.t - hl.start) / hl.dur;
      if (p < 0 || p > 1 || hl.kind !== 'figure') continue;
      this.animSprite(ctx, { type: hl.type, dir: hl.dir, state: 'IDLE', moving: false, id: 0 }, sox + hl.x * S2, soy + hl.y * S2, S2, S.t, { silhouette: true, alpha: Math.sin(p * Math.PI) * 0.85 });
    }

    // chuva sobre a área externa
    const ext = AREA_BY_ID.exterior;
    const rx0 = sox + ext.x1 * S2, ry0 = soy + (ext.y1 - 1) * S2, rx1 = sox + (ext.x2 + 1) * S2, ry1 = soy + (ext.y2 + 1) * S2;
    if (rx1 > 0 && rx0 < w && ry1 > 0 && ry0 < h) {
      ctx.save();
      ctx.beginPath(); ctx.rect(Math.max(0, rx0), Math.max(0, ry0), Math.min(w, rx1) - Math.max(0, rx0), Math.min(h, ry1) - Math.max(0, ry0)); ctx.clip();
      ctx.strokeStyle = 'rgba(160,180,220,.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const n = S.lowQuality ? 60 : 140;
      for (let i = 0; i < n; i++) {
        const x = (hash(i * 5.1) * w + S.t * 90) % w;
        const y = (hash(i * 9.3) * h + S.t * 900 * (0.8 + hash(i) * 0.4)) % h;
        ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 14);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ câmeras
  drawCamera(ctx, w, h, cam, S, ok) {
    const scale = Math.min(w / cam.vw, h / cam.vh);
    const view = { cx: cam.cx, cy: cam.cy, scale };
    if (ok) {
      this.drawWorld(ctx, w, h, view, S, { noNames: false });
      const area = AREA_BY_ID[cam.area];
      const lit = S.lightsOn && !S.blackout && !area.dark && !area.outdoor;
      ctx.fillStyle = lit ? 'rgba(10,20,10,.25)' : 'rgba(0,25,5,.42)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'color';
      ctx.fillStyle = lit ? 'rgba(160,200,160,.35)' : 'rgba(40,255,90,.6)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      // olhos brilham na visão noturna
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const a of S.anims) for (const pt of a._eyes || []) {
        const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, scale * 0.4);
        g.addColorStop(0, 'rgba(255,255,255,.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(pt.x - scale * 0.4, pt.y - scale * 0.4, scale * 0.8, scale * 0.8);
      }
      ctx.restore();
      ctx.globalAlpha = lit ? 0.08 : 0.18;
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.9;
    }
    const n = this.noise[Math.floor(S.t * 20) % this.noise.length];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(n, 0, 0, w, h);
    ctx.globalAlpha = 1;
    const band = (S.t * 120) % h;
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(0, band, w, 18);
    if (Math.random() < 0.05) { ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(0, Math.random() * h, w, 3 + Math.random() * 20); }
  }

  // ------------------------------------------------------------------ jumpscare
  drawJumpscare(ctx, w, h, js, t) {
    const el = t - js.start;
    const p = el / js.dur;
    const img = assets.img[`face_${js.type}`];
    const m = assets.manifest?.faces?.[js.type];
    const accent = (ANIMATRONIC_INFO[js.type] || ANIMATRONIC_INFO.tonho).eye;
    // 1) corte seco pro branco (estalo) e, logo em seguida, pro preto —
    // o par de cortes é o que vende o "susto" antes do grito aparecer.
    if (el < 0.045) { ctx.fillStyle = accent; ctx.fillRect(0, 0, w, h); return; }
    if (el < 0.07) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); return; }
    if (!img || !m) { drawJumpscare(ctx, js.type, w, h, Math.min(1, p), t); return; }
    const stutter = Math.floor(el * 20) / 20; // animação "travando", mais nervosa
    const base = Math.min(w, h);
    let zoom = 1.12 + Math.min(1, stutter * 6) * 0.8;
    if (js.fatal && p > 0.5) zoom += (p - 0.5) * 3.6;
    const shake = base * (0.095 * (1 - Math.min(1, p * 1.1)) + 0.016);
    const bgPulse = Math.floor(el * 24) % 2;
    ctx.fillStyle = el < 0.12 ? '#ffffff' : bgPulse ? '#2a0003' : '#080000';
    ctx.fillRect(0, 0, w, h);
    const frame = [0, 1, 2, 2, 1, 2][Math.floor(el * 30) % 6];
    const size = base * zoom;
    const jx = (hash(Math.floor(el * 36)) - 0.5) * shake * 2;
    const jy = (hash(Math.floor(el * 36) + 7) - 0.5) * shake * 2;
    ctx.imageSmoothingEnabled = false;
    // aberração cromática: ecos deslocados em direções opostas
    ctx.globalAlpha = 0.4;
    ctx.globalCompositeOperation = 'lighter';
    drawFrame(ctx, img, m.fw, m.fh, frame, 0, w / 2 - size / 2 + jx * 3.4, h / 2 - size / 2 + jy * 2.2, size, size);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    drawFrame(ctx, img, m.fw, m.fh, frame, 0, w / 2 - size / 2 + jx, h / 2 - size / 2 + jy, size, size);
    // lavagem de cor por animatrônico (dá personalidade ao susto)
    if (el < 0.5) {
      ctx.globalAlpha = Math.max(0, 0.32 - el * 0.5);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    // rasgos
    for (let i = 0; i < (el < 0.3 ? 9 : 3); i++) {
      const y = hash(i * 13 + Math.floor(el * 26)) * h;
      const hh = hash(i * 7 + Math.floor(el * 26)) * 22 + 2;
      const off = (hash(i * 3 + Math.floor(el * 26)) - 0.5) * 90;
      try { ctx.drawImage(ctx.canvas, 0, y * (ctx.canvas.height / h), ctx.canvas.width, hh * (ctx.canvas.height / h), off, y, w, hh); } catch { /* ignora */ }
    }
    if (js.fatal && p > 0.72) {
      const a = Math.min(1, (p - 0.72) / 0.2);
      ctx.globalAlpha = a;
      ctx.drawImage(this.noise[Math.floor(t * 30) % 4], 0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff2a2a';
      ctx.font = `${Math.round(base * 0.09)}px VT323, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('VOCÊ FOI PEGO', w / 2, h / 2);
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ mapa completo
  drawFullMap(canvas, S, meId) {
    const maxW = Math.min(window.innerWidth - 32, 1400), maxH = window.innerHeight - 90;
    const scale = Math.floor(Math.min(maxW / MAP_W, maxH / MAP_H) * 10) / 10;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = MAP_W * scale * dpr; canvas.height = MAP_H * scale * dpr;
    canvas.style.width = `${MAP_W * scale}px`; canvas.style.height = `${MAP_H * scale}px`;
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.cache, 0, 0, MAP_W * scale, MAP_H * scale);
    c.fillStyle = 'rgba(0,10,20,.45)';
    c.fillRect(0, 0, MAP_W * scale, MAP_H * scale);
    for (const d of DOORS) {
      const st = S.doors.get(d.id);
      c.fillStyle = st?.locked ? '#e7b04a' : st?.open ? '#3c6' : '#c33';
      c.fillRect(d.x * scale, d.y * scale, scale, scale);
    }
    c.font = `${Math.max(10, scale * 0.9)}px 'Share Tech Mono', monospace`;
    c.textAlign = 'center';
    for (const a of AREAS) {
      c.fillStyle = 'rgba(240,230,200,.8)';
      c.fillText(a.name, ((a.x1 + a.x2 + 1) / 2) * scale, ((a.y1 + a.y2 + 1) / 2) * scale);
    }
    for (const o of OBJECTS) {
      if (S.targets.has(o.id)) {
        c.fillStyle = '#ffd24a';
        c.beginPath(); c.arc((o.x + 0.5) * scale, (o.y + 0.5) * scale, scale * (0.6 + Math.sin(S.t * 5) * 0.2), 0, TAU); c.fill();
      } else if (o.type === 'console' || o.type === 'hide') {
        c.fillStyle = o.type === 'console' ? '#6f6' : 'rgba(120,160,200,.7)';
        c.fillRect((o.x + 0.25) * scale, (o.y + 0.25) * scale, scale / 2, scale / 2);
      }
    }
    for (const cam of CAMERAS) {
      c.fillStyle = 'rgba(126,231,224,.8)';
      c.fillText('◉', cam.cx * scale, (cam.cy - cam.vh / 2 + 1) * scale);
    }
    for (const a of S.anims) {
      c.fillStyle = '#ff3b3b';
      c.beginPath(); c.arc(a.x * scale, a.y * scale, scale * 0.6, 0, TAU); c.fill();
    }
    for (const p of S.players) {
      c.fillStyle = PLAYER_COLORS[p.color % PLAYER_COLORS.length];
      c.beginPath(); c.arc(p.x * scale, p.y * scale, scale * (p.id === meId ? 0.8 : 0.55), 0, TAU); c.fill();
      if (p.id === meId) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); }
      c.fillStyle = '#fff';
      c.fillText(p.name, p.x * scale, (p.y - 1) * scale);
    }
    c.textAlign = 'left';
    c.fillStyle = '#ddd';
    c.fillText('● objetivo  ■ monitor  ■ esconderijo  ■ porta aberta/fechada/trancada', 8, MAP_H * scale - 8);
  }
}

export { ANIM_TYPES, STATES, BASE };
