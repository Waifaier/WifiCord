// WifiCord — WebRTC 1:1 e chamadas de servidor com gerenciamento de estado,
// renegociação, ICE pendente, dispositivos, câmera e compartilhamento de tela.
(function () {
  'use strict';

  const RTC_CONFIG = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['stun:stun.services.mozilla.com'] }
    ],
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  };

  // O servidor expõe /api/webrtc/config com STUN + TURN (quando configurado
  // via env), mas nada aqui buscava esse endpoint: qualquer TURN_URLS
  // configurado pelo admin nunca era usado, e chamadas atrás de NAT/firewall
  // restritivo simplesmente falhavam em conectar. Busca uma vez e mescla no
  // RTC_CONFIG antes de qualquer chamada ser criada.
  let iceConfigPromise = null;
  async function loadIceConfig() {
    try {
      const res = await fetch('/api/webrtc/config', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.iceServers) && data.iceServers.length) {
        RTC_CONFIG.iceServers = data.iceServers;
      }
    } catch (_) { /* mantém o fallback de STUN público */ }
  }

  const state = {
    pc: null, localStream: null, screenStream: null,
    screenSender: null, systemAudioSender: null,
    targetUserId: null, callType: 'video', inCall: false,
    micEnabled: true, camEnabled: false, headphonesOff: false,
    pendingOffer: null, pendingCandidates: [], pendingGroupCandidates: [],
    makingOffer: false, ignoreOffer: false, polite: false,
    isSettingRemoteAnswerPending: false, reconnectTimer: null,
    reconnectAttempts: 0, lastConnectionState: 'new',
    localAudioCtx: null, remoteAudioCtx: null,
    speakingTimer: null, remoteSpeakingTimer: null,
    fullscreen: false, adminVoiceMutedUntil: 0,
    shareResolution: 720, shareType: 'screen', shareSystemAudio: false,
    groupMode: false, groupServerId: null, groupChannelId: null,
    groupType: 'audio', groupPeers: new Map(),
    qualityTimer: null,
    // Fica false enquanto a troca inicial de oferta/resposta (startCall ou
    // accept) ainda não terminou. Evita que o próprio navegador dispare
    // 'negotiationneeded' (por causa dos addTransceiver no pcCreate) e
    // mande uma OUTRA oferta em paralelo à oferta manual — essa oferta
    // duplicada chegava do lado de quem atende como se fosse um segundo
    // convite e derrubava a ligação (ver handleOffer/onnegotiationneeded).
    negotiationReady: false
  };

  const el = {};
  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------------
  // Volume individual por participante (0-100%, independente do volume
  // geral de saída). Guardado por usuário, sobrevive entre chamadas.
  // ---------------------------------------------------------------------
  const VOLUMES_KEY = 'wificord-call-user-volumes';
  let userVolumes = {};
  try { userVolumes = JSON.parse(localStorage.getItem(VOLUMES_KEY) || '{}') || {}; } catch (_) { userVolumes = {}; }

  function getUserVolume(id) {
    const v = Number(userVolumes[String(id)]);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
  }
  function setUserVolume(id, value) {
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    userVolumes[String(id)] = v;
    try { localStorage.setItem(VOLUMES_KEY, JSON.stringify(userVolumes)); } catch (_) {}
    return v;
  }
  // Combina o volume geral de saída (configurações) com o volume individual
  // deste participante — os dois são independentes, multiplicam entre si.
  function combinedVolume(id) {
    const globalPct = Number(appState()?.currentUser?.settings?.outputVolume ?? 100);
    const userPct = getUserVolume(id);
    return Math.max(0, Math.min(1, (globalPct / 100) * (userPct / 100)));
  }

  function cache() {
    Object.assign(el, {
      callBar: $('call-bar'), callStatus: $('call-connection-status'), remoteLabelTop: $('call-remote-label-top'),
      localVideo: $('local-video'), remoteVideo: $('remote-video'), remoteAudio: $('remote-audio'),
      remoteLabel: $('call-remote-label'), toggleMicBtn: $('call-toggle-mic'), toggleCamBtn: $('call-toggle-cam'),
      toggleScreenBtn: $('call-toggle-screen'), hangupBtn: $('call-hangup'),
      micMenuBtn: $('call-mic-menu'), camMenuBtn: $('call-cam-menu'),
      micDevices: $('call-mic-devices'), camDevices: $('call-cam-devices'),
      startVoiceBtn: $('start-voice-call-btn'), startVideoBtn: $('start-video-call-btn'),
      incomingModal: $('modal-incoming-call'), incomingText: $('incoming-call-text'), incomingAvatar: $('incoming-call-avatar'),
      acceptBtn: $('incoming-call-accept'), rejectBtn: $('incoming-call-reject'), callFullscreen: $('call-fullscreen'),
      localAvatar: $('call-local-avatar'), remoteAvatar: $('call-remote-avatar'),
      localSpeaking: $('call-local-speaking'), remoteSpeaking: $('call-remote-speaking'),
      screenStage: $('call-screen-stage'),
      miniDock: $('mini-call-dock'), miniMic: $('mini-call-mic'), miniCam: $('mini-call-cam'),
      miniScreen: $('mini-call-screen'), miniHeadphones: $('mini-call-headphones'), miniHangup: $('mini-call-hangup'),
      serverVoiceBtn: $('start-server-voice-call-btn'), serverVideoBtn: $('start-server-video-call-btn'),
      serverCallGrid: $('server-call-grid'), shareModal: $('modal-share-screen'),
      shareConfirm: $('share-screen-confirm'), shareSystemAudio: $('share-system-audio'),
      qualityDot: $('call-quality-dot'),
      remoteVolumeBtn: $('call-remote-volume-btn'), remoteVolumeMenu: $('call-remote-volume-menu'),
      remoteVolumeRange: $('call-remote-volume-range'), remoteVolumeValue: $('call-remote-volume-value')
    });
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function appState() { return window.App?.getState?.() || null; }
  function user(id) {
    const s = appState();
    if (!s) return null;
    if (String(id) === String(s.currentUser?.id)) return s.currentUser;
    return s.friends?.find(x => String(x.id) === String(id)) || null;
  }
  function groupUser(id) {
    const s = appState();
    if (String(id) === String(s?.currentUser?.id)) return s.currentUser;
    return s?.serverMembers?.find(x => String(x.id) === String(id)) || null;
  }
  function friendName(id) {
    const u = user(id);
    return u?.displayName || u?.username || 'Usuário';
  }
  function avatarMarkup(u) {
    if (!u) return '<div class="call-avatar-fallback">?</div>';
    return u.avatarUrl
      ? `<img src="${esc(u.avatarUrl)}" alt="" loading="eager" decoding="async">`
      : `<div class="call-avatar-fallback">${esc((u.displayName || u.username || '?')[0].toUpperCase())}</div>`;
  }

  function setCallStatus(text, tone = 'connecting') {
    if (el.callStatus) {
      el.callStatus.textContent = text;
      el.callStatus.dataset.state = tone;
    }
    el.callBar?.classList.toggle('call-reconnecting', tone === 'reconnecting');
  }

  function refreshParticipants() {
    const me = appState()?.currentUser;
    const other = user(state.targetUserId);
    if (el.localAvatar) {
      el.localAvatar.innerHTML = avatarMarkup(me);
      el.localAvatar.classList.toggle('speaking', !!state._localSpeaking);
    }
    if (el.remoteAvatar) {
      el.remoteAvatar.innerHTML = avatarMarkup(other);
      el.remoteAvatar.classList.toggle('speaking', !!state._remoteSpeaking);
    }
    if (el.remoteLabel) el.remoteLabel.textContent = friendName(state.targetUserId);
    if (el.remoteLabelTop) el.remoteLabelTop.textContent = friendName(state.targetUserId);
    syncVolumeUI();
  }

  // Mantém o slider de volume individual (topo da chamada 1:1) mostrando
  // o valor salvo pro participante atual, sem precisar abrir/fechar o popover.
  function syncVolumeUI() {
    const pct = getUserVolume(state.targetUserId);
    if (el.remoteVolumeRange) el.remoteVolumeRange.value = String(pct);
    if (el.remoteVolumeValue) el.remoteVolumeValue.textContent = pct + '%';
  }

  function updateButtons() {
    const s = appState();
    const dmReady = !!s?.activeDMUserId && !state.inCall;
    if (el.startVoiceBtn) {
      el.startVoiceBtn.disabled = !dmReady;
      el.startVoiceBtn.classList.toggle('call-unavailable', !dmReady);
    }
    if (el.startVideoBtn) {
      el.startVideoBtn.disabled = !dmReady;
      el.startVideoBtn.classList.toggle('call-unavailable', !dmReady);
    }
    const micOff = !state.micEnabled;
    const camOff = !state.camEnabled;
    el.toggleMicBtn?.classList.toggle('call-btn-off', micOff);
    el.toggleCamBtn?.classList.toggle('call-btn-off', camOff);
    el.toggleScreenBtn?.classList.toggle('call-btn-active', !!state.screenStream);
    if (el.toggleMicBtn) el.toggleMicBtn.setAttribute('aria-label', state.micEnabled ? 'Desativar microfone' : 'Ativar microfone');
    if (el.toggleCamBtn) el.toggleCamBtn.setAttribute('aria-label', state.camEnabled ? 'Desativar câmera' : 'Ativar câmera');
    if (el.toggleScreenBtn) el.toggleScreenBtn.setAttribute('aria-label', state.screenStream ? 'Parar compartilhamento' : 'Compartilhar tela');
  }

  function closeModals() {
    $('modal-overlay')?.classList.add('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  }

  function openBar() {
    el.callBar?.classList.remove('hidden');
    el.callBar?.classList.remove('sharing');
    $('call-live-label')?.classList.add('hidden');
    el.screenStage?.classList.add('hidden');
    refreshParticipants();
    updateButtons();
  }

  function syncContext() {
    const s = appState();
    const inTarget = !!state.inCall && !state.groupMode && !!s?.activeDMUserId && String(s.activeDMUserId) === String(state.targetUserId);
    const inGroup = !!state.inCall && state.groupMode && String(s?.activeServerId) === String(state.groupServerId) && String(s?.activeChannelId) === String(state.groupChannelId);
    el.callBar?.classList.toggle('hidden', !(inTarget || inGroup));
    el.miniDock?.classList.toggle('hidden', !state.inCall || inTarget || inGroup);
    updateButtons();
    if (inTarget) refreshParticipants();
    if (inGroup) renderGroupTiles();
  }

  function makeMediaConstraints(video) {
    const settings = window.Settings?.getMediaSettings?.() || {};
    const audio = settings.audioDeviceId
      ? { deviceId: { exact: settings.audioDeviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const videoConstraint = video
      ? (settings.videoDeviceId
        ? { deviceId: { exact: settings.videoDeviceId }, width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 60 } }
        : { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 60 } })
      : false;
    return { audio, video: videoConstraint };
  }

  async function getLocalStream(video) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('O navegador não disponibilizou câmera/microfone. Use HTTPS ou localhost em um navegador compatível.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(makeMediaConstraints(video));
      const audio = stream.getAudioTracks()[0];
      if (!audio) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error('Nenhuma faixa de microfone foi disponibilizada pelo navegador.');
      }
      audio.enabled = true;
      // Se o dispositivo for desconectado fisicamente no meio da chamada
      // (cabo do microfone/webcam puxado, dispositivo desligado), o
      // navegador encerra a track sozinho — sem isso, a chamada ficava
      // "muda"/sem câmera sem nenhum aviso visual do que aconteceu.
      audio.onended = () => {
        if (!state.inCall) return;
        state.micEnabled = false;
        updateButtons();
        window.App?.toast('O microfone foi desconectado.', 'error');
      };
      stream.getVideoTracks().forEach(t => {
        t.enabled = video;
        t.onended = () => {
          if (!state.inCall || !state.camEnabled) return;
          state.camEnabled = false;
          updateButtons();
          ensureVideoPreview();
          window.App?.toast('A câmera foi desconectada.', 'error');
        };
      });
      return stream;
    } catch (e) {
      if (e.name === 'NotAllowedError') throw new Error('Permita o microfone e a câmera nas permissões do navegador.');
      if (e.name === 'NotFoundError') throw new Error(video ? 'Microfone ou câmera não encontrados.' : 'Microfone não encontrado.');
      if (e.name === 'NotReadableError') throw new Error('O dispositivo está ocupado por outro aplicativo.');
      if (e.name === 'OverconstrainedError') throw new Error('O dispositivo selecionado não aceita essa configuração. Escolha outro dispositivo.');
      throw e;
    }
  }

  function ensureVideoPreview() {
    if (!el.localVideo) return;
    el.localVideo.srcObject = state.localStream || null;
    el.localVideo.muted = true;
    el.localVideo.autoplay = true;
    el.localVideo.playsInline = true;
    if (state.screenStream) return;
    el.localVideo.classList.toggle('hidden', !state.camEnabled);
    el.localVideo.play?.().catch(() => {});
  }

  function attachRemoteStream(stream) {
    if (!el.remoteVideo) return;
    el.remoteVideo.srcObject = stream;
    el.remoteVideo.autoplay = true;
    el.remoteVideo.playsInline = true;
    el.remoteVideo.classList.remove('hidden');
    el.remoteVideo.play?.().catch(() => {});
    requestAnimationFrame(() => el.remoteVideo?.play?.().catch(() => {}));
  }

  function attachRemoteAudio(stream) {
    if (!el.remoteAudio) return;
    el.remoteAudio.srcObject = stream;
    el.remoteAudio.autoplay = true;
    el.remoteAudio.playsInline = true;
    el.remoteAudio.muted = state.headphonesOff;
    el.remoteAudio.volume = combinedVolume(state.targetUserId);
    window.Settings?.applyOutput?.(el.remoteAudio);
    const play = () => el.remoteAudio?.play?.().catch(() => {});
    play();
    setTimeout(play, 100);
    setTimeout(play, 500);
  }

  function addRemoteTrack(track, remoteStream, isRemoteVideo) {
    if (!remoteStream.getTracks().some(t => t.id === track.id)) remoteStream.addTrack(track);
    if (isRemoteVideo) attachRemoteStream(remoteStream);
    else attachRemoteAudio(remoteStream);
  }

  function pcCreate(polite = false) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    state.polite = polite;
    state.ignoreOffer = false;

    let audioSender = null;
    let videoSender = null;
    let systemAudioSender = null;
    try { audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender; } catch (_) {}
    try { videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender; } catch (_) {}
    try { systemAudioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender; } catch (_) {}
    pc._wifiAudioSender = audioSender;
    pc._wifiVideoSender = videoSender;
    pc._wifiSystemAudioSender = systemAudioSender;

    pc.onicecandidate = e => {
      if (e.candidate && state.targetUserId) {
        window.ChatSocket?.sendCallIceCandidate?.({ toUserId: state.targetUserId, candidate: e.candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      const ice = pc.iceConnectionState;
      if (ice === 'checking') setCallStatus('Conectando mídia…', 'connecting');
      if (ice === 'connected' || ice === 'completed') {
        state.reconnectAttempts = 0;
        setCallStatus('Conectado', 'connected');
      }
      if (ice === 'disconnected') scheduleReconnect(pc);
      if (ice === 'failed') scheduleReconnect(pc, true);
    };

    pc.onconnectionstatechange = () => {
      const connection = pc.connectionState;
      state.lastConnectionState = connection;
      if (connection === 'connecting') setCallStatus('Conectando…', 'connecting');
      if (connection === 'connected') {
        state.reconnectAttempts = 0;
        setCallStatus('Conectado', 'connected');
        window.Sounds?.play('call-join');
        startQualityMonitor(pc);
      }
      if (connection === 'disconnected') { scheduleReconnect(pc); setQuality('unknown'); }
      if (connection === 'failed') { scheduleReconnect(pc, true); stopQualityMonitor(); }
      if (connection === 'closed') stopQualityMonitor();
    };

    pc.ontrack = e => {
      const track = e.track;
      const stream = e.streams?.[0] instanceof MediaStream ? e.streams[0] : new MediaStream([track]);
      if (track.kind === 'video') {
        el.callBar?.classList.remove('audio-call');
        el.callBar?.classList.add('has-remote-video', 'has-remote');
        addRemoteTrack(track, stream, true);
        track.onended = () => {
          if (!state.screenStream) {
            el.callBar?.classList.remove('has-remote-video');
            if (state.callType === 'audio') el.callBar?.classList.add('audio-call');
          }
        };
      } else {
        el.callBar?.classList.add('has-remote');
        addRemoteTrack(track, stream, false);
        startRemoteSpeaking(stream);
      }
      refreshParticipants();
    };

    pc.onnegotiationneeded = async () => {
      if (!state.negotiationReady) return; // troca inicial ainda em andamento — ver comentário no state
      if (!state.inCall || state.groupMode || state.pc !== pc) return;
      if (state.makingOffer) return;
      try { await negotiate(false); } catch (e) { console.error('Renegociação WebRTC:', e); }
    };

    return pc;
  }

  // Backoff crescente entre tentativas de reconexão (em ms). "disconnected"
  // costuma ser uma oscilação passageira de rede (wifi instável, troca de
  // rede no celular) — vale insistir bastante antes de desistir, em vez de
  // declarar "conexão perdida" depois de só 2 tentativas rápidas.
  const RECONNECT_DELAYS = [1500, 3000, 5000, 8000, 13000, 20000];
  const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS.length;

  function scheduleReconnect(pc, forceIceRestart = false) {
    if (!state.inCall || state.pc !== pc || state.reconnectTimer) return;
    setCallStatus('Reconectando…', 'reconnecting');
    setQuality('unknown');
    const delay = RECONNECT_DELAYS[Math.min(state.reconnectAttempts, RECONNECT_DELAYS.length - 1)];
    state.reconnectTimer = setTimeout(async () => {
      state.reconnectTimer = null;
      if (!state.inCall || state.pc !== pc) return;
      if (pc.connectionState === 'connected') return;
      if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        setCallStatus('Conexão perdida', 'failed');
        window.App?.toast('A conexão da chamada foi perdida. Tente ligar novamente.', 'error');
        // Encerra de vez (e avisa o outro lado) em vez de deixar state.inCall
        // travado em true para sempre — isso deixava o usuário "preso" numa
        // chamada morta (sem poder ligar pra outra pessoa) e, pior, o outro
        // lado continuava recebendo ofertas de reconexão para uma chamada
        // que já não existia mais aqui.
        endCall(true);
        return;
      }
      state.reconnectAttempts += 1;
      try {
        if (forceIceRestart || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          await negotiate(true);
        }
      } catch (e) { console.error('ICE restart:', e); }
      // Ainda não voltou: agenda a próxima tentativa (com o próximo passo
      // do backoff), em vez de ficar parado esperando um evento que talvez
      // não venha (ex.: rede trocou de wifi pra 4G sem disparar 'failed').
      if (state.inCall && state.pc === pc && pc.connectionState !== 'connected') {
        scheduleReconnect(pc, false);
      }
    }, delay);
  }

  // ---------------------------------------------------------------------
  // Indicador de qualidade da chamada (bolinha verde/amarela/vermelha perto
  // do status "Conectado"), baseado em RTT e perda de pacotes via
  // RTCPeerConnection.getStats(). Cobre "falta feedback visual de
  // qualidade/conexão".
  // ---------------------------------------------------------------------
  function setQuality(level) {
    if (el.qualityDot) el.qualityDot.dataset.quality = level;
  }

  function startQualityMonitor(pc) {
    stopQualityMonitor();
    state.qualityTimer = setInterval(async () => {
      if (!state.inCall || state.pc !== pc || pc.connectionState !== 'connected') return;
      try {
        const stats = await pc.getStats();
        let rttMs = null, lossRatio = 0, packetsTotal = 0, packetsLost = 0;
        stats.forEach(r => {
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) {
            if (Number.isFinite(r.currentRoundTripTime)) rttMs = r.currentRoundTripTime * 1000;
          }
          if (r.type === 'inbound-rtp' && !r.isRemote && (r.kind === 'audio' || r.mediaType === 'audio')) {
            packetsLost += Number(r.packetsLost) || 0;
            packetsTotal += (Number(r.packetsLost) || 0) + (Number(r.packetsReceived) || 0);
          }
        });
        if (packetsTotal > 0) lossRatio = packetsLost / packetsTotal;
        let level = 'good';
        if ((rttMs != null && rttMs > 350) || lossRatio > 0.08) level = 'poor';
        else if ((rttMs != null && rttMs > 150) || lossRatio > 0.02) level = 'ok';
        setQuality(level);
      } catch (_) { /* getStats indisponível/instável: mantém o último valor */ }
    }, 4000);
  }

  function stopQualityMonitor() {
    clearInterval(state.qualityTimer);
    state.qualityTimer = null;
    setQuality('unknown');
  }

  async function flushCandidates(pc = state.pc) {
    if (!pc?.remoteDescription) return;
    const queue = state.pendingCandidates.splice(0);
    for (const candidate of queue) {
      try { await pc.addIceCandidate(candidate); } catch (e) { console.warn('ICE pendente rejeitado:', e); }
    }
  }

  async function negotiate(iceRestart = false) {
    const pc = state.pc;
    if (!pc || !state.inCall || state.groupMode || !state.targetUserId) return;
    if (state.makingOffer) return;
    if (pc.signalingState !== 'stable' && !iceRestart) return;
    state.makingOffer = true;
    try {
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await pc.setLocalDescription(offer);
      window.ChatSocket?.sendCallOffer?.({
        toUserId: state.targetUserId,
        sdp: pc.localDescription,
        callType: state.callType,
        renegotiation: true,
        iceRestart: !!iceRestart
      });
    } finally {
      state.makingOffer = false;
    }
  }

  async function prepare(target, type, polite = false) {
    await (iceConfigPromise || loadIceConfig());
    state.targetUserId = target;
    state.callType = type === 'audio' ? 'audio' : 'video';
    state.polite = polite;
    state.localStream = await getLocalStream(state.callType === 'video');
    state.inCall = true;
    state.micEnabled = true;
    state.camEnabled = state.callType === 'video';
    state.pc = pcCreate(polite);

    const audioTrack = state.localStream.getAudioTracks()[0];
    const videoTrack = state.localStream.getVideoTracks()[0];
    if (state.pc._wifiAudioSender) await state.pc._wifiAudioSender.replaceTrack(audioTrack || null);
    if (state.pc._wifiVideoSender) await state.pc._wifiVideoSender.replaceTrack(videoTrack || null);

    el.callBar?.classList.toggle('audio-call', state.callType === 'audio');
    openBar();
    ensureVideoPreview();
    setCallStatus('Conectando…', 'connecting');
    startLocalSpeaking();
    window.Settings?.refreshDevices?.();
  }

  async function startCall(target, type) {
    if (!target) return window.App?.toast('Selecione um amigo para ligar.', 'error');
    if (state.inCall || state.pendingOffer) return;
    try {
      await prepare(target, type, false);
      const offer = await state.pc.createOffer();
      await state.pc.setLocalDescription(offer);
      window.ChatSocket?.sendCallOffer?.({ toUserId: target, sdp: state.pc.localDescription, callType: type, renegotiation: false });
      state.negotiationReady = true;
    } catch (e) {
      window.App?.toast(e.message || 'Não foi possível iniciar a chamada.', 'error');
      endCall(false);
    }
  }

  function handleOffer(data) {
    if (!data?.fromUserId || !data.sdp) return;
    if (state.inCall && state.targetUserId && String(state.targetUserId) === String(data.fromUserId)) {
      handleRenegotiate(data).catch(console.error);
      return;
    }
    // Oferta de renegociação/ICE-restart (ver negotiate()/scheduleReconnect)
    // chegando para uma chamada da qual já não fazemos mais parte: é uma
    // tentativa "zumbi" de reconexão do outro lado, não uma ligação nova.
    // Tratar como convite novo fazia essa oferta reaparecer como "fulano
    // está te ligando" repetidamente (em loop) depois que a chamada já
    // tinha terminado do nosso lado.
    if (data.renegotiation && !state.inCall) {
      window.ChatSocket?.sendCallHangup?.({ toUserId: data.fromUserId });
      return;
    }
    if (state.inCall || state.pendingOffer) {
      // Oferta duplicada do mesmo chamador que já está esperando resposta
      // (ex.: corrida entre a oferta manual e um 'negotiationneeded'
      // automático) — só atualiza o convite pendente em vez de derrubar a
      // ligação que está prestes a ser atendida.
      if (!state.inCall && state.pendingOffer && !data.renegotiation && String(state.pendingOffer.fromUserId) === String(data.fromUserId)) {
        state.pendingOffer = data;
        return;
      }
      window.ChatSocket?.sendCallHangup?.({ toUserId: data.fromUserId });
      return;
    }
    state.pendingOffer = data;
    window.Sounds?.play('call-incoming');
    if (el.incomingText) el.incomingText.textContent = `${friendName(data.fromUserId)} está te ligando (${data.callType === 'audio' ? 'voz' : 'vídeo'}).`;
    if (el.incomingAvatar) el.incomingAvatar.innerHTML = avatarMarkup(user(data.fromUserId));
    $('modal-overlay')?.classList.remove('hidden');
    el.incomingModal?.classList.remove('hidden');
  }

  async function handleRenegotiate(data) {
    const pc = state.pc;
    if (!pc || !state.inCall) return;
    const offerCollision = state.makingOffer || pc.signalingState !== 'stable';
    state.ignoreOffer = !state.polite && offerCollision;
    if (state.ignoreOffer) return;
    try {
      if (offerCollision && state.polite) await pc.setLocalDescription({ type: 'rollback' });
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      await flushCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      window.ChatSocket?.sendCallAnswer?.({ toUserId: data.fromUserId, sdp: pc.localDescription, renegotiation: true });
    } catch (e) {
      console.error('Falha na renegociação:', e);
      setCallStatus('Erro na renegociação', 'failed');
    }
  }

  async function accept() {
    const d = state.pendingOffer;
    if (!d) return;
    closeModals();
    try {
      await prepare(d.fromUserId, d.callType || 'video', true);
      await state.pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
      await flushCandidates(state.pc);
      const answer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(answer);
      window.ChatSocket?.sendCallAnswer?.({ toUserId: d.fromUserId, sdp: state.pc.localDescription, renegotiation: false });
      state.pendingOffer = null;
      state.negotiationReady = true;
    } catch (e) {
      window.App?.toast(e.message || 'Não foi possível atender.', 'error');
      state.pendingOffer = null;
      endCall(true);
    }
  }

  function reject() {
    if (state.pendingOffer) window.ChatSocket?.sendCallHangup?.({ toUserId: state.pendingOffer.fromUserId });
    state.pendingOffer = null;
    closeModals();
    window.Sounds?.play('call-leave');
  }

  async function answer(data) {
    if (!state.pc || !data?.sdp) return;
    try {
      state.isSettingRemoteAnswerPending = true;
      await state.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      state.isSettingRemoteAnswerPending = false;
      await flushCandidates(state.pc);
      setCallStatus('Conectado', 'connected');
    } catch (e) {
      state.isSettingRemoteAnswerPending = false;
      console.error('Resposta WebRTC inválida:', e);
    }
  }

  async function ice(data) {
    if (!data?.candidate) return;
    const expected = state.targetUserId || state.pendingOffer?.fromUserId;
    if (!expected || String(data.fromUserId) !== String(expected)) return;
    if (!state.pc?.remoteDescription) {
      state.pendingCandidates.push(data.candidate);
      return;
    }
    try { await state.pc.addIceCandidate(data.candidate); } catch (e) { if (!state.ignoreOffer) console.warn('ICE:', e); }
  }

  function cleanupMediaElement(video) {
    if (!video) return;
    try { video.pause(); } catch (_) {}
    video.srcObject = null;
  }

  function endCall(notify) {
    if (state.groupMode) {
      window.ChatSocket?.leaveServerCall?.({ serverId: state.groupServerId, channelId: state.groupChannelId });
      for (const id of [...state.groupPeers.keys()]) removeGroupPeer(id);
      state.groupPeers.clear();
      state.groupMode = false;
      state.groupServerId = null;
      state.groupChannelId = null;
    }
    const target = state.targetUserId;
    if (notify && target) window.ChatSocket?.sendCallHangup?.({ toUserId: target });
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    stopQualityMonitor();
    // Marca o fim da chamada ANTES de parar as tracks: em teoria .stop()
    // não deveria disparar 'onended' (só o navegador desconectando o
    // dispositivo deveria), mas isso varia entre navegadores/webviews — e
    // os handlers de onended em getLocalStream() só se protegem checando
    // state.inCall. Ficar defensivo aqui custa nada.
    state.inCall = false;
    try { state.pc?.close(); } catch (_) {}
    state.localStream?.getTracks().forEach(t => t.stop());
    state.screenStream?.getTracks().forEach(t => t.stop());
    if (state.localAudioCtx) state.localAudioCtx.close().catch(() => {});
    if (state.remoteAudioCtx) state.remoteAudioCtx.close().catch(() => {});
    clearInterval(state.speakingTimer);
    clearInterval(state.remoteSpeakingTimer);
    state.pc = null; state.localStream = null; state.screenStream = null;
    state.screenSender = null; state.systemAudioSender = null;
    state.pendingCandidates = []; state.targetUserId = null; state.pendingOffer = null;
    state.micEnabled = true; state.camEnabled = false;
    state.adminVoiceMutedUntil = 0; state._localSpeaking = false; state._remoteSpeaking = false;
    state.reconnectAttempts = 0; state.makingOffer = false; state.ignoreOffer = false;
    state.negotiationReady = false;
    cleanupMediaElement(el.localVideo); cleanupMediaElement(el.remoteVideo);
    if (el.remoteAudio) { el.remoteAudio.pause?.(); el.remoteAudio.srcObject = null; }
    el.callBar?.classList.remove('audio-call', 'sharing', 'has-remote', 'has-remote-video', 'call-reconnecting');
    el.callBar?.classList.add('hidden');
    closeModals(); updateButtons();
    window.Sounds?.play('call-leave');
  }

  function toggleMic() {
    if (!state.localStream) return;
    if (state.adminVoiceMutedUntil === -1 || state.adminVoiceMutedUntil > Date.now()) {
      return window.App?.toast('Seu microfone está bloqueado pelo administrador.', 'error');
    }
    state.micEnabled = !state.micEnabled;
    state.localStream.getAudioTracks().forEach(t => { t.enabled = state.micEnabled; });
    updateButtons();
  }

  async function toggleCam() {
    if (!state.inCall || !state.localStream) return;
    try {
      let track = state.localStream.getVideoTracks()[0];
      if (!track) {
        const fresh = await navigator.mediaDevices.getUserMedia({ video: makeMediaConstraints(true).video, audio: false });
        track = fresh.getVideoTracks()[0];
        state.localStream.addTrack(track);
        if (state.groupMode) {
          for (const p of state.groupPeers.values()) {
            const sender = p.pc._wifiVideoSender || p.pc.getSenders().find(s => s.track?.kind === 'video');
            if (sender) await sender.replaceTrack(track);
          }
        } else if (state.pc) {
          const sender = state.pc._wifiVideoSender || state.pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(track);
        }
      }
      state.camEnabled = !state.camEnabled;
      track.enabled = state.camEnabled;
      ensureVideoPreview();
      if (!state.groupMode && state.pc) await negotiate(false);
      updateButtons();
    } catch (e) {
      window.App?.toast(e.message || 'Não foi possível ligar a câmera.', 'error');
    }
  }

  async function switchDevice(kind, id) {
    if (!state.inCall || !state.localStream || !id) return;
    const isAudio = kind === 'audioinput';
    const constraints = isAudio
      ? { audio: { deviceId: { exact: id }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }
      : { audio: false, video: { deviceId: { exact: id }, width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 60 } } };
    const fresh = await navigator.mediaDevices.getUserMedia(constraints);
    const track = isAudio ? fresh.getAudioTracks()[0] : fresh.getVideoTracks()[0];
    if (!track) throw new Error('O dispositivo não forneceu uma faixa utilizável.');
    const old = isAudio ? state.localStream.getAudioTracks()[0] : state.localStream.getVideoTracks()[0];
    track.enabled = isAudio ? state.micEnabled : state.camEnabled;

    if (state.groupMode) {
      for (const p of state.groupPeers.values()) {
        const sender = isAudio ? p.pc._wifiAudioSender : p.pc._wifiVideoSender;
        if (sender) await sender.replaceTrack(track);
      }
    } else if (state.pc) {
      const sender = isAudio ? state.pc._wifiAudioSender : state.pc._wifiVideoSender;
      if (sender) await sender.replaceTrack(track);
    }
    if (old) old.stop();
    if (isAudio) state.localStream.removeTrack(old); else if (old) state.localStream.removeTrack(old);
    state.localStream.addTrack(track);
    if (!isAudio && !state.screenStream) ensureVideoPreview();
    const settings = window.Settings?.getMediaSettings?.() || {};
    if (isAudio) settings.audioDeviceId = id; else settings.videoDeviceId = id;
    localStorage.setItem('wificord-media-settings', JSON.stringify(settings));
    window.App?.toast('Dispositivo alterado.', 'success');
  }

  async function deviceMenu(kind) {
    const box = kind === 'audioinput' ? el.micDevices : el.camDevices;
    const other = kind === 'audioinput' ? el.camDevices : el.micDevices;
    if (!box) return;
    other?.classList.add('hidden');
    box.innerHTML = '<button disabled>Carregando…</button>';
    box.classList.remove('hidden');
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      box.innerHTML = '';
      devices.filter(d => d.kind === kind).forEach((d, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = d.label || `${kind === 'audioinput' ? 'Microfone' : 'Câmera'} ${i + 1}`;
        b.addEventListener('click', async () => {
          try { await switchDevice(kind, d.deviceId); } catch (e) { window.App?.toast(e.message || 'Não foi possível trocar o dispositivo.', 'error'); }
          box.classList.add('hidden');
        });
        box.appendChild(b);
      });
    } catch (_) { box.classList.add('hidden'); }
  }

  async function screenShare() {
    if (!state.inCall) return;
    if (state.screenStream) return stopScreen();
    const modal = el.shareModal;
    if (!modal) return startScreenShareWithQuality(720, 'screen', false);
    $('modal-overlay')?.classList.remove('hidden');
    modal.classList.remove('hidden');
    let selected = state.shareResolution || 720;
    if (!appState()?.currentUser?.wfna) selected = 720;
    modal.querySelectorAll('[data-resolution]').forEach(b => {
      const q = Number(b.dataset.resolution);
      const locked = q > 720 && !appState()?.currentUser?.wfna;
      b.classList.toggle('locked', locked);
      b.classList.toggle('active', q === selected);
      b.onclick = () => {
        if (locked) return window.App?.toast('Essa resolução exige WFNA.', 'error');
        selected = q;
        modal.querySelectorAll('[data-resolution]').forEach(x => x.classList.toggle('active', Number(x.dataset.resolution) === q));
      };
    });
    modal.querySelectorAll('[data-share-tab]').forEach(b => b.onclick = () => {
      modal.querySelectorAll('[data-share-tab]').forEach(x => x.classList.toggle('active', x === b));
      modal.querySelectorAll('[data-share-pane]').forEach(x => x.classList.toggle('active', x.dataset.sharePane === b.dataset.shareTab));
      state.shareType = b.dataset.shareTab;
    });
    if (el.shareConfirm) el.shareConfirm.onclick = async () => {
      const type = state.shareType || 'screen';
      const systemAudio = !!el.shareSystemAudio?.checked;
      closeShareModal();
      await startScreenShareWithQuality(selected, type, systemAudio);
    };
  }

  function closeShareModal() {
    el.shareModal?.classList.add('hidden');
    $('modal-overlay')?.classList.add('hidden');
  }

  async function startScreenShareWithQuality(resolution, type, systemAudio) {
    try {
      const wfna = !!appState()?.currentUser?.wfna;
      resolution = wfna ? Number(resolution) || 1080 : Math.min(720, Number(resolution) || 720);
      const height = resolution;
      const width = Math.round(height * 16 / 9);
      const video = { frameRate: { ideal: 30, max: 60 }, cursor: 'motion', width: { ideal: width, max: width }, height: { ideal: height, max: height }, displaySurface: type };
      const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: systemAudio });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('Nenhuma faixa de tela foi fornecida.');
      track.contentHint = 'detail';
      state.screenStream = stream;
      state.shareSystemAudio = systemAudio;

      if (state.groupMode) {
        for (const p of state.groupPeers.values()) {
          const sender = p.pc._wifiVideoSender || p.pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(track);
          const sys = stream.getAudioTracks()[0];
          if (sys && p.pc._wifiSystemAudioSender) await p.pc._wifiSystemAudioSender.replaceTrack(sys);
        }
      } else {
        const sender = state.pc?._wifiVideoSender || state.pc?.getSenders().find(s => s.track?.kind === 'video');
        if (!sender) throw new Error('A conexão não possui transceptor de vídeo.');
        await sender.replaceTrack(track);
        state.screenSender = sender;
        const sys = stream.getAudioTracks()[0];
        if (sys && state.pc?._wifiSystemAudioSender) {
          await state.pc._wifiSystemAudioSender.replaceTrack(sys);
          state.systemAudioSender = state.pc._wifiSystemAudioSender;
        }
        await negotiate(false);
      }

      el.callBar?.classList.remove('audio-call');
      el.callBar?.classList.add('sharing');
      $('call-live-label')?.classList.remove('hidden');
      if ($('call-live-label')) $('call-live-label').innerHTML = '🔴 APRESENTANDO <span id="call-remote-label">' + esc(friendName(state.targetUserId)) + '</span>';
      if (el.localVideo) {
        el.localVideo.srcObject = stream;
        el.localVideo.classList.add('is-screen-preview');
        el.localVideo.classList.remove('hidden');
        el.localVideo.muted = true;
        el.localVideo.play?.().catch(() => {});
      }
      updateButtons();
      window.Sounds?.play('screen-start');
      track.onended = () => { stopScreen().catch(console.error); };
    } catch (e) {
      if (!['AbortError', 'NotAllowedError'].includes(e.name)) window.App?.toast('Não foi possível compartilhar a tela: ' + (e.message || 'erro desconhecido'), 'error');
    }
  }

  async function stopScreen() {
    const stream = state.screenStream;
    if (!stream) return;
    stream.getTracks().forEach(t => t.stop());
    state.screenStream = null;
    const camera = state.localStream?.getVideoTracks()?.[0] || null;

    if (state.groupMode) {
      for (const p of state.groupPeers.values()) {
        const sender = p.pc._wifiVideoSender || p.pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(camera || null);
        if (p.pc._wifiSystemAudioSender) await p.pc._wifiSystemAudioSender.replaceTrack(null);
      }
    } else if (state.pc) {
      if (state.screenSender) await state.screenSender.replaceTrack(camera || null);
      if (state.systemAudioSender) await state.systemAudioSender.replaceTrack(null);
      state.screenSender = null;
      state.systemAudioSender = null;
      await negotiate(false);
    }

    if (el.localVideo) {
      el.localVideo.classList.remove('is-screen-preview');
      ensureVideoPreview();
    }
    el.callBar?.classList.remove('sharing');
    $('call-live-label')?.classList.add('hidden');
    if (state.callType === 'audio' && !el.callBar?.classList.contains('has-remote-video')) el.callBar?.classList.add('audio-call');
    updateButtons();
    window.Sounds?.play('screen-stop');
  }

  async function fullscreen() {
    if (!el.callBar) return;
    try {
      if (!document.fullscreenElement) await el.callBar.requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) { window.App?.toast('Tela cheia não está disponível neste navegador.', 'error'); }
  }

  function startLocalSpeaking() {
    clearInterval(state.speakingTimer);
    if (!state.localStream) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(state.localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let last = false;
      state.localAudioCtx = ctx;
      ctx.resume?.().catch(() => {});
      state.speakingTimer = setInterval(() => {
        if (!state.micEnabled) { state._localSpeaking = false; refreshParticipants(); return; }
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const x of data) { const n = (x - 128) / 128; sum += n * n; }
        const speaking = Math.sqrt(sum / data.length) > 0.045;
        if (speaking !== last) {
          last = speaking;
          state._localSpeaking = speaking;
          refreshParticipants();
          if (state.targetUserId) window.ChatSocket?.socket?.emit('call:speaking', { toUserId: state.targetUserId, speaking });
        }
      }, 120);
    } catch (_) {}
  }

  function startRemoteSpeaking(stream) {
    clearInterval(state.remoteSpeakingTimer);
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      state.remoteAudioCtx = ctx;
      ctx.resume?.().catch(() => {});
      state.remoteSpeakingTimer = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const x of data) { const n = (x - 128) / 128; sum += n * n; }
        const speaking = Math.sqrt(sum / data.length) > 0.045;
        if (speaking !== state._remoteSpeaking) { state._remoteSpeaking = speaking; refreshParticipants(); }
      }, 120);
    } catch (_) {}
  }

  function remoteSpeaking(data) {
    if (String(data?.fromUserId) !== String(state.targetUserId)) return;
    state._remoteSpeaking = !!data.speaking;
    refreshParticipants();
  }

  function applyAdminVoiceMute(data) {
    state.adminVoiceMutedUntil = Number(data?.until || 0);
    if (state.localStream) {
      state.micEnabled = false;
      state.localStream.getAudioTracks().forEach(t => { t.enabled = false; });
    }
    updateButtons();
    window.App?.toast('Seu microfone foi bloqueado pelo administrador.', 'error');
  }
  function endFromAdmin() { endCall(false); window.App?.toast('A chamada foi encerrada por um administrador.', 'error'); }

  function renderGroupTiles() {
    if (!el.serverCallGrid) return;
    el.serverCallGrid.classList.toggle('hidden', !state.groupMode);
    if (!state.groupMode) return;
    el.serverCallGrid.innerHTML = '';
    for (const [id, peer] of state.groupPeers) {
      const u = groupUser(id) || {};
      const tile = document.createElement('div');
      tile.className = 'server-call-tile';
      tile.dataset.userId = id;
      const vol = getUserVolume(id);
      tile.innerHTML = `<div class="server-call-tile-head"><b>${esc(u.displayName || u.username || 'Usuário')}</b><span class="server-call-tile-state">Conectando</span></div><video autoplay playsinline></video><div class="server-call-tile-avatar">${avatarMarkup(u)}</div><div class="server-call-tile-volume-wrap" title="Volume de ${esc(u.displayName || u.username || 'Usuário')}"><span class="server-call-tile-volume-icon">🔊</span><input type="range" class="server-call-tile-volume" min="0" max="100" value="${vol}" aria-label="Volume de ${esc(u.displayName || u.username || 'Usuário')}"></div>`;
      const video = tile.querySelector('video');
      if (peer.video) { video.srcObject = peer.video; video.classList.remove('hidden'); video.play?.().catch(() => {}); }
      else video.classList.add('hidden');
      el.serverCallGrid.appendChild(tile);
    }
  }

  // Um único listener delegado no grid inteiro, em vez de um por slider —
  // sobrevive ao innerHTML='' que renderGroupTiles faz a cada participante
  // que entra/sai.
  function bindGroupVolumeControl() {
    el.serverCallGrid?.addEventListener('input', e => {
      const input = e.target.closest('.server-call-tile-volume');
      if (!input) return;
      const tile = input.closest('.server-call-tile');
      const id = tile?.dataset.userId;
      if (!id) return;
      setUserVolume(id, input.value);
      const peer = groupPeerPc(id);
      const combined = combinedVolume(id);
      peer?.audioStreams?.forEach(a => { a.volume = combined; });
    });
  }

  function groupPeerPc(id) { return state.groupPeers.get(String(id)); }

  function createGroupPeer(peerId, initiator) {
    const id = String(peerId);
    if (groupPeerPc(id)) return groupPeerPc(id);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const peer = { pc, video: null, audioStreams: [], pending: [], makingOffer: false, reconnectTimer: null, reconnectAttempts: 0 };
    try { pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch (_) {}
    try { pc.addTransceiver('video', { direction: 'sendrecv' }); } catch (_) {}
    try { pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch (_) {}
    pc._wifiAudioSender = pc.getTransceivers().find(t => t.receiver?.track?.kind === 'audio')?.sender;
    pc._wifiVideoSender = pc.getTransceivers().find(t => t.receiver?.track?.kind === 'video')?.sender;
    pc._wifiSystemAudioSender = pc.getTransceivers().filter(t => t.receiver?.track?.kind === 'audio')[1]?.sender;
    state.groupPeers.set(id, peer);

    const audio = state.localStream?.getAudioTracks()[0];
    const video = state.localStream?.getVideoTracks()[0];
    if (pc._wifiAudioSender) pc._wifiAudioSender.replaceTrack(audio || null).catch(() => {});
    if (pc._wifiVideoSender) pc._wifiVideoSender.replaceTrack(video || null).catch(() => {});

    pc.onicecandidate = e => {
      if (e.candidate) window.ChatSocket?.sendServerCallIce?.({ toUserId: Number(id), serverId: state.groupServerId, channelId: state.groupChannelId, candidate: e.candidate });
    };
    pc.ontrack = e => {
      if (e.track.kind === 'video') {
        if (!(peer.video instanceof MediaStream)) peer.video = new MediaStream();
        if (!peer.video.getTracks().some(t => t.id === e.track.id)) peer.video.addTrack(e.track);
        renderGroupTiles();
      } else {
        const stream = e.streams?.[0] instanceof MediaStream ? e.streams[0] : new MediaStream([e.track]);
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true; audioEl.playsInline = true; audioEl.srcObject = stream;
        audioEl.volume = combinedVolume(id);
        audioEl.muted = state.headphonesOff;
        audioEl.dataset.callPeer = id;
        document.body.appendChild(audioEl); peer.audioStreams.push(audioEl); audioEl.play?.().catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      const tile = el.serverCallGrid?.querySelector(`[data-user-id="${CSS.escape(id)}"] .server-call-tile-state`);
      if (tile) tile.textContent = st === 'connected' ? 'Conectado' : st === 'connecting' ? 'Conectando' : (st === 'disconnected' || st === 'failed') ? 'Reconectando' : 'Conectando';
      if (st === 'connected') { peer.reconnectAttempts = 0; clearTimeout(peer.reconnectTimer); peer.reconnectTimer = null; }
      // "disconnected" costuma ser passageiro (oscilação de rede) — tenta
      // reconectar em vez de derrubar o participante da chamada na hora,
      // igual já é feito na chamada 1:1 (ver scheduleReconnect).
      if (st === 'disconnected') scheduleGroupReconnect(id, peer, false);
      if (st === 'failed') scheduleGroupReconnect(id, peer, true);
      if (st === 'closed') removeGroupPeer(id);
    };

    if (initiator) {
      pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => window.ChatSocket?.sendServerCallOffer?.({ toUserId: Number(id), serverId: state.groupServerId, channelId: state.groupChannelId, callType: state.groupType, sdp: pc.localDescription })).catch(console.error);
    }
    return peer;
  }

  // Mesma ideia de backoff crescente do scheduleReconnect (chamada 1:1),
  // aplicada por participante da chamada de servidor: cada peer tenta se
  // reconectar sozinho antes de ser removido da grade de vídeo.
  function scheduleGroupReconnect(id, peer, forceIceRestart) {
    if (!state.groupMode || !state.groupPeers.has(id) || peer.reconnectTimer) return;
    const delay = RECONNECT_DELAYS[Math.min(peer.reconnectAttempts, RECONNECT_DELAYS.length - 1)];
    peer.reconnectTimer = setTimeout(async () => {
      peer.reconnectTimer = null;
      if (!state.groupMode || !state.groupPeers.has(id)) return;
      if (peer.pc.connectionState === 'connected') { peer.reconnectAttempts = 0; return; }
      if (peer.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        removeGroupPeer(id);
        return;
      }
      peer.reconnectAttempts += 1;
      try {
        if (forceIceRestart || peer.pc.connectionState === 'failed' || peer.pc.connectionState === 'disconnected') {
          const offer = await peer.pc.createOffer({ iceRestart: true });
          await peer.pc.setLocalDescription(offer);
          window.ChatSocket?.sendServerCallOffer?.({ toUserId: Number(id), serverId: state.groupServerId, channelId: state.groupChannelId, callType: state.groupType, sdp: peer.pc.localDescription });
        }
      } catch (e) { console.error('ICE restart (chamada de servidor):', e); }
      if (state.groupMode && state.groupPeers.has(id) && peer.pc.connectionState !== 'connected') {
        scheduleGroupReconnect(id, peer, false);
      }
    }, delay);
  }

  function removeGroupPeer(id) {
    const peer = state.groupPeers.get(String(id));
    if (!peer) return;
    clearTimeout(peer.reconnectTimer);
    try { peer.pc.close(); } catch (_) {}
    peer.audioStreams?.forEach(a => a.remove());
    state.groupPeers.delete(String(id));
    renderGroupTiles();
  }

  async function startServerCall(serverId, channelId, type) {
    if (state.inCall) return;
    try {
      await (iceConfigPromise || loadIceConfig());
      state.groupMode = true;
      state.groupServerId = serverId;
      state.groupChannelId = channelId;
      state.groupType = type === 'video' ? 'video' : 'audio';
      state.localStream = await getLocalStream(state.groupType === 'video');
      state.inCall = true; state.micEnabled = true; state.camEnabled = state.groupType === 'video';
      openBar(); el.callBar?.classList.toggle('audio-call', state.groupType === 'audio');
      ensureVideoPreview(); renderGroupTiles();
      window.ChatSocket?.joinServerCall?.({ serverId, channelId, callType: state.groupType }, result => {
        if (result?.error) { window.App?.toast(result.error, 'error'); return endCall(false); }
        for (const id of result?.peers || []) createGroupPeer(id, true);
      });
      window.Sounds?.play('call-join');
    } catch (e) {
      state.groupMode = false;
      window.App?.toast(e.message || 'Não foi possível entrar na chamada.', 'error');
      endCall(false);
    }
  }

  async function handleServerOffer(d) {
    if (!state.groupMode || Number(d?.serverId) !== Number(state.groupServerId) || Number(d?.channelId) !== Number(state.groupChannelId)) return;
    const peer = createGroupPeer(d.fromUserId, false);
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
      for (const c of peer.pending || []) { try { await peer.pc.addIceCandidate(c); } catch (_) {} }
      peer.pending = [];
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      window.ChatSocket?.sendServerCallAnswer?.({ toUserId: Number(d.fromUserId), serverId: state.groupServerId, channelId: state.groupChannelId, sdp: peer.pc.localDescription });
    } catch (e) { console.error('Oferta de chamada de servidor:', e); }
  }

  async function handleServerAnswer(d) {
    const peer = groupPeerPc(d?.fromUserId);
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
      for (const c of peer.pending || []) { try { await peer.pc.addIceCandidate(c); } catch (_) {} }
      peer.pending = [];
    } catch (e) { console.error('Resposta de chamada de servidor:', e); }
  }

  async function handleServerIce(d) {
    if (!state.groupMode || !d?.candidate) return;
    const peer = groupPeerPc(d.fromUserId) || createGroupPeer(d.fromUserId, false);
    if (peer.pc.remoteDescription) { try { await peer.pc.addIceCandidate(d.candidate); } catch (_) {} }
    else peer.pending.push(d.candidate);
  }

  function handleServerUserJoined(d) {
    if (!state.groupMode || Number(d.serverId) !== Number(state.groupServerId) || Number(d.channelId) !== Number(state.groupChannelId)) return;
    renderGroupTiles();
  }
  function handleServerUserLeft(d) {
    if (Number(d?.serverId) !== Number(state.groupServerId) || Number(d?.channelId) !== Number(state.groupChannelId)) return;
    removeGroupPeer(d.userId);
  }

  function handleHangup(data) {
    if (state.pendingOffer && (!data || String(data.fromUserId) === String(state.pendingOffer.fromUserId))) {
      state.pendingOffer = null; closeModals();
    }
    if (state.inCall && (!data || String(data.fromUserId) === String(state.targetUserId))) endCall(false);
  }

  function bind() {
    el.startVoiceBtn?.addEventListener('click', () => { const s = appState(); startCall(s?.activeDMUserId, 'audio'); });
    el.startVideoBtn?.addEventListener('click', () => { const s = appState(); startCall(s?.activeDMUserId, 'video'); });
    el.hangupBtn?.addEventListener('click', () => endCall(true));
    el.toggleMicBtn?.addEventListener('click', toggleMic);
    el.toggleCamBtn?.addEventListener('click', toggleCam);
    el.toggleScreenBtn?.addEventListener('click', screenShare);
    el.micMenuBtn?.addEventListener('click', () => deviceMenu('audioinput'));
    el.camMenuBtn?.addEventListener('click', () => deviceMenu('videoinput'));
    el.acceptBtn?.addEventListener('click', accept);
    el.rejectBtn?.addEventListener('click', reject);
    el.callFullscreen?.addEventListener('click', fullscreen);
    el.miniMic?.addEventListener('click', toggleMic);
    el.miniCam?.addEventListener('click', toggleCam);
    el.miniScreen?.addEventListener('click', screenShare);
    el.miniHangup?.addEventListener('click', () => endCall(true));
    el.miniHeadphones?.addEventListener('click', () => {
      state.headphonesOff = !state.headphonesOff;
      if (el.remoteAudio) el.remoteAudio.muted = state.headphonesOff;
      for (const peer of state.groupPeers.values()) {
        peer.audioStreams?.forEach(a => { a.muted = state.headphonesOff; });
      }
      el.miniHeadphones.textContent = state.headphonesOff ? '🔇' : '🎧';
    });
    el.remoteVolumeBtn?.addEventListener('click', e => {
      e.stopPropagation();
      el.remoteVolumeMenu?.classList.toggle('hidden');
    });
    el.remoteVolumeRange?.addEventListener('input', () => {
      const pct = setUserVolume(state.targetUserId, el.remoteVolumeRange.value);
      if (el.remoteVolumeValue) el.remoteVolumeValue.textContent = pct + '%';
      if (el.remoteAudio) el.remoteAudio.volume = combinedVolume(state.targetUserId);
    });
    document.addEventListener('click', e => {
      if (!el.remoteVolumeMenu || el.remoteVolumeMenu.classList.contains('hidden')) return;
      if (e.target === el.remoteVolumeBtn || el.remoteVolumeMenu.contains(e.target)) return;
      el.remoteVolumeMenu.classList.add('hidden');
    });
    bindGroupVolumeControl();
    document.addEventListener('fullscreenchange', () => { state.fullscreen = !!document.fullscreenElement; });
    navigator.mediaDevices?.addEventListener?.('devicechange', () => window.Settings?.refreshDevices?.());
  }

  function init() { cache(); bind(); updateButtons(); iceConfigPromise = loadIceConfig(); }

  window.Call = {
    init, handleOffer, handleAnswer: answer, handleIceCandidate: ice, handleHangup,
    handleSpeaking: remoteSpeaking, updateCallButtonsState: updateButtons,
    getState: () => state, applyAdminVoiceMute, endFromAdmin, syncContext,
    startServerCall, handleServerOffer, handleServerAnswer, handleServerIce,
    handleServerUserJoined, handleServerUserLeft
  };
})();
