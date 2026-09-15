// Utilidades de interface (DOM)
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

let current = null;
const history = [];
export function showScreen(id, { push = true } = {}) {
  const next = document.getElementById(`scr-${id}`);
  if (!next) return;
  if (current && push && current !== id) history.push(current);
  for (const s of $$('.screen')) s.classList.toggle('active', s === next);
  current = id;
  document.dispatchEvent(new CustomEvent('screen', { detail: id }));
}
export function currentScreen() { return current; }
export function previousScreen() { return history.pop() || 'menu'; }

export function toast(text, kind = 'info', ms = 4000) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = el('div', { class: `toast ${kind}`, text });
  box.append(t);
  while (box.children.length > 5) box.firstChild.remove();
  setTimeout(() => t.remove(), kind === 'whisper' ? 4200 : ms);
}

export function modal(text) {
  return new Promise((resolve) => {
    $('#modal-text').textContent = text;
    $('#modal').hidden = false;
    $('#modal-ok').onclick = () => { $('#modal').hidden = true; resolve(); };
  });
}

export function setupTabs() {
  for (const tabs of $$('[data-tabs]')) {
    const container = tabs.parentElement;
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      for (const t of $$('.tab', tabs)) t.classList.toggle('active', t === b);
      for (const p of $$(':scope > .tab-page', container)) p.classList.toggle('active', p.dataset.page === b.dataset.tab);
    });
  }
}

export function fmtTime(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (!h && !m) return `${sec}s`;
  return h ? `${h}h ${m}min` : `${m}min ${sec % 60}s`;
}

export const PLAYER_COLORS = ['#e7b04a', '#6fd5d0', '#e56b9b', '#9ee56b', '#b28bff', '#ff8a4a', '#6b9bff', '#f5f5f5'];
