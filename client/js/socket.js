// client/js/socket.js
// Wrapper fino sobre o cliente Socket.IO. Delega eventos recebidos para
// window.App, que sabe como atualizar a interface.

(function () {
  'use strict';

  const ChatSocket = {
    socket: null,

    connect() {
      if (this.socket) return this.socket;

      this.socket = io(); // mesma origem: cookies de sessão são enviados automaticamente

      this.socket.on('connect', function () {
        if (window.App && window.App.refreshFriendsRealtime) window.App.refreshFriendsRealtime();
      });

      this.socket.on('connect_error', function (err) {
        // Socket.IO tenta reconectar sozinho. Não bloqueamos mensagens/DMs por isso.
        console.error('Socket connect_error:', err && err.message ? err.message : err);
      });

      this.socket.on('reconnect', function () {
        if (window.App && window.App.refreshFriendsRealtime) window.App.refreshFriendsRealtime();
      });

      this.socket.on('channel:message', function (msg) {
        if (window.App) window.App.handleIncomingMessage(msg, 'channel');
      });

      this.socket.on('dm:message', function (msg) {
        if (window.App) window.App.handleIncomingMessage(msg, 'dm');
      });

      this.socket.on('typing:start', function (data) {
        if (window.App) window.App.handleTyping(data, true);
      });

      this.socket.on('typing:stop', function (data) {
        if (window.App) window.App.handleTyping(data, false);
      });

      this.socket.on('presence:update', function (data) {
        if (window.App) window.App.handlePresenceUpdate(data);
      });

      // Sinalização de chamada de voz/vídeo (WebRTC). O servidor apenas
      // repassa estes eventos; a mídia em si trafega P2P entre os clientes.
      this.socket.on('call:offer', function (data) {
        if (window.Call) window.Call.handleOffer(data);
      });
      this.socket.on('call:answer', function (data) {
        if (window.Call) window.Call.handleAnswer(data);
      });
      this.socket.on('call:ice-candidate', function (data) {
        if (window.Call) window.Call.handleIceCandidate(data);
      });
      this.socket.on('call:hangup', function (data) {
        if (window.Call) window.Call.handleHangup(data);
      });
      this.socket.on('call:speaking', function (data) { if (window.Call?.handleSpeaking) window.Call.handleSpeaking(data); });
      this.socket.on('server-call:offer', d=>window.Call?.handleServerOffer?.(d));
      this.socket.on('server-call:answer', d=>window.Call?.handleServerAnswer?.(d));
      this.socket.on('server-call:ice', d=>window.Call?.handleServerIce?.(d));
      this.socket.on('server-call:user-joined', d=>window.Call?.handleServerUserJoined?.(d));
      this.socket.on('server-call:user-left', d=>window.Call?.handleServerUserLeft?.(d));

      this.socket.on('message:deleted', function (data) {
        if (window.App) window.App.handleMessageDeleted(data);
      });

      this.socket.on('message:reaction', function (data) {
        if (window.App) window.App.handleMessageReaction(data);
      });

      this.socket.on('friend:request:update', function () { if (window.App) window.App.refreshFriendsRealtime(); });
      this.socket.on('server:profile:update', function(d){ window.App?.handleServerProfileUpdate?.(d?.server); });
      this.socket.on('server:members:update', async function (d) { if (!d?.serverId || !window.App?.getState) return; const s=window.App.getState(); if(String(s.activeServerId)!==String(d.serverId)) return; try { const r=await fetch('/api/servers/'+encodeURIComponent(d.serverId)+'/members',{credentials:'same-origin'}); const data=await r.json(); if(r.ok) window.App.setServerMembers(data); } catch(_){} });
      this.socket.on('server:channels:update', async function(d){ if(!d?.serverId||!window.App?.getState) return; const s=window.App.getState(); if(String(s.activeServerId)!==String(d.serverId)) return; try{await window.App.openServer(d.serverId);}catch(_){} });

      this.socket.on('profile:update', function (data) {
        if (window.App) window.App.handleProfileUpdate(data);
      });

      this.socket.on('admin:voice-mute', d=>window.Call?.applyAdminVoiceMute?.(d));
      this.socket.on('admin:chat-mute', d=>window.App?.applyAdminChatMute?.(d));
      this.socket.on('admin:punish', d=>window.App?.applyAdminPunish?.(d));
      this.socket.on('admin:ban', d=>window.App?.applyAdminBan?.(d));
      this.socket.on('admin:unban', d=>window.App?.applyAdminUnban?.(d));
      this.socket.on('admin:rainbow', d=>window.App?.applyAdminRainbow?.(d));
      this.socket.on('admin:scare', d=>window.App?.applyAdminScare?.(d));
      this.socket.on('admin:effect', d=>window.App?.applyAdminEffect?.(d));
      this.socket.on('admin:disconnect-call', ()=>window.Call?.endFromAdmin?.());
      this.socket.on('admin:clear', ()=>window.App?.applyAdminClear?.());

      return this.socket;
    },

    disconnect() {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
    },

    joinServer(serverId) {
      if (this.socket) this.socket.emit('server:join', { serverId: serverId });
    },

    joinChannel(channelId) {
      if (this.socket) this.socket.emit('channel:join', { channelId: channelId });
    },

    joinDM(userId) {
      if (this.socket) this.socket.emit('dm:join', { userId: userId });
    },

    sendChannelMessage(channelId, content, callback) {
      if (!this.socket) return;
      this.socket.emit('channel:message', { channelId: channelId, content: content }, callback);
    },

    sendDMMessage(toUserId, content, callback) {
      if (!this.socket) return;
      this.socket.emit('dm:message', { toUserId: toUserId, content: content }, callback);
    },

    typingStart(payload) {
      if (this.socket) this.socket.emit('typing:start', payload);
    },

    typingStop(payload) {
      if (this.socket) this.socket.emit('typing:stop', payload);
    },

    setPresence(status) {
      if (this.socket) this.socket.emit('presence:set', { status: status });
    },

    sendCallOffer(payload) {
      if (this.socket) this.socket.emit('call:offer', payload);
    },

    sendCallAnswer(payload) {
      if (this.socket) this.socket.emit('call:answer', payload);
    },

    sendCallIceCandidate(payload) {
      if (this.socket) this.socket.emit('call:ice-candidate', payload);
    },

    sendCallHangup(payload) {
      if (this.socket) this.socket.emit('call:hangup', payload);
    },

    deleteMessage(messageId, callback) {
      if (!this.socket) return;
      this.socket.emit('message:delete', { messageId }, callback);
    },

    joinServerCall(payload, callback) { if(this.socket)this.socket.emit('server-call:join',payload,callback); },
    sendServerCallOffer(payload) { if(this.socket)this.socket.emit('server-call:offer',payload); },
    sendServerCallAnswer(payload) { if(this.socket)this.socket.emit('server-call:answer',payload); },
    sendServerCallIce(payload) { if(this.socket)this.socket.emit('server-call:ice',payload); },
    leaveServerCall(payload) { if(this.socket)this.socket.emit('server-call:leave',payload); },

    toggleReaction(messageId, emoji, callback) {
      if (!this.socket) return;
      this.socket.emit('message:reaction', { messageId, emoji }, callback);
    },
  };

  window.ChatSocket = ChatSocket;
})();
