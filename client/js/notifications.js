// client/js/notifications.js
// Notificação nativa de mensagem nova — funciona mesmo com o app em segundo
// plano (app desktop escondido na bandeja, ver desktop-app/main.js) ou numa
// aba de navegador sem foco (Notification do próprio navegador). Não
// depende de nenhum serviço de push (Firebase etc.): nos dois casos o
// socket da pessoa continua conectado normalmente enquanto o app só está em
// segundo plano — isso aqui só reaproveita esse socket já existente pra
// disparar a notificação assim que a mensagem chega.
(function () {
  'use strict';

  const isElectron = !!(window.wificordDesktop && typeof window.wificordDesktop.showNotification === 'function');
  let browserPermissionAsked = false;

  function ensureBrowserPermission() {
    if (isElectron || typeof Notification === 'undefined') return;
    if (Notification.permission === 'default' && !browserPermissionAsked) {
      browserPermissionAsked = true;
      Notification.requestPermission().catch(() => {});
    }
  }
  // Navegador exige um gesto do usuário pra liberar a permissão — tenta no
  // carregamento (caso já tenha sido concedida antes) e garante que pede de
  // verdade no primeiro clique, caso ainda não tenha decidido.
  document.addEventListener('DOMContentLoaded', ensureBrowserPermission);
  document.addEventListener('click', ensureBrowserPermission, { once: true });

  function contentPreview(content) {
    const raw = String(content || '');
    if (raw.startsWith('__MEDIA__:')) return '📎 Enviou um arquivo';
    if (raw.startsWith('__STICKER__:')) return '✨ Enviou uma figurinha';
    if (raw.startsWith('__SUPER__:')) return '✨ Enviou um super emoji';
    return raw.length > 160 ? raw.slice(0, 157) + '…' : raw;
  }

  function formatTime(iso) {
    try {
      const parse = window.App && window.App.parseServerDate;
      const d = parse ? parse(iso) : new Date(iso);
      if (!d || Number.isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  function isViewingConversation(msg, kind) {
    const st = window.App && window.App.getState && window.App.getState();
    if (!st) return false;
    if (kind === 'channel') return String(st.activeChannelId) === String(msg.channelId);
    return String(st.activeDMUserId) === String(msg.author && msg.author.id);
  }

  function shouldNotify(msg, kind) {
    const st = window.App && window.App.getState && window.App.getState();
    const me = st && st.currentUser;
    if (!me || !msg || !msg.author) return false;
    if (String(msg.author.id) === String(me.id)) return false; // própria mensagem, ecoada pelo servidor
    // Já está vendo essa conversa AO VIVO (janela em foco) — a mensagem já
    // aparece na tela na hora, não precisa também notificar.
    if (typeof document.hasFocus === 'function' && document.hasFocus() && isViewingConversation(msg, kind)) return false;
    return true;
  }

  function conversationLabel(msg, kind) {
    if (kind !== 'channel') return null;
    if (msg.channelName) return '#' + msg.channelName;
    const st = window.App && window.App.getState && window.App.getState();
    const channel = st && (st.channels || []).find(function (c) { return String(c.id) === String(msg.channelId); });
    return channel ? '#' + (channel.name || 'canal') : null;
  }

  function buildTarget(msg, kind) {
    if (kind === 'dm') return { kind: 'dm', userId: msg.author.id };
    return { kind: 'channel', channelId: msg.channelId, serverId: msg.serverId || null };
  }

  function goToTarget(target) {
    if (!target || !window.App) return;
    if (target.kind === 'dm') {
      window.App.openDM && window.App.openDM(target.userId);
    } else if (target.kind === 'channel') {
      const openChannel = function () { window.App.openChannel && window.App.openChannel(target.channelId); };
      if (target.serverId && window.App.openServer) {
        Promise.resolve(window.App.openServer(target.serverId)).then(openChannel);
      } else {
        openChannel();
      }
    }
  }

  function handleIncoming(msg, kind) {
    if (!shouldNotify(msg, kind)) return;
    const senderName = (msg.author.displayName || msg.author.username || 'Alguém');
    const label = conversationLabel(msg, kind);
    const title = label ? senderName + ' em ' + label : senderName;
    const time = formatTime(msg.createdAt);
    const body = (time ? time + ' · ' : '') + contentPreview(msg.content);
    const target = buildTarget(msg, kind);

    if (isElectron) {
      window.wificordDesktop.showNotification({ title: title, body: body, target: target });
      return;
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, { body: body, icon: '/assets/logo.svg', tag: 'wificord-message' });
      n.onclick = function () {
        try { window.focus(); } catch (_) {}
        goToTarget(target);
        n.close();
      };
    } catch (_) { /* navegador sem suporte real a Notification (raro) — ignora silenciosamente */ }
  }

  if (window.wificordDesktop && typeof window.wificordDesktop.onNotificationClicked === 'function') {
    window.wificordDesktop.onNotificationClicked(function (target) { goToTarget(target); });
  }

  window.WCNotify = { handleIncoming: handleIncoming };
})();
