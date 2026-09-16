// Sistema de áudio 100% sintetizado (Web Audio API) — sons originais, sem arquivos externos.
import { settings, onSettings } from './settings.js';

// Timbre de grito por animatrônico (jumpscare): cada um tem uma "voz"
// diferente — grave e gutural, agudo e insetóide, metálico, etc. — pra não
// soar todo mundo igual (ver AudioSystem.play('jumpscare', { variant })).
const JUMPSCARE_VOICES = {
  tonho: { base: 150, harsh: 95, top: 1300 }, // rosnado grave de bicho grande
  marola: { base: 260, harsh: 210, top: 2500 }, // grito molhado, gorgolejante
  lume: { base: 780, harsh: 560, top: 5400 }, // guincho agudo de inseto
  gregorio: { base: 85, harsh: 55, top: 1400 }, // rugido metálico pesado
  maestro: { base: 220, harsh: 330, top: 2200 }, // acorde dissonante, quase musical
};

class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.loops = new Map();
    this.heartbeatUntil = 0;
    this.nextBeat = 0;
    this.nextCreak = 0;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    // leve compressão para evitar estouro nos jumpscares
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.applyVolumes();
    onSettings(() => this.applyVolumes());

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // distorção pesada para os jumpscares
    this.dist = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = (i / 1024) - 1; curve[i] = Math.tanh(x * 9) * 0.9; }
    this.dist.curve = curve;
    this.distGain = ctx.createGain();
    this.distGain.gain.value = 0.9;
    this.dist.connect(this.distGain);
    this.distGain.connect(this.sfxBus);
    this.ready = true;
  }

  duck(seconds = 0.12) {
    if (!this.ready) return;
    const t = this.now;
    for (const bus of [this.musicBus]) {
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(0.0001, t);
      bus.gain.linearRampToValueAtTime(settings.music, t + seconds + 1.2);
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = settings.master;
    this.musicBus.gain.value = settings.music;
    this.sfxBus.gain.value = settings.sfx;
  }

  get now() { return this.ctx.currentTime; }

  // ---------- blocos ----------
  out(vol = 1, pan = 0, bus = this.sfxBus) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); p.connect(bus);
    } else g.connect(bus);
    return g;
  }

  noise(dest, t, dur, { type = 'lowpass', freq = 1000, q = 1, vol = 1, attack = 0.005, freqEnd } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  tone(dest, t, dur, { type = 'sine', freq = 440, freqEnd, vol = 0.3, attack = 0.01, detune = 0 } = {}) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------- efeitos ----------
  play(name, { vol = 1, pan = 0, variant } = {}) {
    if (!this.ready || vol <= 0.01) return;
    const t = this.now;
    const o = this.out(vol, pan);
    switch (name) {
      case 'step': this.noise(o, t, 0.09, { freq: 500 + Math.random() * 300, vol: 0.25 }); break;
      case 'animStep':
        this.noise(o, t, 0.16, { freq: 180, vol: 0.6 });
        this.tone(o, t, 0.12, { type: 'square', freq: 70 + Math.random() * 20, vol: 0.12 });
        break;
      case 'doorOpen': this.tone(o, t, 0.5, { type: 'sawtooth', freq: 180, freqEnd: 90, vol: 0.08 }); this.noise(o, t, 0.25, { freq: 900, vol: 0.2 }); break;
      case 'doorClose': case 'slam': this.noise(o, t, name === 'slam' ? 0.6 : 0.3, { freq: 220, vol: name === 'slam' ? 1 : 0.6 }); this.tone(o, t, 0.25, { freq: 60, vol: 0.5 }); break;
      case 'doorPower':
        this.tone(o, t, 0.35, { type: 'square', freq: 90, freqEnd: 40, vol: 0.2 });
        this.noise(o, t + 0.25, 0.35, { freq: 140, vol: 0.9 });
        break;
      case 'doorBreak': case 'bash':
        this.noise(o, t, 0.5, { freq: 300, vol: 1 });
        this.tone(o, t, 0.4, { type: 'square', freq: 55, vol: 0.4 });
        this.tone(o, t + 0.05, 0.3, { type: 'triangle', freq: 1200, freqEnd: 300, vol: 0.1 });
        break;
      case 'locked': this.tone(o, t, 0.08, { type: 'square', freq: 300, vol: 0.1 }); this.tone(o, t + 0.1, 0.08, { type: 'square', freq: 260, vol: 0.1 }); break;
      case 'click': this.tone(o, t, 0.03, { type: 'square', freq: 1800, vol: 0.12 }); break;
      case 'pickup': this.tone(o, t, 0.12, { freq: 660, vol: 0.2 }); this.tone(o, t + 0.08, 0.2, { freq: 990, vol: 0.2 }); break;
      case 'use': this.tone(o, t, 0.2, { type: 'triangle', freq: 440, freqEnd: 880, vol: 0.2 }); break;
      case 'search': for (let i = 0; i < 4; i++) this.noise(o, t + i * 0.12, 0.1, { type: 'bandpass', freq: 1500 + Math.random() * 1500, vol: 0.25 }); break;
      case 'repair': for (let i = 0; i < 3; i++) this.tone(o, t + i * 0.15, 0.06, { type: 'square', freq: 1400 + Math.random() * 600, vol: 0.06 }); break;
      case 'deliver': this.tone(o, t, 0.15, { type: 'square', freq: 220, vol: 0.12 }); this.tone(o, t + 0.12, 0.4, { freq: 523, vol: 0.18 }); break;
      case 'hide': this.noise(o, t, 0.35, { freq: 400, vol: 0.4 }); break;
      case 'breaker': this.noise(o, t, 0.1, { freq: 3000, vol: 0.6, type: 'highpass' }); this.tone(o, t, 0.6, { type: 'sawtooth', freq: 60, vol: 0.12 }); break;
      case 'quest': [523, 659, 784].forEach((f, i) => this.tone(o, t + i * 0.12, 0.5, { type: 'triangle', freq: f, vol: 0.2 })); break;
      case 'levelup': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(o, t + i * 0.09, 0.5, { type: 'triangle', freq: f, vol: 0.18 })); break;
      case 'laugh':
        for (let i = 0; i < 5; i++) {
          this.tone(o, t + i * 0.16, 0.13, { type: 'sawtooth', freq: 260 - i * 18, vol: 0.12, detune: Math.random() * 30 });
          this.noise(o, t + i * 0.16, 0.12, { type: 'bandpass', freq: 900, q: 4, vol: 0.12 });
        }
        break;
      case 'music': case 'musicbox': {
        const scale = [0, 3, 5, 6, 7, 10, 12];
        let tt = t;
        for (let i = 0; i < 8; i++) {
          const f = 523 * Math.pow(2, scale[Math.floor(Math.random() * scale.length)] / 12);
          this.tone(o, tt, 0.7, { type: 'sine', freq: f, vol: 0.12, detune: -25 + Math.random() * 10 });
          this.tone(o, tt, 0.4, { type: 'triangle', freq: f * 2, vol: 0.03 });
          tt += 0.22 + (Math.random() < 0.2 ? 0.2 : 0);
        }
        break;
      }
      case 'child': [330, 294, 262, 294, 330].forEach((f, i) => this.tone(o, t + i * 0.35, 0.34, { freq: f, vol: 0.06, detune: Math.random() * 40 })); break;
      case 'metal': this.tone(o, t, 1.6, { type: 'triangle', freq: 180, vol: 0.2 }); this.tone(o, t, 1.2, { type: 'sine', freq: 731, vol: 0.12 }); this.noise(o, t, 0.15, { freq: 2000, vol: 0.4 }); break;
      case 'drag': this.noise(o, t, 1.1, { type: 'bandpass', freq: 300, q: 2, vol: 0.5, attack: 0.2 }); break;
      case 'steps': for (let i = 0; i < 6; i++) this.noise(o, t + i * 0.28, 0.14, { freq: 200, vol: 0.5 }); break;
      case 'phone':
        for (let r = 0; r < 3; r++) for (let i = 0; i < 10; i++) this.tone(o, t + r * 1.2 + i * 0.05, 0.045, { type: 'square', freq: i % 2 ? 800 : 950, vol: 0.06 });
        break;
      case 'phonePick': this.noise(o, t, 0.5, { type: 'highpass', freq: 2000, vol: 0.2 }); break;
      case 'scream':
        this.tone(o, t, 0.9, { type: 'sawtooth', freq: 480, freqEnd: 180, vol: 0.5 });
        this.tone(o, t, 0.9, { type: 'square', freq: 520, freqEnd: 150, vol: 0.3, detune: 40 });
        this.noise(o, t, 1.0, { freq: 3000, vol: 0.8, freqEnd: 400 });
        break;
      case 'jumpscare': {
        // 0) estalo seco e instantâneo — o "susto" em si, uma fração de
        // segundo antes do grito, que é o que faz o som ser reconhecido
        // como jumpscare (sem ele, fica só um grito qualquer).
        const v = JUMPSCARE_VOICES[variant] || JUMPSCARE_VOICES.tonho;
        this.noise(o, t, 0.07, { type: 'highpass', freq: 1000, vol: 1, attack: 0.0008 });
        this.tone(o, t, 0.05, { type: 'square', freq: v.harsh * 2.2, vol: 0.55, attack: 0.0008 });
        // grito metálico distorcido (voz varia por animatrônico) + impacto
        // grave + estática — tudo mais alto e mais brusco que antes.
        const d = this.ctx.createGain();
        d.gain.value = 1;
        d.connect(this.dist);
        const t0 = t + 0.045;
        for (const [f, det] of [[v.base, 0], [v.base * 1.06, 35], [v.top * 0.5, -20], [v.harsh, 12]]) {
          this.tone(d, t0, 1.3, { type: 'sawtooth', freq: f, freqEnd: f * 0.3, vol: 0.55, attack: 0.003, detune: det });
        }
        for (let i = 0; i < 18; i++) this.tone(d, t0 + i * 0.038, 0.05, { type: 'square', freq: v.top * (0.35 + Math.random() * 0.7), vol: 0.3, attack: 0.0015 });
        this.noise(d, t0, 1.35, { type: 'bandpass', freq: 2900, q: 0.5, vol: 1, attack: 0.002, freqEnd: 420 });
        this.tone(o, t0, 0.95, { type: 'sine', freq: 105, freqEnd: 26, vol: 1, attack: 0.0015 });
        this.noise(o, t0, 0.3, { type: 'lowpass', freq: 170, vol: 1, attack: 0.0015 });
        this.duck(1.5);
        break;
      }
      case 'jumpscareFatal':
        this.play('jumpscare', { vol, variant });
        this.tone(o, t + 0.9, 1.4, { type: 'sawtooth', freq: 55, freqEnd: 30, vol: 0.6 });
        this.noise(o, t + 1.0, 1.2, { type: 'highpass', freq: 3000, vol: 0.5, attack: 0.3 });
        break;
      case 'teleportOut':
        // "sumiço" do animatrônico depois de atacar: estática subindo +
        // um tom grave escorregando pra baixo, cortando seco no final.
        this.noise(o, t, 0.5, { type: 'highpass', freq: 3200, vol: 0.6, attack: 0.002, freqEnd: 9500 });
        this.tone(o, t, 0.35, { type: 'sine', freq: 820, freqEnd: 55, vol: 0.32, attack: 0.002 });
        this.tone(o, t + 0.05, 0.18, { type: 'square', freq: 1700, vol: 0.08, attack: 0.001 });
        break;
      case 'notice': {
        // "ele percebeu": raspão metálico + inspiração reversa + batida seca
        this.noise(o, t, 0.9, { type: 'bandpass', freq: 400, q: 2, vol: 0.9, attack: 0.75, freqEnd: 2600 });
        this.tone(o, t + 0.78, 0.6, { type: 'sawtooth', freq: 180, freqEnd: 90, vol: 0.35, attack: 0.003 });
        this.tone(o, t + 0.78, 0.9, { type: 'square', freq: 1244, vol: 0.06, attack: 0.003 });
        this.noise(o, t + 0.78, 0.18, { type: 'lowpass', freq: 200, vol: 1, attack: 0.002 });
        break;
      }
      case 'cymbals':
        for (let k = 0; k < 3; k++) {
          const tt = t + k * 0.22;
          this.noise(o, tt, 0.7, { type: 'highpass', freq: 5000, vol: 0.9, attack: 0.002 });
          this.noise(o, tt, 0.5, { type: 'bandpass', freq: 8000, q: 3, vol: 0.6, attack: 0.002 });
          this.tone(o, tt, 0.6, { type: 'square', freq: 3130, vol: 0.05, attack: 0.002 });
        }
        break;
      case 'radio':
        this.noise(o, t, 0.9, { type: 'bandpass', freq: 1800, q: 2, vol: 0.35, attack: 0.02 });
        this.tone(o, t + 0.1, 0.3, { type: 'square', freq: 440 + Math.random() * 300, vol: 0.05 });
        break;
      case 'gasp': this.noise(o, t, 0.6, { type: 'bandpass', freq: 1100, q: 1.5, vol: 0.9, attack: 0.03 }); break;
      case 'thunder':
        this.noise(o, t, 0.25, { type: 'highpass', freq: 2000, vol: 0.5 * vol, attack: 0.002 });
        this.noise(o, t + 0.15, 3.2, { type: 'lowpass', freq: 220, vol: 1, attack: 0.08, freqEnd: 60 });
        break;
      case 'heartbeatFast':
        this.tone(o, t, 0.1, { freq: 70, freqEnd: 40, vol: 1 });
        this.tone(o, t + 0.12, 0.1, { freq: 60, freqEnd: 36, vol: 0.7 });
        break;
      case 'stepNear':
        this.noise(o, t, 0.2, { freq: 120, vol: 1 });
        this.tone(o, t, 0.18, { type: 'square', freq: 48, vol: 0.35 });
        break;
      case 'chaseSting':
        this.tone(o, t, 1.4, { type: 'sawtooth', freq: 110, vol: 0.25 });
        this.tone(o, t, 1.4, { type: 'sawtooth', freq: 116, vol: 0.25 });
        this.noise(o, t, 0.6, { type: 'highpass', freq: 4000, vol: 0.3 });
        break;
      case 'blackout':
        this.tone(o, t, 2.5, { type: 'sawtooth', freq: 120, freqEnd: 30, vol: 0.4 });
        this.noise(o, t, 0.3, { freq: 5000, type: 'highpass', vol: 0.6 });
        break;
      case 'powerOn': this.tone(o, t, 1.2, { type: 'sawtooth', freq: 40, freqEnd: 120, vol: 0.3 }); break;
      case 'static': this.noise(o, t, 0.4, { type: 'highpass', freq: 2500, vol: 0.4 }); break;
      case 'flare': this.noise(o, t, 1.4, { type: 'highpass', freq: 1500, vol: 0.6, attack: 0.05 }); this.tone(o, t, 0.2, { type: 'square', freq: 90, vol: 0.4 }); break;
      case 'tired': this.noise(o, t, 0.9, { type: 'bandpass', freq: 700, q: 3, vol: 0.4, attack: 0.2 }); break;
      case 'roll': for (let i = 0; i < 10; i++) this.noise(o, t + i * 0.07, 0.06, { freq: 250, vol: 0.5 }); break;
      case 'conduct': [262, 311, 370, 523].forEach((f, i) => this.tone(o, t + i * 0.18, 0.9, { type: 'sawtooth', freq: f / 2, vol: 0.1 })); break;
      case 'whisper': this.noise(o, t, 1.5, { type: 'bandpass', freq: 2500, q: 6, vol: 0.2, attack: 0.3 }); break;
      case 'hurt': this.tone(o, t, 0.3, { type: 'square', freq: 150, freqEnd: 60, vol: 0.3 }); break;
      case 'wings': for (let i = 0; i < 8; i++) this.noise(o, t + i * 0.06, 0.05, { type: 'bandpass', freq: 400, q: 1, vol: 0.4 }); break;
      case 'final': this.play('conduct'); this.play('musicbox'); this.tone(o, t, 4, { type: 'sawtooth', freq: 55, vol: 0.3 }); break;
    }
  }

  // ---------- loops contínuos ----------
  setLoop(name, vol) {
    if (!this.ready) return;
    let l = this.loops.get(name);
    if (!l) {
      if (vol <= 0.001) return;
      l = this.createLoop(name);
      this.loops.set(name, l);
    }
    l.gain.gain.setTargetAtTime(Math.max(0, vol), this.now, 0.15);
  }

  createLoop(name) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const bus = name === 'ambient' || name === 'chase' ? this.musicBus : this.sfxBus;
    gain.connect(bus);
    const nodes = [];
    const osc = (type, freq, v, detune = 0) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
      const g = ctx.createGain(); g.gain.value = v; o.connect(g); nodes.push(o); o.start(); return g;
    };
    const noise = (type, freq, v, q = 1) => {
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = v; s.connect(f); f.connect(g); s.start(); nodes.push(s); return g;
    };
    if (name === 'ambient') {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      osc('sawtooth', 43.65, 0.25).connect(lp);
      osc('sawtooth', 43.65, 0.25, 9).connect(lp);
      osc('sine', 65.4, 0.2, -6).connect(lp);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lg = ctx.createGain(); lg.gain.value = 90; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); nodes.push(lfo);
      lp.connect(gain);
      noise('lowpass', 300, 0.05).connect(gain);
    } else if (name === 'hum') {
      osc('sawtooth', 60, 0.05).connect(gain);
      osc('sine', 120, 0.06).connect(gain);
      noise('bandpass', 1200, 0.02, 5).connect(gain);
    } else if (name === 'generator') {
      osc('square', 38, 0.12).connect(gain);
      noise('lowpass', 180, 0.35).connect(gain);
    } else if (name === 'freezer') {
      osc('sine', 100, 0.1).connect(gain);
      noise('bandpass', 600, 0.08, 2).connect(gain);
    } else if (name === 'static') {
      noise('highpass', 1800, 0.4).connect(gain);
      noise('bandpass', 300, 0.15, 0.5).connect(gain);
    } else if (name === 'chase') {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      osc('sawtooth', 82.4, 0.15).connect(lp);
      osc('sawtooth', 87.3, 0.15).connect(lp);
      osc('square', 164.8, 0.04, 12).connect(lp);
      lp.connect(gain);
    } else if (name === 'wind') {
      noise('bandpass', 500, 0.3, 0.7).connect(gain);
    } else if (name === 'tension') {
      // cluster dissonante agudo com tremolo — sobe quando alguém te encara
      const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 1400; lp.Q.value = 0.7;
      const trem = ctx.createGain(); trem.gain.value = 0.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 7;
      const lg = ctx.createGain(); lg.gain.value = 0.4;
      lfo.connect(lg); lg.connect(trem.gain); lfo.start(); nodes.push(lfo);
      osc('sawtooth', 739.99, 0.05).connect(lp);
      osc('sawtooth', 783.99, 0.05, 8).connect(lp);
      osc('sawtooth', 1046.5, 0.035, -14).connect(lp);
      osc('sine', 46.25, 0.5).connect(trem);
      lp.connect(trem);
      noise('highpass', 6000, 0.05).connect(trem);
      trem.connect(gain);
    } else if (name === 'rain') {
      noise('highpass', 2500, 0.25, 0.5).connect(gain);
      noise('lowpass', 900, 0.12, 0.5).connect(gain);
    } else if (name === 'breath') {
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.45;
      const lg = ctx.createGain(); lg.gain.value = 0.25;
      const n = noise('bandpass', 800, 0.3, 1.2);
      const g2 = ctx.createGain(); g2.gain.value = 0.3;
      lfo.connect(lg); lg.connect(g2.gain); lfo.start(); nodes.push(lfo);
      n.connect(g2); g2.connect(gain);
    }
    return { gain, nodes };
  }

  /** Chamado a cada frame: batimentos cardíacos e rangidos ambientes */
  update(fear, inChase) {
    if (!this.ready) return;
    const t = this.now;
    const intensity = Math.max(fear / 100, inChase ? 1 : 0);
    if (intensity > 0.35 && t >= this.nextBeat) {
      const o = this.out(0.35 + intensity * 0.5, 0, this.musicBus);
      this.tone(o, t, 0.12, { freq: 60, freqEnd: 40, vol: 0.9 });
      this.tone(o, t + 0.16, 0.12, { freq: 55, freqEnd: 38, vol: 0.6 });
      this.nextBeat = t + (1.1 - intensity * 0.6);
    }
    if (t >= this.nextCreak) {
      this.nextCreak = t + 8 + Math.random() * 16;
      const o = this.out(0.15 + Math.random() * 0.2, Math.random() * 2 - 1, this.musicBus);
      if (Math.random() < 0.5) this.tone(o, t, 1.3, { type: 'sawtooth', freq: 300 + Math.random() * 200, freqEnd: 200, vol: 0.05 });
      else this.noise(o, t, 1.5, { type: 'bandpass', freq: 200 + Math.random() * 400, q: 8, vol: 0.3, attack: 0.4 });
    }
  }

  stopAll() {
    for (const l of this.loops.values()) l.gain.gain.setTargetAtTime(0, this.now, 0.2);
  }
}

export const audio = new AudioSystem();
