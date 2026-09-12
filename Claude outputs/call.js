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

  // ---------------------------------------------------------------------
  // Áudio de chamada de servidor no celular: a chamada 1:1 usa um único
  // <audio> FIXO que já existe no HTML desde o carregamento da página
  // (#remote-audio) e tenta play() de novo em 100ms/500ms — funciona no
  // celular. A chamada de servidor/grupo cria um <audio> NOVO por
  // participante dentro de pc.ontrack (bem depois do toque que iniciou a
  // chamada, já fora da pilha de execução do gesto do usuário), e só
  // tentava play() UMA vez, engolindo o erro — em navegador móvel
  // (Chrome Android, WebView do app, Safari iOS) isso quase sempre é
  // bloqueado pela política de autoplay com som, e a chamada conecta mas
  // fica muda/sem vídeo em silêncio, sem nenhum aviso. Duas camadas de
  // correção: (1) "destrava" o autoplay da página sincronamente dentro do
  // toque que inicia a chamada (startServerCall), tocando um WAV
  // silencioso e retomando um AudioContext compartilhado — isso conta
  // como resposta a gesto do usuário na maioria dos navegadores e libera
  // play() programático depois; (2) toda vez que um <audio>/<video> de
  // participante for criado, tenta de novo em 100ms/500ms E registra um
  // retry na PRÓXIMA interação da pessoa com a página (toque/clique em
  // qualquer lugar), caso a primeira tentativa ainda assim seja recusada.
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==';
  let sharedAudioCtx = null;
  function primeAudioPlayback() {
    try {
      const a = new Audio(SILENT_WAV);
      a.volume = 0.01;
      a.play?.().catch(() => {});
    } catch (_) {}
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        if (!sharedAudioCtx) sharedAudioCtx = new Ctx();
        if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(() => {});
      }
    } catch (_) {}
  }
  const pendingGestureRetries = new Set();
  function unlockOnNextGesture(fn) {
    if (typeof fn !== 'function') return;
    pendingGestureRetries.add(fn);
  }
  function flushGestureRetries() {
    if (!pendingGestureRetries.size) return;
    const fns = [...pendingGestureRetries];
    pendingGestureRetries.clear();
    for (const fn of fns) { try { fn(); } catch (_) {} }
  }
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(evt => {
    document.addEventListener(evt, flushGestureRetries, { passive: true });
  });
  function retryMediaPlay(mediaEl) {
    if (!mediaEl) return;
    const play = () => mediaEl.play?.().catch(() => {});
    play();
    setTimeout(play, 100);
    setTimeout(play, 500);
    unlockOnNextGesture(play);
  }

  // ---------------------------------------------------------------------
  // Sanitização de SDP: remove o codec de correção de erro flexfec-03 antes
  // de qualquer setLocalDescription/setRemoteDescription. Em algumas
  // combinações de transceptores (câmera + tela como faixas de vídeo
  // separadas — ver pcCreate) o Chrome tem um bug conhecido ao renumerar os
  // payload types dinâmicos durante uma renegociação: ele gera um SDP onde
  // o MESMO número de payload type aparece duas vezes apontando pra codecs
  // diferentes ("a=rtpmap:49 flexfec-03/90000 Duplicate payload type with
  // conflicting codec name or clock rate"), e o próprio navegador rejeita a
  // descrição que ele mesmo gerou. Como flexfec é só uma otimização de
  // correção de erro (não essencial — o vídeo funciona normalmente sem
  // ele), a saída mais segura é nunca oferecer/aceitar esse codec: assim
  // esse conflito nunca chega a existir, em vez de tentar prever todo caso
  // em que o Chrome erra a numeração.
  function stripFlexFec(sdp) {
    if (!sdp || typeof sdp !== 'string' || !/flexfec/i.test(sdp)) return sdp;
    const lines = sdp.split('\r\n');
    const removePts = new Set();
    for (const line of lines) {
      const m = /^a=rtpmap:(\d+)\s+flexfec/i.exec(line);
      if (m) removePts.add(m[1]);
    }
    if (!removePts.size) return sdp;
    const out = [];
    for (let line of lines) {
      let pt = null;
      let mm;
      if ((mm = /^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)\b/.exec(line))) pt = mm[1];
      if (pt && removePts.has(pt)) continue;
      if (line.startsWith('m=video')) {
        const parts = line.split(' ');
        const header = parts.slice(0, 3);
        const pts = parts.slice(3).filter(p => !removePts.has(p));
        line = header.concat(pts).join(' ');
      }
      out.push(line);
    }
    return out.join('\r\n');
  }
  // Aplica a sanitização acima em cima de uma RTCSessionDescription recém
  // criada (createOffer/createAnswer), devolvendo um objeto plano pronto
  // pra setLocalDescription — sem isso a descrição continuaria com o
  // flexfec problemático.
  function sanitizeDescription(desc) {
    if (!desc) return desc;
    return { type: desc.type, sdp: stripFlexFec(desc.sdp) };
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
    shareResolution: 720, shareType: 'screen', shareSystemAudio: true,
    groupMode: false, groupServerId: null, groupChannelId: null,
    groupType: 'audio', groupPeers: new Map(),
    qualityTimer: null,
    // Câmera e apresentação de tela remotas chegam em transceptores
    // separados (ver pcCreate/ontrack) e podem estar ativas ao mesmo tempo
    // — precisa lembrar o stream da câmera remota separadamente pra saber
    // se tem algo pra mostrar na bolinha (PIP) quando a tela também estiver
    // ativa, e pra devolver a câmera pro palco principal quando a
    // apresentação terminar.
    remoteCameraStream: null, remoteScreenActive: false,
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

  // Volume da APRESENTAÇÃO DE TELA (o som do que a pessoa está
  // compartilhando), separado do volume da voz dela — reaproveita a mesma
  // chave de armazenamento só que com um sufixo, pra não precisar duplicar
  // toda a lógica de leitura/gravação/limite 0-100.
  function getScreenVolume(id) { return getUserVolume(String(id) + ':screen'); }
  function setScreenVolume(id, value) { return setUserVolume(String(id) + ':screen', value); }
  function combinedScreenVolume(id) {
    const globalPct = Number(appState()?.currentUser?.settings?.outputVolume ?? 100);
    const screenPct = getScreenVolume(id);
    return Math.max(0, Math.min(1, (globalPct / 100) * (screenPct / 100)));
  }

  function cache() {
    Object.assign(el, {
      callBar: $('call-bar'), callStatus: $('call-connection-status'), remoteLabelTop: $('call-remote-label-top'),
      localVideo: $('local-video'), remoteVideo: $('remote-video'), remoteAudio: $('remote-audio'),
      remoteScreenAudio: $('remote-screen-audio'),
      localCameraPip: $('local-camera-pip'), remoteCameraPip: $('remote-camera-pip'),
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
      shareSystemAudioRow: $('share-system-audio-row'), shareSystemAudioHint: $('share-system-audio-hint'),
      qualityDot: $('call-quality-dot'),
      remoteVolumeBtn: $('call-remote-volume-btn'), remoteVolumeMenu: $('call-remote-volume-menu'),
      remoteVolumeRange: $('call-remote-volume-range'), remoteVolumeValue: $('call-remote-volume-value'),
      callContextMenu: $('call-context-menu'), callContextMenuTitle: $('call-context-menu-title'),
      callContextVolumeRange: $('call-context-volume-range'), callContextVolumeValue: $('call-context-volume-value'),
      callContextMuteBtn: $('call-context-mute-toggle'),
      callContextScreenVolumeRow: $('call-context-screen-volume-row'),
      callContextScreenVolumeRange: $('call-context-screen-volume-range'), callContextScreenVolumeValue: $('call-context-screen-volume-value'),
      callContextScreenMuteBtn: $('call-context-screen-mute-toggle'),
      callStage: document.querySelector('.call-stage'), stageImmersiveToggle: $('call-stage-immersive-toggle')
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

  // ---------------------------------------------------------------------
  // Modo imersivo da apresentação de tela: clicar na transmissão (ou no
  // botão de seta pra baixo) esconde as bolinhas de câmera, os avatares e
  // a barra de controles, deixando só a tela compartilhada — clicar de
  // novo (em qualquer lugar da transmissão, ou na seta) traz tudo de
  // volta. Também some sozinho depois de alguns segundos parado, do jeito
  // que o YouTube/Google Meet fazem. Ver CSS .stage-immersive no final do
  // style.css.
  // ---------------------------------------------------------------------
  let stageIdleTimer = null;
  function isSharingActive() {
    return !!(el.callBar?.classList.contains('sharing') || el.callBar?.classList.contains('remote-sharing'));
  }
  function scheduleStageAutoHide() {
    clearTimeout(stageIdleTimer);
    if (!isSharingActive()) return;
    stageIdleTimer = setTimeout(() => setStageImmersive(true), 3500);
  }
  function setStageImmersive(on) {
    if (!isSharingActive()) on = false;
    el.callBar?.classList.toggle('stage-immersive', on);
    if (el.stageImmersiveToggle) el.stageImmersiveToggle.setAttribute('aria-label', on ? 'Mostrar câmeras e controles' : 'Ocultar câmeras e perfis');
    clearTimeout(stageIdleTimer);
    if (!on) scheduleStageAutoHide();
  }
  function toggleStageImmersive() {
    if (!isSharingActive()) return;
    setStageImmersive(!el.callBar?.classList.contains('stage-immersive'));
  }
  function resetStageImmersive() {
    el.callBar?.classList.remove('stage-immersive');
    clearTimeout(stageIdleTimer);
    stageIdleTimer = null;
  }

  // ---------------------------------------------------------------------
  // Palco da chamada 1:1 fora do modo de apresentação: enquanto NINGUÉM
  // dos dois lados tem câmera ligada, mostra os dois avatares grandes e
  // centralizados lado a lado (nunca uma tela preta vazia com bolinhas
  // pequenas de canto); assim que qualquer um dos dois liga a câmera, os
  // dois viram retângulos do MESMO tamanho lado a lado (o lado sem câmera
  // mostra o avatar dentro do próprio retângulo, no lugar de vídeo preto).
  // Não mexe na chamada de servidor/grupo (tem sua própria grade — ver
  // renderGroupTiles) nem no modo de apresentação de tela (tem seu próprio
  // layout — ver .sharing/.remote-sharing no CSS).
  // ---------------------------------------------------------------------
  function updateCallStageMode() {
    if (state.groupMode) return;
    const bar = el.callBar;
    if (!bar) return;
    const localOn = !!(state.camEnabled && state.localStream?.getVideoTracks()?.[0]);
    const remoteOn = !!state.remoteCameraStream;
    bar.classList.toggle('stage-circles', !localOn && !remoteOn);
    bar.classList.toggle('stage-grid', localOn || remoteOn);
    bar.classList.toggle('stage-grid-local-on', localOn);
    bar.classList.toggle('stage-grid-remote-on', remoteOn);
  }

  // ---------------------------------------------------------------------
  // Menu de botão direito (participante/transmissão): volume rápido e
  // silenciar, no ponto onde a pessoa clicou — mesma ideia do Discord.
  // ---------------------------------------------------------------------
  function openCallContextMenu(x, y, targetUserId) {
    const menu = el.callContextMenu;
    if (!menu || !targetUserId) return;
    if (el.callContextMenuTitle) el.callContextMenuTitle.textContent = friendName(targetUserId);
    const pct = getUserVolume(targetUserId);
    if (el.callContextVolumeRange) el.callContextVolumeRange.value = String(pct);
    if (el.callContextVolumeValue) el.callContextVolumeValue.textContent = pct + '%';
    if (el.callContextMuteBtn) el.callContextMuteBtn.textContent = pct === 0 ? 'Reativar som' : 'Silenciar pessoa';
    // O controle de volume da TRANSMISSÃO só faz sentido (e só aparece) se
    // essa pessoa estiver mesmo apresentando a tela agora — não tem o que
    // silenciar/ajustar se não existe áudio de transmissão nenhum chegando.
    const screenLive = state.remoteScreenActive && String(targetUserId) === String(state.targetUserId);
    el.callContextScreenVolumeRow?.classList.toggle('hidden', !screenLive);
    el.callContextScreenMuteBtn?.classList.toggle('hidden', !screenLive);
    if (screenLive) {
      const screenPct = getScreenVolume(targetUserId);
      if (el.callContextScreenVolumeRange) el.callContextScreenVolumeRange.value = String(screenPct);
      if (el.callContextScreenVolumeValue) el.callContextScreenVolumeValue.textContent = screenPct + '%';
      if (el.callContextScreenMuteBtn) el.callContextScreenMuteBtn.textContent = screenPct === 0 ? 'Reativar transmissão' : 'Silenciar transmissão';
    }
    menu.dataset.targetUserId = String(targetUserId);
    menu.classList.remove('hidden');
    // Só depois de mostrar (offsetWidth força o layout) dá pra medir o
    // tamanho real do menu e evitar que ele nasça cortado pra fora da tela.
    const w = menu.offsetWidth || 200, h = menu.offsetHeight || 120;
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
  }
  function closeCallContextMenu() { el.callContextMenu?.classList.add('hidden'); }
  function applyContextVolume(pct) {
    const id = el.callContextMenu?.dataset.targetUserId;
    if (!id) return;
    const applied = setUserVolume(id, pct);
    if (el.callContextVolumeRange) el.callContextVolumeRange.value = String(applied);
    if (el.callContextVolumeValue) el.callContextVolumeValue.textContent = applied + '%';
    if (el.callContextMuteBtn) el.callContextMuteBtn.textContent = applied === 0 ? 'Reativar som' : 'Silenciar pessoa';
    if (String(id) === String(state.targetUserId) && el.remoteAudio) el.remoteAudio.volume = combinedVolume(id);
    syncVolumeUI();
  }
  function applyContextScreenVolume(pct) {
    const id = el.callContextMenu?.dataset.targetUserId;
    if (!id) return;
    const applied = setScreenVolume(id, pct);
    if (el.callContextScreenVolumeRange) el.callContextScreenVolumeRange.value = String(applied);
    if (el.callContextScreenVolumeValue) el.callContextScreenVolumeValue.textContent = applied + '%';
    if (el.callContextScreenMuteBtn) el.callContextScreenMuteBtn.textContent = applied === 0 ? 'Reativar transmissão' : 'Silenciar transmissão';
    if (String(id) === String(state.targetUserId) && el.remoteScreenAudio) el.remoteScreenAudio.volume = combinedScreenVolume(id);
  }
  // Segurar o dedo por meio segundo abre o mesmo menu que o botão direito
  // do mouse abre no desktop — em celular/tablet não existe botão direito,
  // então sem isso não tinha NENHUMA forma de ver essas opções (volume,
  // silenciar) fora do PC. Só reage a toque de verdade (pointerType
  // 'touch'), nunca a mouse/caneta, pra não brigar com clique normal e
  // arrastar no desktop. Cancela se o dedo se mover (é um arrastar/scroll,
  // não uma pressão parada) ou soltar antes do tempo.
  function bindLongPress(target, onLongPress) {
    if (!target) return;
    let timer = null, startX = 0, startY = 0, fired = false;
    const MOVE_TOLERANCE = 12;
    const HOLD_MS = 500;
    const cancel = () => { clearTimeout(timer); timer = null; };
    target.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      fired = false;
      startX = e.clientX; startY = e.clientY;
      cancel();
      timer = setTimeout(() => { fired = true; onLongPress(e); }, HOLD_MS);
    });
    target.addEventListener('pointermove', e => {
      if (e.pointerType !== 'touch' || !timer) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE) cancel();
    });
    target.addEventListener('pointerup', cancel);
    target.addEventListener('pointercancel', cancel);
    // Depois de um toque longo bem-sucedido, o navegador ainda dispara o
    // 'contextmenu' nativo dele mesmo (seleção de texto, menu de
    // salvar-imagem) — bloqueia só nesse caso específico.
    target.addEventListener('contextmenu', e => { if (fired) e.preventDefault(); });
  }

  function bindCallContextMenu() {
    const targets = () => [el.remoteAvatar, el.remoteVideo, el.remoteCameraPip].filter(Boolean);
    targets().forEach(t => {
      t.addEventListener('contextmenu', e => {
        if (!state.inCall || state.groupMode || !state.targetUserId) return;
        e.preventDefault();
        openCallContextMenu(e.clientX, e.clientY, state.targetUserId);
      });
      bindLongPress(t, e => {
        if (!state.inCall || state.groupMode || !state.targetUserId) return;
        navigator.vibrate?.(15);
        openCallContextMenu(e.clientX, e.clientY, state.targetUserId);
      });
    });
    el.callContextVolumeRange?.addEventListener('input', () => applyContextVolume(el.callContextVolumeRange.value));
    el.callContextMuteBtn?.addEventListener('click', () => {
      const id = el.callContextMenu?.dataset.targetUserId;
      applyContextVolume(getUserVolume(id) === 0 ? 100 : 0);
    });
    el.callContextScreenVolumeRange?.addEventListener('input', () => applyContextScreenVolume(el.callContextScreenVolumeRange.value));
    el.callContextScreenMuteBtn?.addEventListener('click', () => {
      const id = el.callContextMenu?.dataset.targetUserId;
      applyContextScreenVolume(getScreenVolume(id) === 0 ? 100 : 0);
    });
    document.addEventListener('click', e => {
      if (!el.callContextMenu || el.callContextMenu.classList.contains('hidden')) return;
      if (!el.callContextMenu.contains(e.target)) closeCallContextMenu();
    });
    document.addEventListener('contextmenu', e => {
      if (!el.callContextMenu || el.callContextMenu.classList.contains('hidden')) return;
      if (!targets().some(t => t?.contains(e.target))) closeCallContextMenu();
    });
    window.addEventListener('blur', closeCallContextMenu);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCallContextMenu(); });
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
    updateCallStageMode();
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
    // Sem WFNA a câmera ficava sempre travada em "ideal" 720p/30fps mesmo
    // pra quem tinha WFNA ativo — só o compartilhamento de tela olhava pro
    // WFNA antes. "ideal" é o valor que o navegador realmente tenta entregar
    // (o "max" era só um teto que quase nunca era alcançado); por isso
    // aumentar o ideal é o que faz a diferença aparecer de verdade — dentro
    // do que a câmera da pessoa/o navegador realmente suportar.
    const wfna = !!appState()?.currentUser?.wfna;
    const res = wfna ? { width: { ideal: 1920, max: 3840 }, height: { ideal: 1080, max: 2160 } } : { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 } };
    const frameRate = wfna ? { ideal: 60, max: 120 } : { ideal: 30, max: 60 };
    const videoConstraint = video
      ? Object.assign({}, res, { frameRate }, settings.videoDeviceId ? { deviceId: { exact: settings.videoDeviceId } } : {})
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
    // Enquanto está apresentando a tela, #local-video mostra a PRÓPRIA
    // apresentação (ver startScreenShareWithQuality), não a câmera — sair
    // cedo ANTES de trocar o srcObject é essencial: chamar essa função
    // durante uma apresentação ativa (ex.: ligar a câmera no meio dela,
    // trocar de dispositivo) sobrescrevia o preview da tela pela câmera na
    // hora, mesmo sem a apresentação ter parado de verdade — a pessoa via
    // a PRÓPRIA prévia da transmissão "desligar" (trocar pra câmera) só de
    // ligar a câmera, parecendo que uma cortava a outra.
    if (state.screenStream) return;
    el.localVideo.srcObject = state.localStream || null;
    el.localVideo.muted = true;
    el.localVideo.autoplay = true;
    el.localVideo.playsInline = true;
    el.localVideo.classList.toggle('hidden', !state.camEnabled);
    el.localVideo.play?.().catch(() => {});
  }

  // Espelha ensureVideoPreview() pra bolinha de câmera local: aparece
  // sempre que o palco principal estiver ocupado por UMA APRESENTAÇÃO DE
  // TELA (a minha ou a da outra pessoa — nos dois casos o #local-video
  // "normal" já está ocupado com a tela) e a minha câmera estiver ligada.
  // Antes só considerava "eu apresentando", então quando a OUTRA pessoa
  // compartilhava a tela, ninguém via a minha câmera — só a de quem
  // estava apresentando.
  function ensureLocalCameraPip() {
    if (!el.localCameraPip) return;
    if ((state.screenStream || state.remoteScreenActive) && state.camEnabled && state.localStream?.getVideoTracks()[0]) {
      el.localCameraPip.srcObject = state.localStream;
      el.localCameraPip.muted = true;
      el.localCameraPip.autoplay = true;
      el.localCameraPip.playsInline = true;
      el.localCameraPip.classList.remove('hidden');
      el.localCameraPip.play?.().catch(() => {});
    } else {
      el.localCameraPip.classList.add('hidden');
      el.localCameraPip.srcObject = null;
    }
  }

  function attachRemoteStream(stream) {
    if (!el.remoteVideo) return;
    el.remoteVideo.srcObject = stream;
    el.remoteVideo.autoplay = true;
    el.remoteVideo.playsInline = true;
    // #remote-video nunca carrega áudio de verdade (o som vem sempre de um
    // <audio> separado — attachRemoteAudio/attachRemoteScreenAudio), então
    // marcar como "muted" aqui não tira som nenhum — só deixa o autoplay
    // mais robusto contra a política do navegador em qualquer situação.
    // Testei isoladamente e o autoplay sem "muted" já funcionava mesmo sem
    // gesto do usuário (porque a stream não tem áudio mesmo sem isso), então
    // isso sozinho NÃO era o bug — mas não custa nada manter.
    el.remoteVideo.muted = true;
    el.remoteVideo.classList.remove('hidden');
    el.remoteVideo.play?.()
      .then(() => console.log('[WifiCord/call] remote-video play() OK'))
      .catch(err => console.log('[WifiCord/call] remote-video play() FALHOU:', err?.name, err?.message));
    requestAnimationFrame(() => el.remoteVideo?.play?.().catch(() => {}));
  }

  // Bolinha de câmera por cima da apresentação de tela (a mesma ideia do
  // Discord): só existe enquanto a outra pessoa está apresentando a tela E
  // com a câmera ligada ao mesmo tempo — nos outros casos a câmera ocupa o
  // palco principal normalmente (attachRemoteStream).
  function attachRemoteCameraPip(stream) {
    if (!el.remoteCameraPip) return;
    el.remoteCameraPip.srcObject = stream;
    el.remoteCameraPip.autoplay = true;
    el.remoteCameraPip.playsInline = true;
    el.remoteCameraPip.muted = true; // mesmo motivo de attachRemoteStream acima
    el.remoteCameraPip.classList.remove('hidden');
    el.remoteCameraPip.play?.().catch(() => {});
  }
  function detachRemoteCameraPip() {
    if (!el.remoteCameraPip) return;
    el.remoteCameraPip.classList.add('hidden');
    el.remoteCameraPip.srcObject = null;
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

  // Som da apresentação de tela (áudio-do-sistema) da outra pessoa — sempre
  // num elemento <audio> PRÓPRIO, separado do mic dela, pra ter um volume
  // independente (ver getScreenVolume/combinedScreenVolume e o segundo
  // slider no menu de botão direito).
  function attachRemoteScreenAudio(stream) {
    if (!el.remoteScreenAudio) return;
    el.remoteScreenAudio.srcObject = stream;
    el.remoteScreenAudio.autoplay = true;
    el.remoteScreenAudio.playsInline = true;
    el.remoteScreenAudio.muted = state.headphonesOff;
    el.remoteScreenAudio.volume = combinedScreenVolume(state.targetUserId);
    window.Settings?.applyOutput?.(el.remoteScreenAudio);
    const play = () => el.remoteScreenAudio?.play?.().catch(() => {});
    play();
    setTimeout(play, 100);
    setTimeout(play, 500);
  }

  function addRemoteTrack(track, remoteStream, isRemoteVideo) {
    if (!remoteStream.getTracks().some(t => t.id === track.id)) remoteStream.addTrack(track);
    if (isRemoteVideo) attachRemoteStream(remoteStream);
    else attachRemoteAudio(remoteStream);
  }

  // ---------------------------------------------------------------------
  // 4 "slots" fixos de mídia, sempre na mesma ordem pros dois lados: mic,
  // câmera, áudio-do-sistema (só usado durante apresentação de tela) e
  // vídeo-da-tela. Câmera e tela usam sender/receiver PRÓPRIOS — antes os
  // dois dividiam o mesmo slot de vídeo (screenShare fazia replaceTrack no
  // MESMO sender da câmera), então ligar a câmera durante uma apresentação
  // de tela substituía a track que estava sendo transmitida, cortando a
  // apresentação na hora ("se liga a câmera, tá interrompendo a
  // transmissão"). Com slots separados os dois fluem ao mesmo tempo, e o
  // lado que recebe consegue saber COM CERTEZA (pela identidade do
  // receiver, não por adivinhação) se um vídeo recebido é a câmera ou a
  // tela da outra pessoa — usado em ontrack() pra parar de empilhar o
  // avatar em cima da transmissão (ver comentário lá).
  //
  // IMPORTANTE — por que existem DUAS formas de preencher esses slots
  // (addFixedTransceivers/bindFixedTransceivers) em vez de só criar os 4
  // com addTransceiver() sempre em pcCreate() como antes:
  //
  // Testado isoladamente (RTCPeerConnection puro, sem nada do WifiCord
  // envolvido): quando quem vai ATENDER uma ligação chama addTransceiver()
  // ANTES de aplicar a oferta recebida (setRemoteDescription), o Chrome NÃO
  // reaproveita esses transceptores pra oferta — ele cria outros novos do
  // zero pros m-lines da oferta, e os pré-criados ficam órfãos PRA SEMPRE
  // (mid nunca é atribuído, nunca fazem parte da ligação de verdade). Era
  // esse o motivo real de "a transmissão não aparece pro outro usuário":
  // quem ATENDIA anexava a câmera/tela nesses transceptores órfãos, então a
  // pessoa que ligou nunca recebia nada de quem atendeu (nem câmera, nem
  // tela, nem varia com renegociação — cada renegociação só piorava,
  // acumulando transceptores órfãos novos).
  //
  // A solução (confirmada com o mesmo teste isolado): quem vai LIGAR ainda
  // pode criar os 4 transceptores antes da oferta (não tem oferta remota
  // nenhuma ainda pra derivar deles) — addFixedTransceivers() cobre esse
  // caso. Já quem vai ATENDER precisa chamar setRemoteDescription() da
  // oferta PRIMEIRO, e só DEPOIS ler os transceptores que o Chrome criou
  // sozinho via pc.getTransceivers() — bindFixedTransceivers() cobre esse
  // caso. O Chrome sempre devolve esses transceptores na MESMA ordem dos
  // m-lines da oferta, e quem liga sempre cria a oferta nessa mesma ordem
  // fixa (mic, câmera, áudio-do-sistema, vídeo-da-tela), então dá pra
  // mapear por posição com segurança.
  // ---------------------------------------------------------------------
  function addFixedTransceivers(pc) {
    let audioT = null, videoT = null, systemAudioT = null, screenVideoT = null;
    try { audioT = pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch (_) {}
    try { videoT = pc.addTransceiver('video', { direction: 'sendrecv' }); } catch (_) {}
    try { systemAudioT = pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch (_) {}
    try { screenVideoT = pc.addTransceiver('video', { direction: 'sendrecv' }); } catch (_) {}
    pc._wifiAudioSender = audioT?.sender || null;
    pc._wifiVideoSender = videoT?.sender || null;
    pc._wifiSystemAudioSender = systemAudioT?.sender || null;
    pc._wifiScreenVideoSender = screenVideoT?.sender || null;
    pc._wifiAudioReceiver = audioT?.receiver || null;
    pc._wifiVideoReceiver = videoT?.receiver || null;
    pc._wifiSystemAudioReceiver = systemAudioT?.receiver || null;
    pc._wifiScreenVideoReceiver = screenVideoT?.receiver || null;
  }

  function bindFixedTransceivers(pc) {
    const list = pc.getTransceivers();
    const audioT = list[0] || null, videoT = list[1] || null, systemAudioT = list[2] || null, screenVideoT = list[3] || null;
    // SEGUNDO motivo raiz da transmissão não chegar pro outro lado (achado
    // depois do primeiro, com a mesma técnica de teste isolado): um
    // transceptor criado automaticamente pelo Chrome ao processar uma
    // oferta recebida nasce com direction 'recvonly' por padrão — "só vou
    // RECEBER" — mesmo quando a oferta pedia 'sendrecv', e mesmo depois de
    // anexar uma track de verdade com replaceTrack(). Sem mudar isso ANTES
    // de gerar a resposta (createAnswer), a resposta SDP fica dizendo "eu
    // só recebo" pros 4 slots, e o Chrome simplesmente NUNCA transmite nada
    // nesse m-line, não importa o que replaceTrack() anexou — a track fica
    // presa localmente sem sair. Confirmado com o mesmo teste isolado:
    // sem essa linha, os 4 slots de quem atende ficavam 'recvonly' mesmo
    // com track anexada; com ela, viram 'sendrecv' e a track passa a sair
    // de verdade. Por isso quem ATENDIA a ligação nunca conseguia mandar
    // nem câmera, nem mic, nem tela pra quem ligou.
    for (const t of [audioT, videoT, systemAudioT, screenVideoT]) {
      if (t && t.direction !== 'sendrecv') t.direction = 'sendrecv';
    }
    pc._wifiAudioSender = audioT?.sender || pc._wifiAudioSender || null;
    pc._wifiVideoSender = videoT?.sender || pc._wifiVideoSender || null;
    pc._wifiSystemAudioSender = systemAudioT?.sender || pc._wifiSystemAudioSender || null;
    pc._wifiScreenVideoSender = screenVideoT?.sender || pc._wifiScreenVideoSender || null;
    pc._wifiAudioReceiver = audioT?.receiver || pc._wifiAudioReceiver || null;
    pc._wifiVideoReceiver = videoT?.receiver || pc._wifiVideoReceiver || null;
    pc._wifiSystemAudioReceiver = systemAudioT?.receiver || pc._wifiSystemAudioReceiver || null;
    pc._wifiScreenVideoReceiver = screenVideoT?.receiver || pc._wifiScreenVideoReceiver || null;
  }

  // TERCEIRO motivo raiz da transmissão não chegar pro outro lado (achado
  // depois dos outros dois, olhando com calma pra ordem de eventos em vez
  // de só testar a negociação isolada): pc.ontrack pode disparar ANTES do
  // código que roda depois de "await pc.setRemoteDescription(oferta)" —
  // ou seja, antes de bindFixedTransceivers() ter preenchido
  // pc._wifiScreenVideoReceiver/pc._wifiSystemAudioReceiver. Quando isso
  // acontece, "e.receiver === pc._wifiScreenVideoReceiver" compara com
  // undefined e dá falso pra TODO mundo — a tela chega sendo tratada como
  // se fosse câmera (ou nem aparece onde devia), então mesmo com a
  // direção 'sendrecv' certa e bytes chegando de verdade, o app mostrava
  // a coisa errada no lugar errado (ou nada). Em vez de depender de
  // pc._wifi*Receiver já estar preenchido, dá pra descobrir qual dos 4
  // slots fixos (mic=0, câmera=1, áudio-do-sistema=2, tela=3) cada evento
  // é OLHANDO A POSIÇÃO do transceptor em pc.getTransceivers() na hora —
  // essa lista já existe e já está na ordem certa assim que o evento
  // dispara, não depende de mais nada ter rodado antes.
  function fixedSlotIndex(pc, transceiver) {
    if (!transceiver) return -1;
    const list = pc.getTransceivers();
    return list.indexOf(transceiver);
  }

  function pcCreate(polite = false) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    state.polite = polite;
    state.ignoreOffer = false;
    state.negotiationPending = false;

    // Destrava sozinho uma negociação que ficou pendente (ver comentário
    // grande em negotiate()) assim que a ligação volta a ficar 'stable' —
    // sem isso, compartilhar tela/câmera bem na hora errada podia nunca
    // avisar o outro lado, e a pessoa não tinha como saber nem tentar de
    // novo manualmente.
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable' && state.negotiationPending && state.pc === pc && !state.groupMode) {
        state.negotiationPending = false;
        negotiate(false).catch(e => console.error('Renegociação pendente:', e));
      }
    };

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
        clearTimeout(pc._wifiIceStuckTimer);
      }
      if (ice === 'disconnected') scheduleReconnect(pc);
      if (ice === 'failed') scheduleReconnect(pc, true);
    };
    // Diagnóstico: testei a negociação (transceptores, direção sendrecv,
    // replaceTrack sem renegociação) isoladamente — os dois lados dentro da
    // MESMA aba, sem NAT/rede real nenhuma no meio — e os bytes chegam
    // certinhos, então o código em si está correto. Se mesmo assim a
    // chamada fica travada em "Conectando..." pro lado que atendeu, é bem
    // provável que seja a REDE (NAT/firewall de um dos dois lados) que não
    // deixa a conexão direta se formar — nesse caso só um servidor TURN
    // (ver server/routes/webrtc.js e as variáveis TURN_URLS/TURN_USERNAME/
    // TURN_CREDENTIAL, hoje sem nenhum valor configurado no Render — só STUN)
    // resolve, não tem fix de código que resolva isso. Esse aviso aparece
    // pra não ficar parecendo "quebrado sem explicação" de novo.
    pc._wifiIceStuckTimer = setTimeout(() => {
      const ice = pc.iceConnectionState;
      if (state.pc === pc && ice !== 'connected' && ice !== 'completed' && ice !== 'closed') {
        window.App?.toast('A conexão está demorando muito — provavelmente a rede de um dos dois lados está bloqueando a conexão direta. Isso geralmente precisa de um servidor TURN configurado no servidor (não é algo que dá pra resolver só no app).', 'error');
      }
    }, 9000);

    pc.onconnectionstatechange = () => {
      const connection = pc.connectionState;
      state.lastConnectionState = connection;
      if (connection === 'connecting') setCallStatus('Conectando…', 'connecting');
      if (connection === 'connected') {
        state.reconnectAttempts = 0;
        setCallStatus('Conectado', 'connected');
        window.Sounds?.play('call-join');
        startQualityMonitor(pc);
        // Só libera renegociação automática (onnegotiationneeded — usada pra
        // compartilhar tela depois) quando a ligação REALMENTE conectou, não
        // logo após mandar a oferta/resposta inicial. O pcCreate() já cria 4
        // transceivers de cara (áudio, vídeo, áudio-do-sistema, vídeo-da-tela),
        // o que deixa
        // um 'negotiationneeded' "pendente" no navegador; ele só dispara
        // quando o signalingState volta a ficar 'stable' — o que acontece
        // bem na hora em que a resposta chega. Se negotiationReady já
        // estivesse true nesse momento, esse evento reaproveitado mandava
        // uma oferta de renegociação por cima da ligação que acabou de
        // conectar, e o outro lado tomava "Erro na renegociação".
        state.negotiationReady = true;
      }
      if (connection === 'disconnected') { scheduleReconnect(pc); setQuality('unknown'); }
      if (connection === 'failed') { scheduleReconnect(pc, true); stopQualityMonitor(); }
      if (connection === 'closed') stopQualityMonitor();
    };

    pc.ontrack = e => {
      const track = e.track;
      const stream = e.streams?.[0] instanceof MediaStream ? e.streams[0] : new MediaStream([track]);
      // Log de diagnóstico temporário — tudo que envolve a negociação em si
      // já foi verificado e testado isoladamente e está correto (ver
      // comentários grandes logo abaixo), então se o vídeo/câmera continuar
      // não aparecendo depois de tudo isso, o próximo passo é olhar esse log
      // no console (F12) do lado de quem NÃO tá vendo nada, bem na hora que
      // o outro liga a câmera/tela, pra ver com que dados de verdade a gente
      // está lidando em vez de continuar só no código.
      console.log('[WifiCord/call] ontrack', { kind: track.kind, slot: fixedSlotIndex(pc, e.transceiver), muted: track.muted, readyState: track.readyState, trackId: track.id, hasTransceiver: !!e.transceiver });
      if (track.kind === 'video') {
        // Câmera e tela chegam em transceptores diferentes (ver comentário
        // em pcCreate), então dá pra saber com certeza qual é qual pela
        // identidade do receiver — em vez de só "um vídeo chegou" e chutar.
        // Isso é o que permite mostrar a tela em tela cheia e a câmera como
        // uma bolinha por cima (como o Discord faz), sem os dois brigando
        // pelo mesmo espaço nem ficando um avatar gigante em cima da
        // transmissão.
        const slot = fixedSlotIndex(pc, e.transceiver);
        const isScreen = slot === 3 || (slot === -1 && e.receiver === pc._wifiScreenVideoReceiver);
        if (isScreen) {
          // QUARTO motivo raiz da transmissão "não chegar" (achado revendo
          // a lógica com calma, não a negociação): os 4 slots são fixos e
          // criados JÁ NO INÍCIO da ligação (ver addFixedTransceivers), então
          // esse ontrack do slot de tela dispara SEMPRE, pra TODA ligação,
          // mesmo quando ninguém nunca compartilhou nada — a track existe,
          // só está muda (sem frame nenhum ainda). O código antigo tratava
          // "o ontrack disparou" como "a pessoa está apresentando": marcava
          // remoteScreenActive=true e jogava esse stream (vazio, preto) pro
          // palco principal na hora, então a câmera de quem ligou (que
          // chegava boa, de verdade) ia parar minimizada na bolinha de
          // canto — o vídeo principal ficava preso numa tela preta que
          // nunca ia mudar, porque ninguém tinha realmente começado a
          // compartilhar tela ainda. Isso explica a apresentação/câmera
          // "não chegando" mesmo com a negociação 100% correta.
          //
          // A forma certa de saber se tem apresentação de verdade rolando é
          // o evento 'unmute' da própria track (dispara quando frames de
          // verdade começam a chegar) e 'mute' quando param (é o que
          // acontece quando quem apresenta faz replaceTrack(null) ao parar
          // — o transceptor fixo nunca é removido, então 'ended' quase
          // nunca dispara mais durante a ligação; contar só com 'ended'
          // como antes deixava remoteScreenActive preso incorretamente).
          const activate = () => {
            console.log('[WifiCord/call] tela remota ATIVA (unmute) — mostrando no palco');
            state.remoteScreenActive = true;
            el.callBar?.classList.remove('audio-call');
            el.callBar?.classList.add('has-remote-video', 'has-remote', 'remote-sharing');
            attachRemoteStream(stream);
            if (state.remoteCameraStream) attachRemoteCameraPip(state.remoteCameraStream);
            ensureLocalCameraPip();
            scheduleStageAutoHide();
            const label = $('call-live-label');
            if (label) {
              label.classList.remove('hidden');
              label.innerHTML = '🔴 <span id="call-remote-label">' + esc(friendName(state.targetUserId)) + '</span> está apresentando';
            }
          };
          const deactivate = () => {
            console.log('[WifiCord/call] tela remota INATIVA (mute/ended)');
            state.remoteScreenActive = false;
            el.callBar?.classList.remove('remote-sharing', 'screen-minimized');
            resetStageImmersive();
            detachRemoteCameraPip();
            ensureLocalCameraPip();
            $('call-live-label')?.classList.add('hidden');
            if (state.remoteCameraStream) {
              el.callBar?.classList.add('has-remote-video', 'has-remote');
              attachRemoteStream(state.remoteCameraStream);
            } else {
              el.callBar?.classList.remove('has-remote-video');
              if (state.callType === 'audio') el.callBar?.classList.add('audio-call');
            }
          };
          track.onunmute = activate;
          track.onmute = deactivate;
          track.onended = deactivate;
          if (!track.muted) activate(); // já chega ligado numa renegociação, por ex.
        } else {
          // Mesmo motivo do slot de tela acima (ver comentário grande):
          // esse slot de vídeo da câmera também é fixo e existe desde o
          // início da ligação, então esse ontrack dispara SEMPRE, mesmo
          // quando a outra pessoa nunca ligou a câmera — a track existe,
          // só está muda. O código antigo tratava "o ontrack disparou"
          // como "a câmera dela está ligada" e já marcava
          // has-remote-video/mostrava o <video> na hora, então o palco
          // ficava preso numa tela preta vazia (a track sem frame nenhum)
          // toda vez que a câmera remota estava desligada, em vez de
          // mostrar os avatares. Só conta como câmera "ligada" de verdade
          // a partir do 'unmute' (frames de verdade chegando), igual a
          // tela — updateCallStageMode() é o que decide se o palco mostra
          // círculos (ninguém com câmera) ou os dois retângulos lado a
          // lado (ver CSS .stage-circles/.stage-grid).
          console.log('[WifiCord/call] câmera remota chegou (transceptor), remoteScreenActive=' + state.remoteScreenActive);
          const activateCam = () => {
            console.log('[WifiCord/call] câmera remota ATIVA (unmute)');
            state.remoteCameraStream = stream;
            el.callBar?.classList.remove('audio-call');
            el.callBar?.classList.add('has-remote-video', 'has-remote');
            if (state.remoteScreenActive) attachRemoteCameraPip(stream);
            else attachRemoteStream(stream);
            updateCallStageMode();
          };
          const deactivateCam = () => {
            console.log('[WifiCord/call] câmera remota INATIVA (mute/ended)');
            state.remoteCameraStream = null;
            detachRemoteCameraPip();
            if (!state.remoteScreenActive) {
              el.callBar?.classList.remove('has-remote-video');
              if (state.callType === 'audio') el.callBar?.classList.add('audio-call');
            }
            updateCallStageMode();
          };
          track.onunmute = activateCam;
          track.onmute = deactivateCam;
          track.onended = deactivateCam;
          if (!track.muted) activateCam(); // já chega ligada numa renegociação, por ex.
        }
      } else {
        el.callBar?.classList.add('has-remote');
        // Mic e áudio-do-sistema (som da apresentação de tela) chegam em
        // transceptores separados (mesma ideia da câmera vs. tela — ver
        // comentário em bindFixedTransceivers/addFixedTransceivers), então
        // dá pra ter um volume PRÓPRIO pra cada um: "volume da pessoa"
        // controla só o mic dela, "volume da transmissão" controla só o
        // som que ela está compartilhando — dois controles separados no
        // menu de botão direito, do jeito que a pessoa pediu.
        const slot = fixedSlotIndex(pc, e.transceiver);
        const isSystemAudio = slot === 2 || (slot === -1 && e.receiver === pc._wifiSystemAudioReceiver);
        if (isSystemAudio) {
          attachRemoteScreenAudio(stream);
        } else {
          addRemoteTrack(track, stream, false);
          startRemoteSpeaking(stream);
        }
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
    // QUINTO motivo raiz possível pra "eu ligo a câmera/apresento e o outro
    // nunca vê nada": até agora, se negotiate() era chamado enquanto já
    // havia uma negociação em andamento (state.makingOffer) ou o
    // signalingState não estava 'stable' — o que pode acontecer de verdade
    // (ex.: o 'negotiationneeded' automático do navegador disparando por
    // conta própria em cima dos 4 transceptores fixos, bem perto do
    // momento em que a chamada conecta — ver negotiationReady) — a função
    // simplesmente DESISTIA em silêncio, sem erro nenhum no console e sem
    // avisar quem clicou em compartilhar tela/câmera. A troca de mídia
    // continuava presa localmente (replaceTrack já tinha rodado, o sender
    // já tinha a track certa), mas como NINGUÉM nunca mandou a oferta
    // avisando o outro lado da mudança, o outro nunca respondia, e a
    // transmissão nunca saía do lugar — apesar de toda a negociação em si
    // (direção sendrecv, transceptores certos) estar 100% correta.
    // Agora, em vez de desistir, guarda que uma negociação ficou pendente e
    // tenta de novo sozinho assim que a ligação voltar a ficar 'stable'
    // (ver pc.onsignalingstatechange em pcCreate) — sem exigir que a pessoa
    // clique de novo em compartilhar tela pra "destravar".
    if (state.makingOffer || (pc.signalingState !== 'stable' && !iceRestart)) {
      state.negotiationPending = true;
      return;
    }
    state.makingOffer = true;
    try {
      const offer = sanitizeDescription(await pc.createOffer(iceRestart ? { iceRestart: true } : undefined));
      await pc.setLocalDescription(offer);
      window.ChatSocket?.sendCallOffer?.({
        toUserId: state.targetUserId,
        sdp: pc.localDescription,
        callType: state.callType,
        renegotiation: true,
        iceRestart: !!iceRestart
      });
      state.negotiationPending = false;
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

    // Quem LIGA (não-polite) já cria os 4 transceptores fixos agora — ainda
    // não existe nenhuma oferta remota pra derivar deles — e anexa mic/
    // câmera na hora. Quem VAI ATENDER (polite) espera: os transceptores de
    // verdade só existem depois do setRemoteDescription da oferta recebida,
    // feito em accept() (ver o comentário grande em bindFixedTransceivers).
    if (!polite) {
      addFixedTransceivers(state.pc);
      const audioTrack = state.localStream.getAudioTracks()[0];
      const videoTrack = state.localStream.getVideoTracks()[0];
      if (state.pc._wifiAudioSender) await state.pc._wifiAudioSender.replaceTrack(audioTrack || null);
      if (state.pc._wifiVideoSender) await state.pc._wifiVideoSender.replaceTrack(videoTrack || null);
    }

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
      const offer = sanitizeDescription(await state.pc.createOffer());
      await state.pc.setLocalDescription(offer);
      window.ChatSocket?.sendCallOffer?.({ toUserId: target, sdp: state.pc.localDescription, callType: type, renegotiation: false });
      // negotiationReady só vira true quando a chamada conecta de verdade
      // (ver onconnectionstatechange em pcCreate) — não aqui.
      window.Sounds?.startLoop('ringback'); // toc-toc de "chamando..." pra quem ligou
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
    // 'call-incoming' não existe em sounds.js (só toca um beep genérico
    // uma única vez) — o som de toque de verdade é o loop 'incoming', que
    // nunca era chamado. É por isso que "o som de chamada não funciona".
    window.Sounds?.startLoop('incoming');
    if (el.incomingText) el.incomingText.textContent = `${friendName(data.fromUserId)} está te ligando (${data.callType === 'audio' ? 'voz' : 'vídeo'}).`;
    if (el.incomingAvatar) el.incomingAvatar.innerHTML = avatarMarkup(user(data.fromUserId));
    $('modal-overlay')?.classList.remove('hidden');
    el.incomingModal?.classList.remove('hidden');
    // No app desktop, traz a janela pra frente mesmo se estiver
    // minimizada/atrás de outra janela — sem isso essa telinha ficaria
    // escondida sem ninguém ver.
    window.wificordDesktop?.notifyIncomingCall?.();
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
      // Rede de segurança: mantém as referências _wifi*Sender/_wifi*Receiver
      // sincronizadas com os transceptores de verdade mesmo numa
      // renegociação (ver bindFixedTransceivers) — não deveria mudar nada
      // aqui já que os 4 slots são fixos, mas é barato e evita reabrir o bug
      // de referência órfã caso algo escape do caminho normal.
      bindFixedTransceivers(pc);
      await flushCandidates(pc);
      const answer = sanitizeDescription(await pc.createAnswer());
      await pc.setLocalDescription(answer);
      window.ChatSocket?.sendCallAnswer?.({ toUserId: data.fromUserId, sdp: pc.localDescription, renegotiation: true });
    } catch (e) {
      console.error('Falha na renegociação:', e);
      setCallStatus('Erro na renegociação', 'failed');
      // Uma renegociação (ex.: tentativa de compartilhar tela) pode falhar
      // sem que a ligação em si tenha caído — o áudio/vídeo já conectado
      // continua funcionando. Sem isso, o status ficava travado em
      // "Erro na renegociação" pro resto da chamada mesmo com tudo OK.
      setTimeout(() => {
        if (state.inCall && state.pc === pc && pc.connectionState === 'connected') {
          setCallStatus('Conectado', 'connected');
        }
      }, 2500);
    }
  }

  async function accept() {
    const d = state.pendingOffer;
    if (!d) return;
    window.Sounds?.stopLoop();
    closeModals();
    try {
      await prepare(d.fromUserId, d.callType || 'video', true);
      await state.pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
      // Só agora (depois do setRemoteDescription) os transceptores de
      // verdade existem — pega eles e SÓ ENTÃO anexa mic/câmera (ver o
      // comentário grande em bindFixedTransceivers pra entender por que
      // fazer isso antes, como era feito em prepare(), deixava quem atende
      // a ligação transmitindo pra transceptores órfãos que nunca chegavam
      // na outra pessoa).
      bindFixedTransceivers(state.pc);
      const audioTrack = state.localStream.getAudioTracks()[0];
      const videoTrack = state.localStream.getVideoTracks()[0];
      if (state.pc._wifiAudioSender) await state.pc._wifiAudioSender.replaceTrack(audioTrack || null);
      if (state.pc._wifiVideoSender) await state.pc._wifiVideoSender.replaceTrack(videoTrack || null);
      await flushCandidates(state.pc);
      const answer = sanitizeDescription(await state.pc.createAnswer());
      await state.pc.setLocalDescription(answer);
      window.ChatSocket?.sendCallAnswer?.({ toUserId: d.fromUserId, sdp: state.pc.localDescription, renegotiation: false });
      state.pendingOffer = null;
      // negotiationReady só vira true quando a chamada conecta de verdade
      // (ver onconnectionstatechange em pcCreate) — não aqui.
    } catch (e) {
      window.App?.toast(e.message || 'Não foi possível atender.', 'error');
      state.pendingOffer = null;
      endCall(true);
    }
  }

  function reject() {
    if (state.pendingOffer) window.ChatSocket?.sendCallHangup?.({ toUserId: state.pendingOffer.fromUserId });
    state.pendingOffer = null;
    window.Sounds?.stopLoop();
    closeModals();
    // Rede de segurança: se por qualquer motivo a barra de chamada já
    // estivesse visível (ex.: estado de uma chamada anterior que não foi
    // limpo direito), recusar um convite também garante que ela suma da
    // tela — sem isso a pessoa via a "tela de chamando" continuar aberta
    // mesmo depois de clicar em recusar.
    if (!state.inCall) el.callBar?.classList.add('hidden');
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
      window.Sounds?.stopLoop(); // para o ringback assim que a outra pessoa atende
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
    window.Sounds?.stopLoop(); // garante que ringback/toque não fica preso tocando
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
    clearTimeout(state.pc?._wifiIceStuckTimer);
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
    state.remoteCameraStream = null; state.remoteScreenActive = false;
    cleanupMediaElement(el.localVideo); cleanupMediaElement(el.remoteVideo);
    detachRemoteCameraPip();
    if (el.localCameraPip) { el.localCameraPip.classList.add('hidden'); el.localCameraPip.srcObject = null; }
    if (el.remoteAudio) { el.remoteAudio.pause?.(); el.remoteAudio.srcObject = null; }
    if (el.remoteScreenAudio) { el.remoteScreenAudio.pause?.(); el.remoteScreenAudio.srcObject = null; }
    el.callBar?.classList.remove('audio-call', 'sharing', 'remote-sharing', 'screen-minimized', 'has-remote', 'has-remote-video', 'call-reconnecting', 'stage-circles', 'stage-grid', 'stage-grid-local-on', 'stage-grid-remote-on');
    el.callBar?.classList.add('hidden');
    resetStageImmersive();
    closeCallContextMenu();
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
            // Nunca cai pro primeiro sender de vídeo "qualquer" como
            // fallback: agora existem DOIS (câmera e tela — ver pcCreate),
            // e pegar o errado botaria a câmera no lugar da apresentação.
            const sender = p.pc._wifiVideoSender;
            if (sender) await sender.replaceTrack(track);
          }
        } else if (state.pc) {
          const sender = state.pc._wifiVideoSender;
          if (sender) await sender.replaceTrack(track);
        }
      }
      state.camEnabled = !state.camEnabled;
      track.enabled = state.camEnabled;
      ensureVideoPreview();
      ensureLocalCameraPip();
      updateCallStageMode();
      // SEXTO motivo raiz possível pra "ligo a câmera e o outro não vê":
      // esse replaceTrack() acontece num transceptor que já existe desde o
      // início da ligação com direction 'sendrecv' (ver addFixedTransceivers/
      // bindFixedTransceivers) — trocar/anexar a track NÃO precisa de uma
      // nova rodada de oferta/resposta pra sair pro outro lado, é só
      // aplicar de verdade no transporte já estabelecido (é literalmente
      // pra isso que replaceTrack existe, ao contrário de remover/adicionar
      // um transceptor novo). O negotiate() manual que tinha aqui podia
      // ficar preso em silêncio (ver comentário grande dentro de
      // negotiate()) sem nenhum erro visível, e como nada mais reenviava a
      // troca depois disso, o outro lado nunca ficava sabendo — mesmo com
      // os bytes certos já saindo desse sender. Trocar dispositivo de
      // câmera (switchDevice) nunca chamou negotiate() e sempre funcionou;
      // tirando essa chamada daqui o "ligar câmera" passa a se comportar
      // exatamente igual.
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

  // O Chrome (e a maioria dos navegadores) simplesmente não sabe capturar
  // áudio quando o que está sendo compartilhado é uma JANELA específica —
  // só funciona pra "tela inteira" ou "aba do navegador". Sem isso, a
  // apresentação ficava sem som mesmo com a caixinha marcada, e a pessoa
  // achava que era bug. Desmarca/desabilita e avisa em vez de deixar a
  // promessa de "compartilhar áudio" quebrada silenciosamente.
  function updateShareAudioAvailability(shareType) {
    const supported = shareType !== 'window';
    if (el.shareSystemAudio) {
      el.shareSystemAudio.disabled = !supported;
      if (!supported) el.shareSystemAudio.checked = false;
      else if (!el.shareSystemAudio.dataset.userTouched) el.shareSystemAudio.checked = true;
    }
    el.shareSystemAudioRow?.classList.toggle('disabled', !supported);
    if (el.shareSystemAudioHint) {
      el.shareSystemAudioHint.textContent = supported
        ? 'O navegador também vai pedir pra marcar "Compartilhar áudio" na própria janela de escolha — sem isso marcado dos dois lados, a apresentação fica muda.'
        : 'Compartilhar áudio não funciona pra uma janela específica — escolha "Tela" ou "Aba" se precisar do som.';
    }
  }

  async function screenShare() {
    if (!state.inCall) return;
    if (state.screenStream) return stopScreen();
    const modal = el.shareModal;
    if (!modal) return startScreenShareWithQuality(720, 'screen', true);
    $('modal-overlay')?.classList.remove('hidden');
    modal.classList.remove('hidden');
    updateShareAudioAvailability(state.shareType || 'screen');
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
      updateShareAudioAvailability(b.dataset.shareTab);
      modal.querySelectorAll('[data-share-tab]').forEach(x => x.classList.toggle('active', x === b));
      modal.querySelectorAll('[data-share-pane]').forEach(x => x.classList.toggle('active', x.dataset.sharePane === b.dataset.shareTab));
      state.shareType = b.dataset.shareTab;
    });
    if (el.shareSystemAudio && !el.shareSystemAudio.dataset.wired) {
      el.shareSystemAudio.dataset.wired = '1';
      el.shareSystemAudio.addEventListener('change', () => { el.shareSystemAudio.dataset.userTouched = '1'; });
    }
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
      const frameRate = wfna ? { ideal: 60, max: 120 } : { ideal: 30, max: 60 };
      const video = { frameRate, cursor: 'motion', width: { ideal: width, max: width }, height: { ideal: height, max: height }, displaySurface: type };
      const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: systemAudio });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('Nenhuma faixa de tela foi fornecida.');
      track.contentHint = 'detail';
      state.screenStream = stream;
      state.shareSystemAudio = systemAudio;

      if (state.groupMode) {
        for (const p of state.groupPeers.values()) {
          // Usa o transceptor DEDICADO de tela (nunca o da câmera — ver
          // pcCreate/createGroupPeer): assim ligar a câmera durante a
          // apresentação não derruba/substitui a transmissão.
          const sender = p.pc._wifiScreenVideoSender;
          if (sender) await sender.replaceTrack(track);
          const sys = stream.getAudioTracks()[0];
          if (sys && p.pc._wifiSystemAudioSender) await p.pc._wifiSystemAudioSender.replaceTrack(sys);
        }
      } else {
        const sender = state.pc?._wifiScreenVideoSender;
        if (!sender) throw new Error('A conexão não possui transceptor de vídeo para a tela.');
        await sender.replaceTrack(track);
        state.screenSender = sender;
        const sys = stream.getAudioTracks()[0];
        if (sys && state.pc?._wifiSystemAudioSender) {
          await state.pc._wifiSystemAudioSender.replaceTrack(sys);
          state.systemAudioSender = state.pc._wifiSystemAudioSender;
        }
        // Mesmo motivo do toggleCam() (ver comentário lá): o transceptor de
        // tela já existe como 'sendrecv' desde o início da ligação
        // (addFixedTransceivers/bindFixedTransceivers), então replaceTrack()
        // sozinho já é suficiente pra tela sair de verdade pro outro lado —
        // não precisa de uma nova oferta/resposta. O negotiate() manual que
        // tinha aqui podia ficar preso em silêncio numa corrida com o
        // 'negotiationneeded' automático do navegador (ver comentário
        // grande dentro de negotiate()), e como nada avisava o outro lado
        // da apresentação começando, ele nunca chegava — apesar dos bytes
        // já estarem saindo certos desse sender.
      }

      el.callBar?.classList.remove('audio-call', 'screen-minimized');
      el.callBar?.classList.add('sharing');
      scheduleStageAutoHide();
      $('call-live-label')?.classList.remove('hidden');
      // Esse selo aparece na tela de QUEM ESTÁ apresentando (a função só é
      // chamada depois que EU cliquei em compartilhar) — antes ele mostrava
      // o nome do amigo aqui, como se fosse o amigo apresentando na minha
      // própria tela, o que não fazia sentido nenhum ("tem um retangulo em
      // pé escrito apresentando usuário" — o texto errado só piorava a
      // confusão junto com o bug de posição).
      if ($('call-live-label')) $('call-live-label').innerHTML = '🔴 Você está apresentando';
      if (el.localVideo) {
        el.localVideo.srcObject = stream;
        el.localVideo.classList.add('is-screen-preview');
        el.localVideo.classList.remove('hidden');
        el.localVideo.muted = true;
        el.localVideo.play?.().catch(() => {});
      }
      ensureLocalCameraPip();
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

    // A câmera nunca saiu do próprio sender (ver startScreenShareWithQuality
    // — agora usa o transceptor dedicado de tela), então não precisa
    // "devolver" nada pra ela aqui: só limpa o sender de tela mesmo.
    if (state.groupMode) {
      for (const p of state.groupPeers.values()) {
        if (p.pc._wifiScreenVideoSender) await p.pc._wifiScreenVideoSender.replaceTrack(null);
        if (p.pc._wifiSystemAudioSender) await p.pc._wifiSystemAudioSender.replaceTrack(null);
      }
    } else if (state.pc) {
      if (state.screenSender) await state.screenSender.replaceTrack(null);
      if (state.systemAudioSender) await state.systemAudioSender.replaceTrack(null);
      state.screenSender = null;
      state.systemAudioSender = null;
      // Sem negotiate() aqui também (mesmo motivo de startScreenShareWithQuality
      // /toggleCam — ver comentários lá): replaceTrack(null) já é suficiente
      // pra track do outro lado voltar a ficar muda (dispara o 'mute' que
      // ontrack usa agora pra saber que a apresentação parou — ver
      // pc.ontrack), sem depender de uma renegociação que podia ficar presa
      // em silêncio.
    }

    if (el.localVideo) {
      el.localVideo.classList.remove('is-screen-preview');
      ensureVideoPreview();
    }
    ensureLocalCameraPip();
    el.callBar?.classList.remove('sharing', 'screen-minimized');
    if (isSharingActive()) scheduleStageAutoHide(); else resetStageImmersive();
    $('call-live-label')?.classList.add('hidden');
    if (state.callType === 'audio' && !el.callBar?.classList.contains('has-remote-video')) el.callBar?.classList.add('audio-call');
    updateButtons();
    window.Sounds?.play('screen-stop');
  }

  // Deixa a câmera de UMA pessoa específica (a minha, a da outra pessoa
  // numa 1:1, ou de alguém numa chamada de servidor) em tela cheia — pede
  // tela cheia no próprio elemento <video>, que é como o navegador já
  // sabe fazer nativamente, em vez de mexer na .call-bar inteira (isso é
  // só pra apresentação de tela — ver fullscreen() acima).
  async function fullscreenVideoElement(videoEl) {
    if (!videoEl || !videoEl.srcObject) return;
    try {
      if (document.fullscreenElement === videoEl) { await document.exitFullscreen(); return; }
      if (document.fullscreenElement) await document.exitFullscreen();
      await (videoEl.requestFullscreen ? videoEl.requestFullscreen() : videoEl.webkitRequestFullscreen?.());
    } catch (_) { window.App?.toast('Tela cheia não está disponível neste navegador.', 'error'); }
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

  function groupStateLabel(pc) {
    const st = pc?.connectionState;
    if (st === 'connected') return 'Conectado';
    if (st === 'disconnected' || st === 'failed') return 'Reconectando';
    return 'Conectando';
  }

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
      // Antes isso vinha sempre com "Conectando" fixo no HTML, então toda
      // vez que outra pessoa entrava/saía da call (o que reconstrói a
      // grade inteira do zero), até quem já estava conectado há tempo
      // voltava a mostrar "Conectando" pra sempre na tela — sem nenhum
      // novo evento de conexão pra corrigir de volta, já que a conexão
      // dele não mudou de estado de verdade. Ler o estado real da conexão
      // aqui resolve isso.
      tile.innerHTML = `<div class="server-call-tile-head"><b>${esc(u.displayName || u.username || 'Usuário')}</b><span class="server-call-tile-state">${groupStateLabel(peer.pc)}</span></div><video autoplay muted playsinline></video><div class="server-call-tile-avatar">${avatarMarkup(u)}</div><div class="server-call-tile-volume-wrap" title="Volume de ${esc(u.displayName || u.username || 'Usuário')}"><span class="server-call-tile-volume-icon">🔊</span><input type="range" class="server-call-tile-volume" min="0" max="100" value="${vol}" aria-label="Volume de ${esc(u.displayName || u.username || 'Usuário')}"></div>`;
      const video = tile.querySelector('video');
      // Mesmo motivo do attachRemoteStream() da chamada 1:1: esse <video> só
      // carrega vídeo (o áudio do participante vem sempre de um <audio>
      // separado — peer.audioStreams), então marcar como "muted" não tira
      // som nenhum de verdade, mas é o que deixa o Chrome/Chromium começar o
      // autoplay sozinho sem precisar de um clique antes.
      video.muted = true;
      video.style.cursor = 'zoom-in';
      video.addEventListener('click', () => fullscreenVideoElement(video));
      if (peer.video) { video.srcObject = peer.video; video.classList.remove('hidden'); retryMediaPlay(video); }
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
    // Mesma ordem fixa de 4 transceptores da chamada 1:1 (ver comentário
    // grande em bindFixedTransceivers/addFixedTransceivers): mic, câmera,
    // áudio-do-sistema, vídeo-da-tela — câmera e tela com sender próprio pra
    // não brigar pelo mesmo slot durante uma apresentação de tela em
    // chamada de servidor/grupo. Quem INICIA (initiator=true) já cria os 4
    // transceptores agora e anexa mic/câmera na hora — não tem oferta
    // remota ainda pra derivar deles. Quem RESPONDE (initiator=false)
    // espera até depois do setRemoteDescription da oferta recebida (ver
    // handleServerOffer) — mesmo motivo da chamada 1:1: transceptor
    // pré-criado antes de aplicar uma oferta recebida fica órfão nesta
    // versão do Chrome, e era por isso que quem RESPONDIA numa chamada de
    // grupo também nunca transmitia nada de verdade pros outros
    // participantes.
    if (initiator) {
      addFixedTransceivers(pc);
      const audio = state.localStream?.getAudioTracks()[0];
      const video = state.localStream?.getVideoTracks()[0];
      if (pc._wifiAudioSender) pc._wifiAudioSender.replaceTrack(audio || null).catch(() => {});
      if (pc._wifiVideoSender) pc._wifiVideoSender.replaceTrack(video || null).catch(() => {});
    }
    state.groupPeers.set(id, peer);

    pc.onicecandidate = e => {
      if (e.candidate) window.ChatSocket?.sendServerCallIce?.({ toUserId: Number(id), serverId: state.groupServerId, channelId: state.groupChannelId, candidate: e.candidate });
    };
    pc.ontrack = e => {
      if (e.track.kind === 'video') {
        // Câmera e apresentação de tela agora chegam em transceptores
        // separados (ver comentário acima), então nunca mais uma sobrescreve
        // a outra no sender de quem envia — mas a grade de chamada de
        // servidor ainda mostra só UM vídeo por participante (peer.video),
        // priorizando a tela quando as duas estiverem ativas ao mesmo
        // tempo, igual o palco principal da chamada 1:1.
        const slot = fixedSlotIndex(pc, e.transceiver);
        const isScreen = slot === 3 || (slot === -1 && e.receiver === pc._wifiScreenVideoReceiver);
        if (!(peer.video instanceof MediaStream)) peer.video = new MediaStream();
        const track = e.track;
        // Mesmo bug de raiz da chamada 1:1 (ver comentário grande em
        // pc.ontrack lá em cima): os 4 slots são fixos e existem desde o
        // início da ligação, então esse ontrack do slot de tela dispara pra
        // TODO participante, mesmo quando ninguém nunca compartilhou nada —
        // só que aqui, como "peer.screenTrack" sempre ganhava de
        // "peer.cameraTrack" na hora de escolher o que mostrar, a câmera do
        // participante nunca aparecia na grade da chamada de servidor,
        // travada atrás de um slot de tela vazio pra sempre (transceptor
        // fixo não é removido quando ninguém compartilha, então 'ended'
        // quase nunca disparava pra "liberar" a câmera de novo). Só conta
        // como tela/câmera "ativa" de verdade a partir do 'unmute' (frames
        // de verdade chegando), e volta a null no 'mute' (é o que acontece
        // quando quem compartilhava faz replaceTrack(null) ao parar).
        const setActive = active => {
          if (isScreen) peer.screenTrack = active ? track : null;
          else peer.cameraTrack = active ? track : null;
          // Mostra a tela quando ela existir, senão a câmera — nunca as duas
          // juntas na mesma tile (a grade de servidor só tem um <video> por
          // participante).
          const showTrack = peer.screenTrack || peer.cameraTrack || null;
          peer.video.getVideoTracks().forEach(t => { if (t !== showTrack) peer.video.removeTrack(t); });
          if (showTrack && !peer.video.getTracks().some(t => t.id === showTrack.id)) peer.video.addTrack(showTrack);
          renderGroupTiles();
        };
        track.onunmute = () => setActive(true);
        track.onmute = () => setActive(false);
        track.onended = () => setActive(false);
        if (!track.muted) setActive(true);
      } else {
        // Mic e áudio-do-sistema (som de apresentação de tela) chegam em
        // transceptores separados aqui também (mesma ideia da chamada 1:1 —
        // ver comentário grande em pc.ontrack lá em cima), então o volume da
        // apresentação de alguém não fica preso junto ao volume da voz dela.
        const slot = fixedSlotIndex(pc, e.transceiver);
        const isSystemAudio = slot === 2 || (slot === -1 && e.receiver === pc._wifiSystemAudioReceiver);
        const stream = e.streams?.[0] instanceof MediaStream ? e.streams[0] : new MediaStream([e.track]);
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true; audioEl.playsInline = true; audioEl.srcObject = stream;
        audioEl.volume = isSystemAudio ? combinedScreenVolume(id) : combinedVolume(id);
        audioEl.muted = state.headphonesOff;
        audioEl.dataset.callPeer = id;
        audioEl.dataset.callPeerKind = isSystemAudio ? 'screen' : 'mic';
        document.body.appendChild(audioEl); peer.audioStreams.push(audioEl); retryMediaPlay(audioEl);
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      const tile = el.serverCallGrid?.querySelector(`[data-user-id="${CSS.escape(id)}"] .server-call-tile-state`);
      if (tile) tile.textContent = groupStateLabel(pc);
      if (st === 'connected') {
        peer.reconnectAttempts = 0;
        clearTimeout(peer.reconnectTimer); peer.reconnectTimer = null;
        clearTimeout(peer.connectWatchdog); peer.connectWatchdog = null;
      }
      // "disconnected" costuma ser passageiro (oscilação de rede) — tenta
      // reconectar em vez de derrubar o participante da chamada na hora,
      // igual já é feito na chamada 1:1 (ver scheduleReconnect).
      if (st === 'disconnected') scheduleGroupReconnect(id, peer, false);
      if (st === 'failed') scheduleGroupReconnect(id, peer, true);
      if (st === 'closed') removeGroupPeer(id);
    };

    // Às vezes a checagem de ICE trava sem NUNCA emitir 'disconnected' nem
    // 'failed' (fica presa em 'connecting'/'new' pra sempre, geralmente
    // NAT/firewall restritivo) — sem isso, essa pessoa ficava mostrando
    // "Conectando" pra sempre sem nenhum evento que dispare uma nova
    // tentativa. Esse temporizador força a reconexão se não conectar a
    // tempo, mesmo sem nenhum evento de mudança de estado.
    peer.connectWatchdog = setTimeout(() => {
      peer.connectWatchdog = null;
      if (!state.groupMode || !state.groupPeers.has(id)) return;
      if (pc.connectionState !== 'connected') scheduleGroupReconnect(id, peer, true);
    }, 12000);

    if (initiator) {
      pc.createOffer().then(o => pc.setLocalDescription(sanitizeDescription(o))).then(() => window.ChatSocket?.sendServerCallOffer?.({ toUserId: Number(id), serverId: state.groupServerId, channelId: state.groupChannelId, callType: state.groupType, sdp: pc.localDescription })).catch(console.error);
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
        const name = groupUser(id)?.displayName || groupUser(id)?.username || 'Um participante';
        window.App?.toast(`${name}: não foi possível manter a conexão na chamada.`, 'error');
        removeGroupPeer(id);
        return;
      }
      peer.reconnectAttempts += 1;
      try {
        if (forceIceRestart || peer.pc.connectionState === 'failed' || peer.pc.connectionState === 'disconnected') {
          const offer = sanitizeDescription(await peer.pc.createOffer({ iceRestart: true }));
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
    clearTimeout(peer.connectWatchdog);
    try { peer.pc.close(); } catch (_) {}
    peer.audioStreams?.forEach(a => a.remove());
    state.groupPeers.delete(String(id));
    renderGroupTiles();
  }

  async function startServerCall(serverId, channelId, type) {
    if (state.inCall) return;
    // Sincrono, ainda dentro da pilha do toque que chamou esta função —
    // ver comentário grande perto de primeAudioPlayback(). Precisa vir
    // ANTES do primeiro await, senão já não conta mais como gesto do
    // usuário pro navegador.
    primeAudioPlayback();
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
      // Só agora existem os transceptores de verdade (ver o comentário
      // grande em bindFixedTransceivers) — pega eles e SÓ ENTÃO anexa
      // mic/câmera, em vez de fazer isso em createGroupPeer() antes do
      // setRemoteDescription (o que deixava esse participante transmitindo
      // pra transceptores órfãos que nunca chegavam nos outros).
      bindFixedTransceivers(peer.pc);
      const audio = state.localStream?.getAudioTracks()[0];
      const video = state.localStream?.getVideoTracks()[0];
      if (peer.pc._wifiAudioSender) peer.pc._wifiAudioSender.replaceTrack(audio || null).catch(() => {});
      if (peer.pc._wifiVideoSender) peer.pc._wifiVideoSender.replaceTrack(video || null).catch(() => {});
      for (const c of peer.pending || []) { try { await peer.pc.addIceCandidate(c); } catch (_) {} }
      peer.pending = [];
      const answer = sanitizeDescription(await peer.pc.createAnswer());
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
      window.Sounds?.stopLoop();
    }
    if (state.inCall && (!data || String(data.fromUserId) === String(state.targetUserId))) endCall(false);
    // Rede de segurança (ver reject()): garante que a barra de chamada não
    // fique presa na tela se, por qualquer motivo, nenhuma das condições
    // acima bateu mas já não há chamada nem convite pendente em andamento.
    if (!state.inCall && !state.pendingOffer) el.callBar?.classList.add('hidden');
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
      if (el.remoteScreenAudio) el.remoteScreenAudio.muted = state.headphonesOff;
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
    bindCallContextMenu();
    // Clicar na transmissão (não na câmera normal) entra/sai do modo
    // imersivo — ver setStageImmersive/toggleStageImmersive acima e o CSS
    // .stage-immersive no final do style.css. Clicar numa câmera normal
    // (sem apresentação rolando) deixa ELA em tela cheia.
    el.remoteVideo?.addEventListener('click', () => { if (state.remoteScreenActive) toggleStageImmersive(); else fullscreenVideoElement(el.remoteVideo); });
    el.localVideo?.addEventListener('click', () => { if (state.screenStream) toggleStageImmersive(); else fullscreenVideoElement(el.localVideo); });
    el.remoteCameraPip?.addEventListener('click', e => { e.stopPropagation(); fullscreenVideoElement(el.remoteCameraPip); });
    el.localCameraPip?.addEventListener('click', e => { e.stopPropagation(); fullscreenVideoElement(el.localCameraPip); });
    el.stageImmersiveToggle?.addEventListener('click', e => { e.stopPropagation(); toggleStageImmersive(); });
    document.addEventListener('fullscreenchange', () => { state.fullscreen = !!document.fullscreenElement; });
    navigator.mediaDevices?.addEventListener?.('devicechange', () => window.Settings?.refreshDevices?.());
  }

  function init() { cache(); bind(); updateButtons(); iceConfigPromise = loadIceConfig(); }

  // Helper de diagnóstico pra rodar no console (F12) quando uma chamada não
  // está mostrando vídeo: mostra o estado da conexão, os transceivers e as
  // estatísticas reais de bytes recebidos (getStats). Não muda nada, só lê.
  async function debugDump() {
    const out = { groupMode: state.groupMode };
    async function dumpPc(label, pc) {
      if (!pc) { console.log(`[WifiCord/debug] ${label}: sem RTCPeerConnection`); return; }
      const info = {
        signalingState: pc.signalingState,
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
        iceGatheringState: pc.iceGatheringState,
      };
      console.log(`[WifiCord/debug] ${label} estado:`, info);
      const transceivers = pc.getTransceivers().map((t, i) => ({
        idx: i,
        mid: t.mid,
        direction: t.direction,
        currentDirection: t.currentDirection,
        kind: t.receiver?.track?.kind,
        trackMuted: t.receiver?.track?.muted,
        trackReadyState: t.receiver?.track?.readyState,
      }));
      console.log(`[WifiCord/debug] ${label} transceivers:`, transceivers);
      try {
        const stats = await pc.getStats();
        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && !report.isRemote) {
            console.log(`[WifiCord/debug] ${label} inbound-rtp (${report.kind}):`, {
              bytesReceived: report.bytesReceived,
              packetsReceived: report.packetsReceived,
              framesReceived: report.framesReceived,
              framesDecoded: report.framesDecoded,
              framesDropped: report.framesDropped,
              packetsLost: report.packetsLost,
              jitter: report.jitter,
            });
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            console.log(`[WifiCord/debug] ${label} candidate-pair ativo:`, {
              localCandidateId: report.localCandidateId,
              remoteCandidateId: report.remoteCandidateId,
              currentRoundTripTime: report.currentRoundTripTime,
            });
          }
        });
      } catch (e) {
        console.log(`[WifiCord/debug] ${label} getStats falhou:`, e?.message);
      }
    }
    if (state.groupMode) {
      console.log('[WifiCord/debug] chamada em grupo, peers:', state.groupPeers.size);
      for (const [uid, peer] of state.groupPeers.entries()) {
        await dumpPc(`peer ${uid}`, peer.pc);
      }
    } else {
      await dumpPc('1:1', state.pc);
    }
    console.log('[WifiCord/debug] remoteScreenActive:', state.remoteScreenActive, 'camOn:', state.camOn, 'screenStream:', !!state.screenStream);
    return out;
  }
  window.wcCallDebug = debugDump;

  window.Call = {
    init, handleOffer, handleAnswer: answer, handleIceCandidate: ice, handleHangup,
    handleSpeaking: remoteSpeaking, updateCallButtonsState: updateButtons,
    getState: () => state, applyAdminVoiceMute, endFromAdmin, syncContext,
    startServerCall, handleServerOffer, handleServerAnswer, handleServerIce,
    handleServerUserJoined, handleServerUserLeft, debugDump
  };
})();
