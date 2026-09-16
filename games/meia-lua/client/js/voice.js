// Chat de voz P2P (WebRTC em malha). O servidor só retransmite a sinalização.
// Usa STUN público gratuito (configurável em ICE_SERVERS no .env). Sem serviços pagos.
import { settings } from './settings.js';

export class VoiceChat {
  constructor(socket, iceServers) {
    this.socket = socket;
    this.iceServers = iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
    this.peers = new Map(); // id -> { pc, audio }
    this.stream = null;
    this.active = false;
    this.talking = false;
    this.onChange = () => {};
    this._levelCtx = null;
    this._levelRaf = null;

    socket.on('voice:peer-joined', ({ id }) => { if (this.active) this.connect(id, true); });
    socket.on('voice:peer-left', ({ id }) => this.drop(id));
    socket.on('voice:reset', () => this.leave());
    socket.on('voice:signal', (m) => this.onSignal(m));
  }

  async join() {
    if (this.active) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Seu navegador não suporta microfone (use HTTPS ou localhost).');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    this.active = true;
    this.applyPtt();
    const res = await new Promise((r) => this.socket.emit('voice:join', {}, r));
    if (!res?.ok) { this.leave(); throw new Error(res?.error || 'Falha ao entrar na voz.'); }
    // Quem entra agora espera ofertas de quem já está? Não: quem entra inicia com os existentes.
    for (const id of res.peers) this.connect(id, true);
    this.startLevelMeter();
    this.onChange();
  }

  leave() {
    if (!this.active && !this.stream) return;
    this.active = false;
    this.stopLevelMeter();
    this.socket.emit('voice:leave', {});
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.onChange();
  }

  // Mede o volume do próprio microfone localmente (Web Audio) e manda só
  // um número (0..1) pro servidor de vez em quando — nunca o áudio em si.
  // É o que dá ao Gregório (hearsVoice, ver server/ai/types.js) o "ouvido"
  // pra perceber o jogador falando, igual ele já percebe passos.
  startLevelMeter() {
    if (this._levelCtx || !this.stream) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(this.stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      src.connect(analyser);
      this._levelCtx = ctx;
      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastSent = 0;
      const tick = () => {
        if (!this.active || this._levelCtx !== ctx) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        const now = performance.now();
        const speaking = !settings.ptt || this.talking;
        if (speaking && rms > 0.035 && now - lastSent > 350) {
          lastSent = now;
          this.socket.emit('voice:level', { l: Math.min(1, rms * 4.5) });
        }
        this._levelRaf = requestAnimationFrame(tick);
      };
      this._levelRaf = requestAnimationFrame(tick);
    } catch (err) { console.warn('[voz] medidor de volume', err); }
  }

  stopLevelMeter() {
    if (this._levelRaf) cancelAnimationFrame(this._levelRaf);
    this._levelRaf = null;
    if (this._levelCtx) { const c = this._levelCtx; this._levelCtx = null; c.close().catch(() => {}); }
  }

  applyPtt() {
    if (!this.stream) return;
    const enabled = !settings.ptt || this.talking;
    this.stream.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  setTalking(v) {
    this.talking = v;
    this.applyPtt();
    this.onChange();
  }

  connect(id, initiator) {
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    const peer = { pc, audio, makingOffer: false };
    this.peers.set(id, peer);
    this.stream?.getTracks().forEach((t) => pc.addTrack(t, this.stream));
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); };
    pc.onicecandidate = (e) => { if (e.candidate) this.socket.emit('voice:signal', { to: id, data: { ice: e.candidate } }); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.drop(id); };
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription(await pc.createOffer());
          this.socket.emit('voice:signal', { to: id, data: { sdp: pc.localDescription } });
        } catch (err) { console.warn('[voz]', err); } finally { peer.makingOffer = false; }
      };
    }
    return peer;
  }

  async onSignal({ from, data }) {
    if (!this.active || !data) return;
    const peer = this.peers.get(from) || this.connect(from, false);
    const pc = peer.pc;
    try {
      if (data.sdp) {
        const collision = data.sdp.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        if (collision && this.myId > from) return; // "impolite" ignora
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.socket.emit('voice:signal', { to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.ice) {
        await pc.addIceCandidate(data.ice).catch(() => {});
      }
    } catch (err) { console.warn('[voz] sinalização', err); }
  }

  drop(id) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.audio.srcObject = null;
    this.peers.delete(id);
  }

  /** Volume por proximidade durante a partida */
  updateVolumes(getDistance) {
    for (const [id, p] of this.peers) {
      const d = getDistance ? getDistance(id) : 0;
      const v = d === null || d === undefined ? 1 : Math.max(0.08, 1 - d / 22);
      p.audio.volume = Math.min(1, v * settings.voice);
    }
  }
}
