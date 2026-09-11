(function () {
  'use strict';
  const KEY = 'wificord-sounds';
  let enabled = localStorage.getItem(KEY) !== 'off';
  let ctx = null;
  let loopTimer = null;
  let loopToken = 0;

  function setEnabled(value) {
    enabled = !!value;
    localStorage.setItem(KEY, enabled ? 'on' : 'off');
    if (!enabled) stopLoop();
  }

  function getCtx() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = ctx || new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Toca um único tom (beep) com envelope curto.
  function tone(freq, start, dur, opts) {
    const c = getCtx();
    if (!c) return;
    opts = opts || {};
    const t0 = c.currentTime + (start || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = opts.type || 'sine';
    if (opts.glideTo) {
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t0 + dur);
    } else {
      osc.frequency.setValueAtTime(freq, t0);
    }
    const peak = opts.gain || 0.09;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Ruído curtinho (usado no clique, mais "seco" que um tom puro).
  function click(start, opts) {
    const c = getCtx();
    if (!c) return;
    opts = opts || {};
    const t0 = c.currentTime + (start || 0);
    const dur = 0.03;
    const bufSize = Math.floor(c.sampleRate * dur);
    const buffer = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = opts.freq || 2200;
    const gain = c.createGain();
    gain.gain.setValueAtTime(opts.gain || 0.05, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start(t0);
  }

  const PATTERNS = {
    // Cliques e ações rápidas de UI
    'click': () => click(0, { freq: 2400, gain: 0.045 }),
    'toggle-on': () => { tone(520, 0, 0.05, { gain: 0.06 }); tone(760, 0.05, 0.06, { gain: 0.06 }); },
    'toggle-off': () => { tone(600, 0, 0.05, { gain: 0.06 }); tone(380, 0.05, 0.07, { gain: 0.06 }); },

    // Mensagens / notificações
    'message': () => { tone(700, 0, 0.08, { gain: 0.07 }); tone(920, 0.07, 0.11, { gain: 0.06 }); },
    'notification': () => { tone(660, 0, 0.09, { gain: 0.08 }); tone(880, 0.09, 0.12, { gain: 0.07 }); },

    // Chamadas
    'call-join': () => { tone(440, 0, 0.09, { gain: 0.08 }); tone(660, 0.09, 0.09, { gain: 0.08 }); tone(880, 0.17, 0.14, { gain: 0.07 }); },
    'call-leave': () => { tone(660, 0, 0.09, { gain: 0.08 }); tone(440, 0.09, 0.09, { gain: 0.08 }); tone(280, 0.17, 0.18, { gain: 0.07 }); },
    'call-ring': () => { tone(720, 0, 0.16, { gain: 0.08, type: 'triangle' }); tone(880, 0.18, 0.16, { gain: 0.08, type: 'triangle' }); },
    'call-ringback': () => { tone(480, 0, 0.35, { gain: 0.06, type: 'sine' }); tone(480, 0.45, 0.35, { gain: 0.06, type: 'sine' }); },

    // Compartilhamento de tela
    'screen-start': () => tone(420, 0, 0.22, { gain: 0.07, glideTo: 900 }),
    'screen-stop': () => tone(900, 0, 0.22, { gain: 0.07, glideTo: 380 }),

    // Feedback genérico
    'success': () => { tone(600, 0, 0.08, { gain: 0.07 }); tone(760, 0.08, 0.08, { gain: 0.07 }); tone(1000, 0.16, 0.14, { gain: 0.07 }); },
    'error': () => { tone(300, 0, 0.14, { gain: 0.08, type: 'square' }); tone(220, 0.12, 0.18, { gain: 0.07, type: 'square' }); },

    // Minigame Flappy Cubes
    'game-flap': () => tone(520, 0, 0.07, { gain: 0.06, type: 'triangle', glideTo: 700 }),
    'game-score': () => { tone(880, 0, 0.07, { gain: 0.07, type: 'sine' }); tone(1180, 0.06, 0.09, { gain: 0.06, type: 'sine' }); },
    'game-over': () => { tone(420, 0, 0.12, { gain: 0.08, type: 'sawtooth' }); tone(280, 0.11, 0.16, { gain: 0.07, type: 'sawtooth' }); tone(180, 0.24, 0.22, { gain: 0.06, type: 'sawtooth' }); },
    // Uma nota por chamada, avançando por uma escala — usado em loop pelo
    // startLoop('game-music') como trilha sonora ambiente do minigame.
    'game-note': (() => {
      const scale = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
      let i = 0;
      return () => {
        const freq = scale[i % scale.length];
        i++;
        tone(freq, 0, 0.22, { gain: 0.035, type: 'triangle' });
        if (i % 4 === 0) tone(freq / 2, 0, 0.3, { gain: 0.025, type: 'sine' });
      };
    })(),
  };

  function play(type) {
    if (!enabled) return;
    try {
      const fn = PATTERNS[type];
      if (fn) fn();
      else tone(420, 0, 0.14, { gain: 0.07 });
    } catch (_) {}
  }

  // Loops para "ligando" (ringback, chamando alguém), "recebendo chamada"
  // (tocando) e a trilha sonora ambiente do minigame ("game-music" — uma
  // nota da escala por tick, criando uma linha melódica simples).
  const LOOP_INTERVAL = { incoming: 1600, ringback: 1000, 'game-music': 260 };
  const LOOP_SOUND = { incoming: 'call-ring', ringback: 'call-ringback', 'game-music': 'game-note' };
  function startLoop(kind) {
    stopLoop();
    if (!enabled) return;
    const soundType = LOOP_SOUND[kind] || 'call-ringback';
    const interval = LOOP_INTERVAL[kind] || 1500;
    const myToken = ++loopToken;
    play(soundType);
    loopTimer = setInterval(() => {
      if (myToken !== loopToken) return;
      play(soundType);
    }, interval);
  }
  function stopLoop() {
    loopToken++;
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  }

  // Clique automático em botões e elementos interativos, sem precisar
  // instrumentar cada tela manualmente.
  document.addEventListener('click', (e) => {
    const target = e.target.closest('button, .btn, [class*="-btn"], .rail-item, [role="button"]');
    if (!target) return;
    if (target.disabled || target.classList.contains('disabled')) return;
    play('click');
  }, true);

  window.Sounds = { play, isEnabled: () => enabled, setEnabled, startLoop, stopLoop };
})();
