// Configurações por navegador (localStorage protegido por try/catch)
const KEY = 'meialua.settings';
const DEFAULTS = {
  master: 0.8, music: 0.6, sfx: 0.9, voice: 1,
  crt: true, shake: true, showFps: false, touch: 'auto', ptt: false, quality: 'auto', fx: 'high',
};
let data = { ...DEFAULTS };
try { Object.assign(data, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignora */ }

const listeners = new Set();
export const settings = new Proxy(data, {
  set(t, k, v) {
    t[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignora */ }
    for (const fn of listeners) fn(k, v);
    return true;
  },
});
export function onSettings(fn) { listeners.add(fn); }

export function isTouchDevice() {
  if (settings.touch === 'on') return true;
  if (settings.touch === 'off') return false;
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}
