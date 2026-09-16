// Arte procedural original (Canvas 2D): personagens, animatrônicos, props e jumpscares.
import { ANIMATRONIC_INFO } from '/jogos/meia-lua/shared/nights.js';

const TAU = Math.PI * 2;

function circle(c, x, y, r, fill) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = fill; c.fill(); }
function ellipse(c, x, y, rx, ry, rot, fill) { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.fillStyle = fill; c.fill(); }
function glowEye(c, x, y, r, color, intensity = 1) {
  c.save();
  c.shadowColor = color; c.shadowBlur = 10 * intensity;
  circle(c, x, y, r, color);
  c.restore();
  circle(c, x, y, r * 0.4, '#fff');
}

// ---------------------------------------------------------------- jogadores
export function drawPlayer(c, x, y, s, color, dir, t, { moving = false, dead = false, flash = false, name = '', self = false } = {}) {
  c.save();
  c.translate(x, y);
  if (dead) c.globalAlpha = 0.35;
  const bob = moving ? Math.sin(t * 14) * s * 0.03 : 0;
  // sombra
  ellipse(c, 0, s * 0.28, s * 0.3, s * 0.12, 0, 'rgba(0,0,0,.45)');
  c.rotate(dir + Math.PI / 2);
  // corpo (jaqueta de vigia)
  ellipse(c, 0, bob, s * 0.3, s * 0.24, 0, '#1f2a3a');
  ellipse(c, 0, bob, s * 0.3, s * 0.24, 0, 'rgba(0,0,0,0)');
  c.strokeStyle = color; c.lineWidth = s * 0.05; c.beginPath(); c.ellipse(0, bob, s * 0.3, s * 0.24, 0, 0, TAU); c.stroke();
  // braços
  const sw = moving ? Math.sin(t * 14) * s * 0.08 : 0;
  circle(c, -s * 0.3, -s * 0.02 + sw, s * 0.08, '#2c3a50');
  circle(c, s * 0.3, -s * 0.02 - sw, s * 0.08, '#2c3a50');
  // cabeça + boné
  circle(c, 0, -s * 0.02 + bob, s * 0.17, '#e0b48a');
  c.beginPath(); c.arc(0, -s * 0.02 + bob, s * 0.17, Math.PI, TAU); c.fillStyle = color; c.fill();
  c.fillStyle = color; c.fillRect(-s * 0.1, -s * 0.22 + bob, s * 0.2, s * 0.07);
  // lanterna
  if (flash) { c.fillStyle = '#ddd'; c.fillRect(s * 0.25, -s * 0.2, s * 0.07, s * 0.16); }
  c.restore();
  if (name) {
    c.save();
    c.font = `${Math.max(10, s * 0.3)}px 'Share Tech Mono', monospace`;
    c.textAlign = 'center';
    c.fillStyle = 'rgba(0,0,0,.6)';
    const w = c.measureText(name).width + 6;
    c.fillRect(x - w / 2, y - s * 0.78, w, s * 0.34);
    c.fillStyle = self ? '#ffe2a8' : color;
    c.fillText(name, x, y - s * 0.52);
    c.restore();
  }
}

// Defasagem de cada um no "compasso" da banda durante o evento "O Show"
// (ver Match.runShowEvent) — cantam no mesmo ritmo, mas não robóticos em
// uníssono perfeito, como uma banda de verdade balançando junto.
const SHOW_PHASE = { tonho: 0, gregorio: 0.9, marola: 1.8, maestro: 2.7, lume: 3.6 };

// ---------------------------------------------------------------- animatrônicos
export function drawAnimatronic(c, type, x, y, s, dir, t, { state = 'IDLE', moving = false, performing = false, breaking = false } = {}) {
  const info = ANIMATRONIC_INFO[type] || ANIMATRONIC_INFO.tonho;
  const chase = state === 'CHASE';
  const stunned = state === 'STUNNED' || state === 'DISABLED';
  const jx = breaking ? (Math.random() - 0.5) * s * 0.16 : chase ? (Math.random() - 0.5) * s * 0.05 : 0;
  const jy = breaking ? (Math.random() - 0.5) * s * 0.1 : 0;
  c.save();
  c.translate(x + jx, y + jy);
  ellipse(c, 0, s * 0.38, s * 0.42, s * 0.16, 0, 'rgba(0,0,0,.5)');
  // "cantando": balanço maior e sincronizado no palco durante o show; nos
  // últimos instantes antes do apagão (breaking) o balanço vira tremor.
  const bob = performing
    ? Math.abs(Math.sin(t * 5.4 + (SHOW_PHASE[type] || 0))) * s * (breaking ? 0.03 : 0.08)
    : moving ? Math.abs(Math.sin(t * (chase ? 12 : 7))) * s * 0.05 : 0;
  const eye = stunned ? '#444' : chase ? '#ff2a2a' : breaking && Math.random() < 0.35 ? '#fff' : info.eye;
  const facing = Math.cos(dir) < 0 ? -1 : 1;
  c.translate(0, -bob);
  if (breaking) c.rotate((Math.random() - 0.5) * 0.08);
  c.scale(facing, 1);

  switch (type) {
    case 'tonho': { // tatu baterista
      // carapaça em faixas
      ellipse(c, 0, 0, s * 0.46, s * 0.36, 0, '#6b4424');
      c.strokeStyle = '#3d2412'; c.lineWidth = s * 0.04;
      for (let i = -2; i <= 2; i++) { c.beginPath(); c.ellipse(i * s * 0.12, 0, s * 0.05, s * 0.34, 0, 0, TAU); c.stroke(); }
      ellipse(c, 0, -s * 0.04, s * 0.46, s * 0.36, 0, 'rgba(255,200,140,.08)');
      // cabeça pontuda
      c.beginPath(); c.moveTo(s * 0.3, -s * 0.2); c.lineTo(s * 0.68, -s * 0.05); c.lineTo(s * 0.3, s * 0.12); c.closePath(); c.fillStyle = info.color; c.fill();
      ellipse(c, s * 0.34, -s * 0.28, s * 0.07, s * 0.13, -0.4, '#8f5b33'); // orelha
      glowEye(c, s * 0.44, -s * 0.07, s * 0.055, eye);
      // baquetas
      c.strokeStyle = '#d8c7a0'; c.lineWidth = s * 0.04;
      const sw = Math.sin(t * (moving ? 10 : 3)) * 0.5;
      c.beginPath(); c.moveTo(-s * 0.1, s * 0.2); c.lineTo(-s * 0.1 + Math.cos(sw) * s * 0.35, s * 0.2 - Math.sin(sw) * s * 0.35); c.stroke();
      c.beginPath(); c.moveTo(s * 0.12, s * 0.22); c.lineTo(s * 0.12 + Math.cos(-sw + 1) * s * 0.3, s * 0.22 + Math.sin(-sw + 1) * s * 0.1); c.stroke();
      // parafusos expostos
      circle(c, -s * 0.2, -s * 0.18, s * 0.025, '#999');
      break;
    }
    case 'marola': { // foca cantora
      ellipse(c, -s * 0.05, s * 0.05, s * 0.5, s * 0.3, 0.1, info.color);
      ellipse(c, -s * 0.05, s * 0.12, s * 0.38, s * 0.16, 0.1, '#8aa3b2');
      ellipse(c, -s * 0.52, s * 0.12, s * 0.16, s * 0.07, 0.5, '#3f5767'); // cauda
      ellipse(c, s * 0.02, s * 0.3, s * 0.14, s * 0.06, 0.6, '#3f5767'); // nadadeira
      circle(c, s * 0.38, -s * 0.18, s * 0.22, info.color);
      ellipse(c, s * 0.54, -s * 0.12, s * 0.1, s * 0.07, 0, '#9fb6c4');
      circle(c, s * 0.62, -s * 0.15, s * 0.035, '#111');
      c.strokeStyle = '#cfdde6'; c.lineWidth = 1;
      for (const k of [-1, 0, 1]) { c.beginPath(); c.moveTo(s * 0.56, -s * 0.1 + k * 3); c.lineTo(s * 0.8, -s * 0.12 + k * 6); c.stroke(); }
      glowEye(c, s * 0.42, -s * 0.26, s * 0.05, eye);
      // gravata borboleta
      c.fillStyle = '#c2412d';
      c.beginPath(); c.moveTo(s * 0.26, s * 0.02); c.lineTo(s * 0.14, -s * 0.06); c.lineTo(s * 0.14, s * 0.1); c.fill();
      c.beginPath(); c.moveTo(s * 0.26, s * 0.02); c.lineTo(s * 0.38, -s * 0.06); c.lineTo(s * 0.38, s * 0.1); c.fill();
      // boca aberta cantando
      const m = (Math.sin(t * 6) + 1) * 0.5;
      ellipse(c, s * 0.52, -s * 0.03, s * 0.05, s * 0.02 + m * s * 0.03, 0, '#200');
      break;
    }
    case 'lume': { // mariposa
      const flap = Math.sin(t * (moving ? 22 : 8)) * 0.35;
      c.save();
      for (const side of [-1, 1]) {
        c.save(); c.scale(1, side); c.rotate(flap * side);
        ellipse(c, -s * 0.05, -s * 0.32, s * 0.36, s * 0.22, -0.3, 'rgba(201,182,122,.85)');
        ellipse(c, -s * 0.05, -s * 0.32, s * 0.12, s * 0.08, -0.3, '#6b4a8f');
        glowEye(c, -s * 0.05, -s * 0.32, s * 0.035, '#ff7af2', 0.6);
        ellipse(c, -s * 0.3, -s * 0.16, s * 0.2, s * 0.14, 0.4, 'rgba(160,140,90,.85)');
        c.restore();
      }
      c.restore();
      ellipse(c, 0, 0, s * 0.3, s * 0.13, 0, '#8a7a55');
      for (let i = -2; i <= 2; i++) circle(c, i * s * 0.08, 0, s * 0.03, '#5d5037');
      circle(c, s * 0.3, 0, s * 0.13, '#b3a17a');
      c.strokeStyle = '#d9c99a'; c.lineWidth = s * 0.025;
      c.beginPath(); c.moveTo(s * 0.36, -s * 0.08); c.quadraticCurveTo(s * 0.5, -s * 0.3, s * 0.62, -s * 0.28); c.stroke();
      c.beginPath(); c.moveTo(s * 0.36, s * 0.08); c.quadraticCurveTo(s * 0.5, s * 0.3, s * 0.62, s * 0.28); c.stroke();
      glowEye(c, s * 0.36, -s * 0.05, s * 0.045, eye, 1.4);
      glowEye(c, s * 0.36, s * 0.05, s * 0.045, eye, 1.4);
      // lamparina pendurada
      c.save(); c.shadowColor = '#ffcf6a'; c.shadowBlur = 14; circle(c, -s * 0.36, s * 0.1, s * 0.06, '#ffd98a'); c.restore();
      break;
    }
    case 'gregorio': { // gorila garçom
      ellipse(c, 0, 0, s * 0.52, s * 0.44, 0, info.color);
      c.fillStyle = '#e8e2d6'; c.fillRect(-s * 0.18, -s * 0.12, s * 0.36, s * 0.46); // avental
      c.fillStyle = '#b5ae9f'; c.fillRect(-s * 0.18, s * 0.1, s * 0.36, s * 0.04);
      // braços longos
      ellipse(c, -s * 0.46, s * 0.12, s * 0.14, s * 0.3, 0.2, '#2c2a31');
      ellipse(c, s * 0.46, s * 0.1, s * 0.14, s * 0.3, -0.2, '#2c2a31');
      // bandeja
      ellipse(c, s * 0.58, -s * 0.18, s * 0.22, s * 0.07, 0, '#9c9c9c');
      circle(c, s * 0.54, -s * 0.24, s * 0.05, '#c2412d');
      // cabeça
      circle(c, 0, -s * 0.42, s * 0.22, '#2c2a31');
      ellipse(c, s * 0.04, -s * 0.36, s * 0.14, s * 0.1, 0, '#5a5560');
      c.fillStyle = '#111'; c.fillRect(-s * 0.16, -s * 0.52, s * 0.32, s * 0.05); // sobrancelha
      glowEye(c, -s * 0.07, -s * 0.46, s * 0.04, eye);
      glowEye(c, s * 0.09, -s * 0.46, s * 0.04, eye);
      // gravatinha
      c.fillStyle = '#111'; c.fillRect(-s * 0.06, -s * 0.2, s * 0.12, s * 0.05);
      break;
    }
    case 'maestro': { // regente sem rosto
      c.fillStyle = '#120d16';
      c.beginPath(); c.moveTo(-s * 0.35, s * 0.4); c.lineTo(0, -s * 0.45); c.lineTo(s * 0.35, s * 0.4); c.closePath(); c.fill();
      c.fillStyle = '#2a1d33';
      c.beginPath(); c.moveTo(-s * 0.15, s * 0.4); c.lineTo(-s * 0.45, s * 0.55); c.lineTo(-s * 0.05, s * 0.2); c.fill();
      c.beginPath(); c.moveTo(s * 0.15, s * 0.4); c.lineTo(s * 0.45, s * 0.55); c.lineTo(s * 0.05, s * 0.2); c.fill();
      ellipse(c, 0, -s * 0.58, s * 0.16, s * 0.22, 0, '#e9e4ea'); // máscara lisa
      if (!stunned) {
        glowEye(c, -s * 0.06, -s * 0.6, s * 0.03, chase ? '#ff2a2a' : '#ffffff', 2);
        glowEye(c, s * 0.06, -s * 0.6, s * 0.03, chase ? '#ff2a2a' : '#ffffff', 2);
      }
      // batuta
      const a = Math.sin(t * 3) * 0.8;
      c.strokeStyle = '#f5f0e0'; c.lineWidth = s * 0.03;
      c.beginPath(); c.moveTo(s * 0.2, -s * 0.1); c.lineTo(s * 0.2 + Math.cos(a - 1) * s * 0.5, -s * 0.1 + Math.sin(a - 1) * s * 0.5); c.stroke();
      // fios pendurados
      c.strokeStyle = 'rgba(180,150,200,.5)'; c.lineWidth = 1;
      for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * s * 0.08, -s * 0.38); c.lineTo(i * s * 0.1, s * 0.5 + Math.sin(t * 2 + i) * 4); c.stroke(); }
      break;
    }
  }
  if (stunned) {
    c.scale(facing, 1);
    c.fillStyle = '#7ee7e0'; c.font = `${s * 0.35}px monospace`; c.textAlign = 'center';
    c.fillText('⚡', Math.sin(t * 8) * s * 0.2, -s * 0.7);
  }
  if (breaking) {
    // últimos instantes do show: eles "quebram" — rachaduras, faíscas e
    // sumiços de um frame (stutter), como se o corpo estivesse se
    // desmontando antes de sumir com o apagão.
    c.scale(facing, 1);
    c.save();
    c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = Math.max(1, s * 0.02);
    c.shadowColor = '#fff'; c.shadowBlur = 4;
    const seed = Math.floor(t * 9);
    let rs = seed * 374761393 + (type.charCodeAt(0) || 0) * 97;
    const rand = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return (rs % 1000) / 1000; };
    for (let i = 0; i < 3; i++) {
      const cx = (rand() - 0.5) * s * 0.6, cy = -s * 0.2 + (rand() - 0.5) * s * 0.6;
      c.beginPath(); c.moveTo(cx, cy);
      c.lineTo(cx + (rand() - 0.5) * s * 0.3, cy + (rand() - 0.5) * s * 0.3);
      c.lineTo(cx + (rand() - 0.5) * s * 0.4, cy + (rand() - 0.5) * s * 0.2);
      c.stroke();
    }
    if (rand() < 0.4) { c.fillStyle = 'rgba(255,220,120,.9)'; circle(c, (rand() - 0.5) * s * 0.5, -s * 0.15, s * 0.03, 'rgba(255,220,120,.9)'); }
    c.restore();
  }
  c.restore();
}

// ---------------------------------------------------------------- jumpscare
export function drawJumpscare(c, type, w, h, p, t) {
  const info = ANIMATRONIC_INFO[type] || ANIMATRONIC_INFO.tonho;
  c.fillStyle = p < 0.05 ? info.eye : p < 0.1 ? '#fff' : `rgba(${60 + Math.random() * 60},0,0,1)`;
  c.fillRect(0, 0, w, h);
  const scale = Math.min(w, h) * (0.65 + p * 1.05);
  const shake = (1 - p) * 44 + 14;
  c.save();
  c.translate(w / 2 + (Math.random() - 0.5) * shake, h / 2 + (Math.random() - 0.5) * shake);
  c.rotate((Math.random() - 0.5) * 0.12);
  const s = scale;
  const base = type === 'maestro' ? '#e9e4ea' : type === 'gregorio' ? '#2c2a31' : info.color;
  // cabeça
  ellipse(c, 0, 0, s * 0.42, s * 0.46, 0, base);
  ellipse(c, 0, s * 0.05, s * 0.38, s * 0.4, 0, 'rgba(0,0,0,.25)');
  if (type === 'tonho') {
    for (let i = -2; i <= 2; i++) { c.strokeStyle = '#3d2412'; c.lineWidth = s * 0.03; c.beginPath(); c.arc(0, -s * 0.2, s * (0.2 + (i + 2) * 0.06), Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
    ellipse(c, -s * 0.36, -s * 0.36, s * 0.08, s * 0.18, -0.5, '#8f5b33');
    ellipse(c, s * 0.36, -s * 0.36, s * 0.08, s * 0.18, 0.5, '#8f5b33');
  } else if (type === 'marola') {
    c.strokeStyle = '#cfdde6'; c.lineWidth = s * 0.008;
    for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(s * 0.1, s * 0.08); c.lineTo(s * 0.55, s * (i * 0.05)); c.stroke(); c.beginPath(); c.moveTo(-s * 0.1, s * 0.08); c.lineTo(-s * 0.55, s * (i * 0.05)); c.stroke(); }
  } else if (type === 'lume') {
    ellipse(c, -s * 0.55, -s * 0.2, s * 0.35, s * 0.2, -0.4, 'rgba(201,182,122,.9)');
    ellipse(c, s * 0.55, -s * 0.2, s * 0.35, s * 0.2, 0.4, 'rgba(201,182,122,.9)');
  } else if (type === 'gregorio') {
    c.fillStyle = '#111'; c.fillRect(-s * 0.34, -s * 0.22, s * 0.68, s * 0.08);
  } else if (type === 'maestro') {
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = s * 0.01;
    for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo((Math.random() - 0.5) * s * 0.5, -s * 0.4); c.lineTo((Math.random() - 0.5) * s * 0.6, s * 0.3); c.stroke(); }
  }
  // olhos
  const eyeCol = type === 'maestro' ? '#ff1a1a' : info.eye;
  for (const ex of [-0.15, 0.15]) {
    circle(c, s * ex, -s * 0.1, s * 0.09, '#000');
    c.save(); c.shadowColor = eyeCol; c.shadowBlur = 40; circle(c, s * ex, -s * 0.1, s * 0.04, eyeCol); c.restore();
  }
  // mandíbula escancarada com dentes de metal
  const open = 0.12 + Math.abs(Math.sin(t * 40)) * 0.06;
  ellipse(c, 0, s * 0.22, s * 0.26, s * open, 0, '#120000');
  c.fillStyle = '#c9c9c9';
  for (let i = -4; i <= 4; i++) {
    c.beginPath(); c.moveTo(i * s * 0.05 - s * 0.02, s * 0.22 - s * open * 0.8); c.lineTo(i * s * 0.05, s * 0.22 - s * open * 0.2); c.lineTo(i * s * 0.05 + s * 0.02, s * 0.22 - s * open * 0.8); c.fill();
    c.beginPath(); c.moveTo(i * s * 0.05 - s * 0.02, s * 0.22 + s * open * 0.8); c.lineTo(i * s * 0.05, s * 0.22 + s * open * 0.2); c.lineTo(i * s * 0.05 + s * 0.02, s * 0.22 + s * open * 0.8); c.fill();
  }
  // fios
  c.strokeStyle = '#8a1f1f'; c.lineWidth = s * 0.012;
  for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(s * (0.1 + i * 0.05), s * 0.4); c.quadraticCurveTo(s * (0.2 + i * 0.1), s * 0.6, s * (i * 0.08), s * 0.8); c.stroke(); }
  c.restore();
  // linhas VHS
  for (let i = 0; i < 12; i++) {
    c.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
    c.fillRect(0, Math.random() * h, w, Math.random() * 6);
  }
}

// ---------------------------------------------------------------- mapa
export const FLOOR_COLORS = {
  concreto: ['#3a3834', '#34322e'],
  carpete: ['#1d2436', '#1a2031'],
  madeira: ['#4a3322', '#3f2b1c'],
  ladrilho: ['#3a3b40', '#333439'],
  porao: ['#262b22', '#20241c'],
  palco: ['#3b2216', '#331c12'],
  xadrez: ['#43191b', '#151314'],
  secreta: ['#2b2233', '#241c2b'],
  azulejo: ['#6f7a79', '#636d6c'],
  cozinha: ['#67645d', '#5a5751'],
  externo: ['#1c1d1f', '#18191b'],
};

export function drawFloorTile(c, floor, px, py, T, tx, ty) {
  const [a, b] = FLOOR_COLORS[floor] || FLOOR_COLORS.concreto;
  switch (floor) {
    case 'xadrez':
    case 'azulejo':
    case 'cozinha': {
      const n = floor === 'xadrez' ? 1 : 2;
      const q = T / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        c.fillStyle = ((tx * n + i + ty * n + j) % 2) ? a : b;
        c.fillRect(px + i * q, py + j * q, q, q);
      }
      break;
    }
    case 'madeira':
    case 'palco':
      c.fillStyle = a; c.fillRect(px, py, T, T);
      c.fillStyle = b;
      for (let i = 0; i < 4; i++) c.fillRect(px, py + (i * T) / 4, T, 1);
      c.fillRect(px + ((ty * 7) % T), py, 1, T / 2);
      break;
    case 'externo':
      c.fillStyle = a; c.fillRect(px, py, T, T);
      if (ty === 43 && tx % 4 === 0) { c.fillStyle = '#9a9468'; c.fillRect(px, py + T / 2 - 1, T * 0.6, 2); }
      break;
    default:
      c.fillStyle = (tx + ty) % 2 ? a : b;
      c.fillRect(px, py, T, T);
      c.strokeStyle = 'rgba(0,0,0,.18)'; c.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
  }
  // sujeira
  const h = Math.sin(tx * 12.9898 + ty * 78.233) * 43758.5453;
  const r = h - Math.floor(h);
  if (r > 0.82) { c.fillStyle = `rgba(0,0,0,${(r - 0.8) * 1.5})`; c.beginPath(); c.arc(px + r * T, py + (1 - r) * T, T * 0.25 * r, 0, TAU); c.fill(); }
  if (floor === 'porao' && r < 0.1) { c.strokeStyle = 'rgba(0,0,0,.5)'; c.beginPath(); c.moveTo(px, py + r * T * 5); c.lineTo(px + T, py + T * 0.4); c.stroke(); }
}

export function drawWall(c, px, py, T, floorBelow) {
  c.fillStyle = '#0d0b10';
  c.fillRect(px, py, T, T);
  if (floorBelow) {
    // face frontal da parede (efeito 3/4)
    c.fillStyle = '#2a2330';
    c.fillRect(px, py + T * 0.45, T, T * 0.55);
    c.fillStyle = '#3a3040';
    c.fillRect(px, py + T * 0.45, T, 2);
    c.fillStyle = 'rgba(0,0,0,.25)';
    c.fillRect(px, py + T * 0.75, T, T * 0.25);
  }
}

export function drawProp(c, type, px, py, T, t = 0) {
  const cx = px + T / 2, cy = py + T / 2;
  switch (type) {
    case 'mesa':
      circle(c, cx, cy + 3, T * 0.46, 'rgba(0,0,0,.35)');
      circle(c, cx, cy, T * 0.44, '#d9d2c3');
      circle(c, cx, cy, T * 0.36, '#c9412d');
      c.fillStyle = '#e6c15a'; c.beginPath(); c.moveTo(cx, cy - T * 0.2); c.lineTo(cx + T * 0.15, cy + T * 0.12); c.lineTo(cx - T * 0.15, cy + T * 0.12); c.fill();
      break;
    case 'fliperama':
      c.fillStyle = '#231a38'; c.fillRect(px + 2, py + 1, T - 4, T - 2);
      c.fillStyle = (Math.floor(t * 2 + py) % 3) ? '#1a4b5c' : '#0c2129'; c.fillRect(px + 6, py + 5, T - 12, T * 0.4);
      c.fillStyle = '#e04848'; circle(c, px + T * 0.35, py + T * 0.75, 2.5, '#e04848'); circle(c, px + T * 0.65, py + T * 0.75, 2.5, '#48a0e0');
      break;
    case 'balcao': case 'bancada':
      c.fillStyle = type === 'balcao' ? '#5a3a24' : '#9ea3a6'; c.fillRect(px, py + 3, T, T - 6);
      c.fillStyle = type === 'balcao' ? '#7a5234' : '#c4c9cc'; c.fillRect(px, py + 3, T, 4);
      break;
    case 'bandeirolas':
      for (let i = 0; i < 3; i++) { c.fillStyle = ['#c2412d', '#e7b04a', '#3a78a0'][(px / T + i) % 3 | 0]; c.beginPath(); c.moveTo(px + i * T / 3, py + 2); c.lineTo(px + i * T / 3 + T / 6, py + 12); c.lineTo(px + (i + 1) * T / 3, py + 2); c.fill(); }
      break;
    case 'cortina':
      c.fillStyle = '#5c0f18'; c.fillRect(px, py, T, T * 0.6);
      c.fillStyle = '#3d0910'; for (let i = 0; i < 3; i++) c.fillRect(px + i * T / 3, py, 3, T * 0.6);
      break;
    case 'bateria':
      circle(c, cx, cy, T * 0.3, '#882222'); circle(c, cx, cy, T * 0.22, '#ddd');
      circle(c, cx - T * 0.4, cy - T * 0.2, T * 0.15, '#c9a227'); circle(c, cx + T * 0.4, cy - T * 0.2, T * 0.15, '#c9a227');
      break;
    case 'microfone': c.fillStyle = '#555'; c.fillRect(cx - 1, cy - T * 0.3, 2, T * 0.6); circle(c, cx, cy - T * 0.3, 4, '#aaa'); break;
    case 'teclado': c.fillStyle = '#222'; c.fillRect(px - T * 0.2, cy - 5, T * 1.4, 10); c.fillStyle = '#eee'; for (let i = 0; i < 8; i++) c.fillRect(px - T * 0.15 + i * T * 0.17, cy - 3, T * 0.12, 6); break;
    case 'caixa_som': c.fillStyle = '#151515'; c.fillRect(px + 3, py + 3, T - 6, T - 6); circle(c, cx, cy, T * 0.25, '#333'); circle(c, cx, cy, T * 0.1, '#111'); break;
    case 'fogao': c.fillStyle = '#555'; c.fillRect(px + 2, py + 1, T - 4, T - 2); circle(c, cx, py + T * 0.3, T * 0.15, '#222'); circle(c, cx, py + T * 0.72, T * 0.15, '#222'); break;
    case 'geladeira': c.fillStyle = '#cfd4d6'; c.fillRect(px + 1, py + 2, T - 2, T - 4); c.fillStyle = '#888'; c.fillRect(px + T - 6, py + 6, 2, T * 0.4); break;
    case 'pia': c.fillStyle = '#d4dcdc'; c.fillRect(px + 2, py + 4, T - 4, T - 8); ellipse(c, cx, cy, T * 0.25, T * 0.15, 0, '#9fb0b0'); break;
    case 'divisoria': c.fillStyle = '#4f6e6c'; c.fillRect(px + T * 0.35, py, T * 0.3, T); break;
    case 'prateleira': c.fillStyle = '#4a4036'; c.fillRect(px, py + 4, T, T - 8); c.fillStyle = '#7a6040'; c.fillRect(px + 3, py + 7, T * 0.3, T * 0.35); c.fillStyle = '#5a6a7a'; c.fillRect(px + T * 0.5, py + 9, T * 0.35, T * 0.3); break;
    case 'mesa_monitores': case 'escrivaninha':
      c.fillStyle = '#3a2a1e'; c.fillRect(px, py + 2, T, T - 4);
      if (type === 'mesa_monitores') { c.fillStyle = '#111'; c.fillRect(px + 4, py + 4, T - 8, T * 0.5); c.fillStyle = (Math.floor(t * 3 + px) % 5) ? '#2d5c3a' : '#1b3a24'; c.fillRect(px + 6, py + 6, T - 12, T * 0.4); }
      else { c.fillStyle = '#e8e0cc'; c.fillRect(px + 5, py + 8, T * 0.3, T * 0.35); }
      break;
    case 'fitas': c.fillStyle = '#2a2a2a'; c.fillRect(px + 1, py + 2, T - 2, T - 4); c.fillStyle = '#b33'; for (let i = 0; i < 4; i++) c.fillRect(px + 4 + i * 6, py + 6, 4, T - 12); break;
    case 'estante': c.fillStyle = '#3c2a1c'; c.fillRect(px, py + 4, T, T - 6); c.fillStyle = '#6a4a8a'; c.fillRect(px + 3, py + 6, 5, T - 12); c.fillStyle = '#8a5a3a'; c.fillRect(px + 10, py + 8, 6, T - 14); break;
    case 'quadro': c.fillStyle = '#6a5a3a'; c.fillRect(px + 4, py, T - 8, T * 0.4); c.fillStyle = '#ddd'; c.fillRect(px + 7, py + 3, T - 14, T * 0.3); break;
    case 'cadeiras': for (let i = 0; i < 3; i++) { c.fillStyle = '#6a2a2a'; c.fillRect(px + 3 + i * 3, py + 3 + i * 4, T * 0.6, T * 0.4); } break;
    case 'caixotes': c.fillStyle = '#6b5236'; c.fillRect(px + 1, py + 1, T - 2, T - 2); c.strokeStyle = '#3d2e1d'; c.lineWidth = 2; c.beginPath(); c.moveTo(px + 2, py + 2); c.lineTo(px + T - 2, py + T - 2); c.moveTo(px + T - 2, py + 2); c.lineTo(px + 2, py + T - 2); c.stroke(); break;
    case 'canos': c.fillStyle = '#4a5a4a'; c.fillRect(px, py + 4, T, 6); c.fillStyle = '#2e3a2e'; c.fillRect(px + T - 4, py + 2, 4, 10); break;
    case 'caldeira': circle(c, cx, cy, T * 0.48, '#5a3a2a'); circle(c, cx, cy, T * 0.3, '#3a2418'); c.save(); c.globalAlpha = 0.5 + Math.sin(t * 3) * 0.2; circle(c, cx, cy + T * 0.2, T * 0.1, '#ff7a2a'); c.restore(); break;
    case 'pecas': c.fillStyle = '#555'; c.fillRect(px + 4, py + 10, 10, 6); circle(c, px + 20, py + 12, 6, '#6b4424'); circle(c, px + 20, py + 12, 2, '#ffcf4a'); c.strokeStyle = '#888'; c.beginPath(); c.moveTo(px + 6, py + 20); c.lineTo(px + 26, py + 26); c.stroke(); break;
    case 'cabos': c.strokeStyle = '#402a50'; c.lineWidth = 2; c.beginPath(); c.moveTo(px, py + 6); c.quadraticCurveTo(cx, py + 14, px + T, py + 5); c.stroke(); break;
    case 'carro': c.fillStyle = '#2a3a4a'; c.fillRect(px + 1, py + 3, T - 2, T - 6); c.fillStyle = '#1a2530'; c.fillRect(px + 4, py + 7, T - 8, T - 14); break;
    case 'arvore': circle(c, cx + 4, cy + 6, T * 0.6, 'rgba(0,0,0,.4)'); circle(c, cx, cy, T * 0.58, '#152419'); circle(c, cx - 4, cy - 4, T * 0.38, '#1d3322'); break;
    case 'placa':
      c.fillStyle = '#222'; c.fillRect(cx - 2, cy, 4, T / 2);
      c.fillStyle = '#3a1520'; c.fillRect(px - T * 0.8, py - 4, T * 2.6, T * 0.7);
      c.fillStyle = Math.floor(t * 1.3) % 7 === 0 ? '#553' : '#ffd98a';
      c.font = `${T * 0.38}px VT323, monospace`; c.textAlign = 'center'; c.fillText('PIZZARIA MEIA-LUA', cx, py + T * 0.28);
      break;
    case 'cerca': c.fillStyle = '#3a3a3a'; c.fillRect(px, py + T * 0.4, T, 3); for (let i = 0; i < 3; i++) c.fillRect(px + i * T / 3, py + T * 0.2, 2, T * 0.6); break;
  }
}

export function drawObject(c, o, px, py, T, t, { searched = false, hint = false, target = false, ringing = false } = {}) {
  const cx = px + T / 2, cy = py + T / 2;
  if (target) {
    c.save();
    c.strokeStyle = `rgba(255,210,110,${0.5 + Math.sin(t * 5) * 0.4})`;
    c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, T * (0.55 + Math.sin(t * 5) * 0.08), 0, TAU); c.stroke();
    c.restore();
  }
  switch (o.type) {
    case 'container':
      c.fillStyle = searched ? '#2c2622' : '#6b4f33'; c.fillRect(px + 5, py + 7, T - 10, T - 12);
      c.fillStyle = searched ? '#1c1814' : '#8a6a44'; c.fillRect(px + 5, py + 7, T - 10, 4);
      if (searched) { c.strokeStyle = '#111'; c.beginPath(); c.moveTo(px + 7, py + 9); c.lineTo(px + T - 7, py + T - 7); c.stroke(); }
      if (hint && !searched) {
        c.save(); c.shadowColor = '#b28bff'; c.shadowBlur = 16;
        c.fillStyle = `rgba(200,160,255,${0.5 + Math.sin(t * 7) * 0.4})`;
        c.font = `${T * 0.45}px monospace`; c.textAlign = 'center'; c.fillText('✦', cx, py + 6);
        c.restore();
      }
      break;
    case 'hide':
      c.fillStyle = '#34424a'; c.fillRect(px + 3, py + 1, T - 6, T - 2);
      c.fillStyle = '#1a2227'; for (let i = 0; i < 3; i++) c.fillRect(px + 7, py + 5 + i * 4, T - 14, 2);
      circle(c, px + T - 8, cy + 4, 1.5, '#aaa');
      break;
    case 'investigate':
      c.save(); c.globalAlpha = 0.6 + Math.sin(t * 4) * 0.3; c.fillStyle = '#ffd98a'; c.font = `${T * 0.5}px monospace`; c.textAlign = 'center'; c.fillText('?', cx, cy + T * 0.18); c.restore();
      break;
    case 'fusebox': case 'campanel': case 'breaker':
      c.fillStyle = '#4d5357'; c.fillRect(px + 7, py + 4, T - 14, T - 8);
      c.fillStyle = o.type === 'breaker' ? '#e7b04a' : '#222'; c.fillRect(px + 10, py + 8, T - 20, T * 0.35);
      circle(c, cx, py + T - 10, 2, Math.floor(t * 2) % 2 ? '#f44' : '#400');
      break;
    case 'console':
      c.save(); c.shadowColor = '#5f5'; c.shadowBlur = 8; c.fillStyle = '#1c3a24'; c.fillRect(px + 6, py + 8, T - 12, T - 16); c.restore();
      c.fillStyle = '#7f7'; c.font = `${T * 0.3}px monospace`; c.textAlign = 'center'; c.fillText('CAM', cx, cy + 4);
      break;
    case 'tapedeck': c.fillStyle = '#333'; c.fillRect(px + 5, py + 9, T - 10, T - 16); circle(c, cx - 5, cy, 3, '#888'); circle(c, cx + 5, cy, 3, '#888'); break;
    case 'phone':
      c.fillStyle = '#6a1d1d'; c.fillRect(px + 8, py + 10, T - 16, T - 18);
      if (ringing) { c.fillStyle = '#ffd98a'; c.font = `${T * 0.4}px monospace`; c.textAlign = 'center'; c.fillText('☎', cx + Math.sin(t * 40) * 2, py + 6); }
      break;
    case 'generator':
      c.fillStyle = '#5a5a2a'; c.fillRect(px + 1, py + 4, T - 2, T - 8);
      c.fillStyle = '#222'; for (let i = 0; i < 4; i++) c.fillRect(px + 4 + i * 6, py + 8, 3, T - 16);
      break;
    case 'keycutter': c.fillStyle = '#3a4a5a'; c.fillRect(px + 5, py + 6, T - 10, T - 12); c.fillStyle = '#7ee7e0'; c.fillRect(px + 9, py + 10, T - 18, 3); break;
    case 'altar':
      c.save(); c.shadowColor = '#7ab8ff'; c.shadowBlur = 20 + Math.sin(t * 3) * 8;
      c.fillStyle = '#2a2a4a'; c.fillRect(px - 4, py + 4, T + 8, T - 8);
      for (let i = 0; i < 3; i++) circle(c, px + 2 + i * (T / 2 - 2), cy, 4, '#7ab8ff');
      c.restore();
      break;
    case 'document': c.fillStyle = '#e6dcc4'; c.save(); c.translate(cx, cy); c.rotate(0.3); c.fillRect(-7, -9, 14, 18); c.fillStyle = '#777'; for (let i = 0; i < 4; i++) c.fillRect(-5, -6 + i * 4, 10, 1); c.restore(); break;
    case 'lore': c.fillStyle = '#d8c8a8'; c.fillRect(px + 2, py + 2, T - 4, T * 0.5); c.fillStyle = '#c2412d'; c.fillRect(px + 5, py + 5, 6, 6); c.fillStyle = '#3a78a0'; c.fillRect(px + 14, py + 6, 8, 5); break;
    case 'gate': c.fillStyle = '#555'; for (let i = -2; i <= 3; i++) c.fillRect(px + i * 6, py, 3, T); c.fillStyle = '#8a6a2a'; c.fillRect(px - 12, cy - 2, T + 24, 4); break;
  }
}

export function drawDoor(c, d, px, py, T, state) {
  const open = state?.open, locked = state?.locked;
  const horizontal = d.horizontal;
  const color = d.kind === 'power' ? (open ? '#2a4a3a' : '#7a2a2a') : locked ? '#5a3a1a' : '#6b4a2e';
  c.fillStyle = '#0d0b10'; c.fillRect(px, py, T, T);
  if (open) {
    c.fillStyle = color;
    if (horizontal) { c.fillRect(px, py, 4, T); c.fillRect(px + T - 4, py, 4, T); }
    else { c.fillRect(px, py, T, 4); c.fillRect(px, py + T - 4, T, 4); }
    c.fillStyle = 'rgba(80,70,60,.25)'; c.fillRect(px + 4, py + 4, T - 8, T - 8);
  } else {
    c.fillStyle = color;
    if (horizontal) c.fillRect(px, py + T * 0.3, T, T * 0.4);
    else c.fillRect(px + T * 0.3, py, T * 0.4, T);
    if (d.kind === 'power') { c.fillStyle = '#ffcc33'; for (let i = 0; i < 3; i++) (horizontal ? c.fillRect(px + 3 + i * 10, py + T * 0.45, 5, 3) : c.fillRect(px + T * 0.45, py + 3 + i * 10, 3, 5)); }
    if (locked) { c.fillStyle = '#e7b04a'; c.font = `${T * 0.45}px monospace`; c.textAlign = 'center'; c.fillText('🔒', px + T / 2, py + T * 0.65); }
  }
}

export function drawItemIcon(c, icon, x, y, T, t) {
  c.save();
  c.shadowColor = '#ffe2a8'; c.shadowBlur = 10 + Math.sin(t * 4) * 5;
  c.font = `${T * 0.55}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(icon, x, y + Math.sin(t * 3) * 2);
  c.restore();
}
