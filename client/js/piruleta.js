// client/js/piruleta.js
// Easter egg isolado: aba "???" nas configurações + botão que faz o avatar
// pular/girar em tempo real para todos na conversa. Usa o Socket.IO já
// existente (window.ChatSocket.socket) — não cria nenhum canal novo.
(function () {
  'use strict';

  const PASSWORD = 'piruleta';
  const UNLOCK_KEY = 'wificord-piruleta-unlocked';
  const DISABLED_KEY = 'wificord-piruleta-disabled';
  const EVENT = 'piruleta:trigger';

  function isUnlocked() { return localStorage.getItem(UNLOCK_KEY) === '1'; }
  function isDisabled() { return localStorage.getItem(DISABLED_KEY) === '1'; }

  function refreshButton() {
    const btn = document.getElementById('piruleta-btn');
    if (btn) btn.classList.toggle('hidden', !isUnlocked() || isDisabled());
  }

  function refreshTab() {
    const locked = document.getElementById('piruleta-locked-box');
    const unlocked = document.getElementById('piruleta-unlocked-box');
    const active = isUnlocked() && !isDisabled();
    if (locked) locked.classList.toggle('hidden', active);
    if (unlocked) unlocked.classList.toggle('hidden', !active);
  }

  function tryUnlock() {
    const input = document.getElementById('piruleta-password-input');
    const error = document.getElementById('piruleta-error');
    const value = input ? input.value : '';
    if (value.length === 8 && value === PASSWORD) {
      localStorage.setItem(UNLOCK_KEY, '1');
      localStorage.removeItem(DISABLED_KEY);
      if (input) input.value = '';
      if (error) error.classList.add('hidden');
      refreshTab();
      refreshButton();
    } else if (error) {
      error.classList.remove('hidden');
    }
  }

  function disable() {
    localStorage.setItem(DISABLED_KEY, '1');
    refreshTab();
    refreshButton();
  }

  function conversationPayload(state) {
    if (state.activeChannelId) return { channelId: state.activeChannelId };
    if (state.activeDMUserId) return { toUserId: state.activeDMUserId };
    return null;
  }

  function animateAvatarsForUser(userId, state) {
    if (!userId) return;
    const nodes = Array.from(document.querySelectorAll(
      '.message-item[data-message-author-id="' + String(userId).replace(/"/g, '') + '"] .message-avatar'
    ));
    if (state && state.currentUser && String(state.currentUser.id) === String(userId)) {
      const own = document.getElementById('current-user-avatar');
      if (own) nodes.push(own);
    }
    nodes.forEach(function (node) {
      node.classList.remove('piruleta-jump');
      void node.offsetWidth; // reinicia a animação se já estiver rodando
      node.classList.add('piruleta-jump');
      setTimeout(function () { node.classList.remove('piruleta-jump'); }, 2800);
    });
  }

  function triggerLocal() {
    if (!isUnlocked() || isDisabled()) return;
    if (!window.App || !window.App.getState) return;
    const state = window.App.getState();
    if (!state || !state.currentUser) return;
    const payload = conversationPayload(state);
    if (!payload) return;
    animateAvatarsForUser(state.currentUser.id, state);
    if (window.ChatSocket && window.ChatSocket.socket) {
      window.ChatSocket.socket.emit(EVENT, Object.assign({}, payload, { userId: state.currentUser.id }));
    }
  }

  function handleIncoming(data) {
    if (!data || !data.userId || !window.App || !window.App.getState) return;
    const state = window.App.getState();
    if (!state) return;
    if (state.currentUser && String(data.userId) === String(state.currentUser.id)) return; // já animado localmente
    const belongsToChannel = data.channelId && String(data.channelId) === String(state.activeChannelId);
    const belongsToDM = !data.channelId && state.activeDMUserId && String(state.activeDMUserId) === String(data.userId);
    if (!belongsToChannel && !belongsToDM) return;
    animateAvatarsForUser(data.userId, state);
  }

  let subscribedSocket = null;
  function ensureSubscribed() {
    const socket = window.ChatSocket && window.ChatSocket.socket;
    if (socket && socket !== subscribedSocket) {
      socket.on(EVENT, handleIncoming);
      subscribedSocket = socket;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    refreshTab();
    refreshButton();

    document.getElementById('piruleta-unlock-btn')?.addEventListener('click', tryUnlock);
    document.getElementById('piruleta-password-input')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') tryUnlock();
    });
    document.getElementById('piruleta-disable-btn')?.addEventListener('click', disable);
    document.getElementById('piruleta-btn')?.addEventListener('click', triggerLocal);

    ensureSubscribed();
    setInterval(ensureSubscribed, 1000);
  });
})();
