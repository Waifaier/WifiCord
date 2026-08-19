(function () {
  'use strict';
  const KEY = 'wificord-sounds';
  let enabled = localStorage.getItem(KEY) !== 'off';
  let ctx = null;

  function setEnabled(value) {
    enabled = !!value;
    localStorage.setItem(KEY, enabled ? 'on' : 'off');
  }

  function play(type) {
    if (!enabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ctx = ctx || new AudioCtx();
      if(ctx.state==='suspended') ctx.resume().catch(()=>{});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const freq = type === 'call-incoming' ? 660 : type === 'call-join' ? 520 : type === 'call-leave' ? 360 : type === 'screen-start' ? 820 : type === 'screen-stop' ? 460 : type === 'message' ? 740 : 420;
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
      osc.addEventListener('ended', () => {});
    } catch (_) {}
  }

  window.Sounds = { play, isEnabled: () => enabled, setEnabled };
})();
