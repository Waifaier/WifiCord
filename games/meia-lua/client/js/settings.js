// Configurações por navegador (localStorage protegido por try/catch)
const KEY = 'meialua.settings';

// Indício cru de toque/celular, sem depender de `settings` (que ainda não
// existe nesse ponto do arquivo) — usado só pra escolher o default de "fx"
// abaixo. isTouchDevice() (fim do arquivo) reaproveita essa mesma checagem
// depois que `settings` já existe, junto com a preferência manual do jogador.
function coarsePointer() {
  try { return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; } catch { return false; }
}

const DEFAULTS = {
  master: 0.8, music: 0.6, sfx: 0.9, voice: 1,
  crt: true, shake: true, showFps: false, touch: 'auto', ptt: false, quality: 'auto',
  // Os shaders em WebGL (CRT curvo, aberração cromática, grão, bloom — ver
  // postfx.js) têm um bug relatado por um jogador de verdade num
  // GPU/navegador de celular específico: a tela do jogo fica completamente
  // preta com eles ligados (mesmo com o jogo rodando certinho por baixo), e
  // volta a funcionar assim que são desligados manualmente. Sem acesso a
  // esse aparelho pra reproduzir e achar a causa exata dentro do shader,
  // desligar por padrão em celular é a troca sensata: perder o efeito
  // visual é bem melhor que o jogo ficar ilegível pra quem nunca soube que
  // existia essa opção de desligar. Quem já tinha uma preferência salva
  // (localStorage) continua com ela — isso só muda o default pra quem
  // nunca mexeu na opção.
  fx: coarsePointer() ? 'off' : 'high',
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
  return coarsePointer();
}
