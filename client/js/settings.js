// Device settings used by WebRTC calls.
(function () {
  'use strict';

  const KEY = 'wificord-media-settings';
  const state = {
    audioDeviceId: '',
    videoDeviceId: '',
    audioOutputDeviceId: '',
  };

  function load() {
    try {
      Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch (_) {}
  }

  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

  async function saveServerSettings(patch){ try { const r=await fetch('/api/auth/settings',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}); const d=await r.json(); if(r.ok&&d.user) window.App?.handleProfileUpdate?.({user:d.user}); } catch(_){} }

  async function enumerate() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try { return await navigator.mediaDevices.enumerateDevices(); } catch (_) { return []; }
  }

  function fillSelect(id, devices, kind, selected) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '';
    devices.filter(d => d.kind === kind).forEach((device, i) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `${kind === 'audioinput' ? 'Microfone' : kind === 'videoinput' ? 'Câmera' : 'Saída de áudio'} ${i + 1}`;
      select.appendChild(option);
    });
    if (selected && [...select.options].some(o => o.value === selected)) select.value = selected;
  }

  async function refreshDevices() {
    const devices = await enumerate();
    fillSelect('settings-microphone', devices, 'audioinput', state.audioDeviceId);
    fillSelect('settings-camera', devices, 'videoinput', state.videoDeviceId);
    fillSelect('settings-output', devices, 'audiooutput', state.audioOutputDeviceId);
    return devices;
  }

  function getMediaSettings() {
    return { ...state };
  }

  async function previewCamera() {
    const video = document.getElementById('settings-camera-preview');
    if (!video || !navigator.mediaDevices?.getUserMedia) return;
    stopPreview();

    const constraints = state.videoDeviceId
      ? { video: { deviceId: { exact: state.videoDeviceId }, width: { ideal: 640 }, height: { ideal: 360 } }, audio: false }
      : { video: true, audio: false };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      video.play?.().catch(() => {});
      video.dataset.previewActive = '1';
    } catch (err) {
      window.App?.toast('Não foi possível acessar a câmera.', 'error');
    }
  }

  function stopPreview() {
    const video = document.getElementById('settings-camera-preview');
    if (!video?.srcObject) return;
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    delete video.dataset.previewActive;
  }

  async function testMicrophone() {
    const status = document.getElementById('settings-mic-test-status');
    const meter = document.getElementById('settings-mic-meter');
    const button = document.getElementById('settings-test-mic');
    const setLevel = value => {
      if (!meter) return;
      const n = Math.max(0, Math.min(100, Number(value) || 0));
      meter.style.setProperty('--level', `${n}%`);
      meter.setAttribute('aria-valuenow', String(Math.round(n)));
    };
    if (status) status.textContent = 'Solicitando acesso ao microfone…';
    if (button) { button.disabled = true; button.textContent = 'Testando…'; }
    setLevel(0);

    let stream = null;
    let ctx = null;
    let source = null;
    let analyser = null;
    let raf = 0;
    let stopTimer = 0;
    let deviceChangeHandler = null;
    try {
      if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        throw new Error('O teste do microfone exige localhost ou HTTPS.');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Seu navegador não disponibiliza acesso ao microfone neste contexto. Use localhost/HTTPS.');
      }

      const audio = state.audioDeviceId
        ? { deviceId: { exact: state.audioDeviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 };
      stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('Nenhuma faixa de áudio foi criada.');
      track.enabled = true;

      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio não está disponível neste navegador.');
      ctx = new AC();
      await ctx.resume();

      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.08;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      source.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);
      const started = performance.now();
      let sawSignal = false;
      let lastLevel = 0;
      let lastTrackState = '';
      let mutedSince = 0;
      let mutedWarned = false;

      deviceChangeHandler = () => {
        // A troca/mute físico do dispositivo pode alterar a faixa fornecida pelo driver.
        // Atualizamos os dispositivos sem interromper o teste.
        refreshDevices().catch(() => {});
      };
      navigator.mediaDevices?.addEventListener?.('devicechange', deviceChangeHandler);

      if (status) status.textContent = 'Microfone capturando em tempo real. Fale, fique em silêncio ou mute o microfone para conferir o nível.';

      const frame = now => {
        if (!analyser || !stream) return;
        analyser.getByteTimeDomainData(data);

        let sum = 0;
        let peak = 0;
        for (const v of data) {
          const n = (v - 128) / 128;
          const a = Math.abs(n);
          sum += n * n;
          if (a > peak) peak = a;
        }
        const rms = Math.sqrt(sum / data.length);
        // Não usamos um piso artificial: silêncio/mute precisa resultar em 0%.
        // O pequeno gate evita que ruído elétrico residual pareça voz.
        const gated = rms < 0.012 ? 0 : Math.max(0, rms - 0.012);
        const normalized = Math.min(1, gated / 0.20);
        const instantaneous = Math.round(normalized * 100);
        const level = Math.round(lastLevel * 0.72 + instantaneous * 0.28);
        lastLevel = level;
        if (level >= 4 || peak >= 0.08) sawSignal = true;
        setLevel(level);

        // MediaStreamTrack.muted é uma flag do navegador que pode vir "true"
        // momentaneamente logo após o getUserMedia() (antes do primeiro frame real
        // chegar), sem que o microfone esteja de fato mutado. Só tratamos como
        // silenciado de verdade se a flag ficar persistente por um tempo mínimo
        // E nenhum sinal de áudio real tiver sido detectado nesse intervalo.
        if (track.muted && level < 3) {
          if (!mutedSince) mutedSince = now;
          if (!mutedWarned && now - mutedSince > 700) {
            mutedWarned = true;
            if (status) status.textContent = 'O navegador marcou o microfone como silenciado. Desative o mute físico e fale para testar novamente.';
          }
        } else {
          mutedSince = 0;
          mutedWarned = false;
        }

        const trackState = `${track.readyState}:${track.enabled}`;
        if (trackState !== lastTrackState) {
          lastTrackState = trackState;
          if (track.readyState === 'ended') {
            if (status) status.textContent = 'O dispositivo de microfone parou de fornecer áudio. Verifique o mute físico ou o dispositivo selecionado.';
            setLevel(0);
          }
        }

        if (now - started < 10000) {
          raf = requestAnimationFrame(frame);
        } else {
          cleanup();
          if (setLevel) setLevel(0);
          if (status) status.textContent = sawSignal
            ? 'Teste concluído: houve sinal de áudio. O medidor deve zerar quando o microfone estiver em silêncio/mutado.'
            : 'Teste concluído: nenhum sinal detectável. Verifique o mute físico, as permissões do navegador e o microfone selecionado.';
          if (button) { button.disabled = false; button.textContent = 'Testar microfone'; }
        }
      };

      const cleanup = () => {
        cancelAnimationFrame(raf);
        clearTimeout(stopTimer);
        if (deviceChangeHandler) navigator.mediaDevices?.removeEventListener?.('devicechange', deviceChangeHandler);
        try { source?.disconnect(); } catch (_) {}
        try { analyser?.disconnect(); } catch (_) {}
        try { stream?.getTracks().forEach(t => t.stop()); } catch (_) {}
        try { if (ctx && ctx.state !== 'closed') ctx.close(); } catch (_) {}
        stream = null; source = null; analyser = null; ctx = null; deviceChangeHandler = null;
      };

      // Keep a hard stop even if requestAnimationFrame is throttled in a background tab.
      stopTimer = setTimeout(() => {
        if (!stream) return;
        cleanup();
        setLevel(0);
        if (status) status.textContent = 'Teste concluído. Verifique o nível acima para confirmar a entrada.';
        if (button) { button.disabled = false; button.textContent = 'Testar microfone'; }
      }, 10000);

      // Start immediately so the first frame reflects the real input rather than a fake floor.
      raf = requestAnimationFrame(frame);
    } catch (err) {
      if (stream) { try { stream.getTracks().forEach(t => t.stop()); } catch (_) {} }
      if (ctx) { try { await ctx.close(); } catch (_) {} }
      setLevel(0);
      if (status) status.textContent = err.message || 'Não foi possível acessar o microfone.';
      window.App?.toast(err.message || 'Não foi possível acessar o microfone.', 'error');
      if (button) { button.disabled = false; button.textContent = 'Testar microfone'; }
    }
  }

  async function applyOutput(video) {
    const id = state.audioOutputDeviceId;
    if (!id || !video || typeof video.setSinkId !== 'function') return;
    try { await video.setSinkId(id); } catch (_) {}
  }

  function bind() {
    const mic = document.getElementById('settings-microphone');
    const cam = document.getElementById('settings-camera');
    const output = document.getElementById('settings-output');

    mic?.addEventListener('change', () => { state.audioDeviceId = mic.value; save(); });
    cam?.addEventListener('change', () => { state.videoDeviceId = cam.value; save(); previewCamera(); });
    output?.addEventListener('change', () => { state.audioOutputDeviceId = output.value; save(); applyOutput(document.getElementById('remote-video')); applyOutput(document.getElementById('remote-audio')); });

    document.getElementById('settings-refresh-devices')?.addEventListener('click', refreshDevices);
    document.getElementById('settings-preview-camera')?.addEventListener('click', previewCamera);
    document.getElementById('settings-test-mic')?.addEventListener('click', testMicrophone);

    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', stopPreview);
    });

    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
  }

  async function init() {
    load();
    bind();
    await refreshDevices();
  }

  window.Settings = {
    init,
    refreshDevices,
    getMediaSettings,
    applyOutput,
    stopPreview,
  };
})();
