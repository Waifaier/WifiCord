const Channel = require('../models/Channel');
const db = require('../database/db');
const ServerModel = require('../models/Server');
const Friendship = require('../models/Friendship');
const Message = require('../models/Message');
const User = require('../models/User');
const recentRewards = new Map();

const MAX_MESSAGE_LENGTH = 2000;
const OFFLINE_DELAY_MS = 5000;
const SUPER_EMOJIS = new Set(['🌈','⚡','🚀','💥','🔥','❄️','🎉','💜','🌀','🎆','🪩','💀','😎']);

const onlineSockets = new Map(); // userId -> Set(socketId)
const offlineTimers = new Map(); // userId -> Timeout

function userRoom(userId) {
  return 'user:' + userId;
}
function serverRoom(serverId) {
  return 'server:' + serverId;
}
function channelRoom(channelId) {
  return 'channel:' + channelId;
}
function dmRoom(userA, userB) {
  const pair = [userA, userB].sort((a, b) => a - b);
  return 'dm:' + pair[0] + ':' + pair[1];
}

function broadcastTyping(io, socket, data, isTyping) {
  const userId = socket.userId;
  const event = isTyping ? 'typing:start' : 'typing:stop';

  if (data && data.channelId) {
    socket.to(channelRoom(data.channelId)).emit(event, { channelId: data.channelId, userId });
  } else if (data && data.toUserId) {
    socket.to(dmRoom(userId, data.toUserId)).emit(event, { fromUserId: userId, userId });
  }
}

function rewardMessage(userId, content) {
  // anti-spam: texto minimamente significativo e no máximo 1 ponto/30s
  if (content.trim().length < 3) return;
  const now=Date.now(), last=recentRewards.get(userId)||0;
  if(now-last<30000)return;
  recentRewards.set(userId,now);
  User.addPoints(userId, 5, 'message');
}
function canAccessMessage(userId, message) {
  if (!message) return false;
  if (message.channel_id) {
    const channel = Channel.findById(message.channel_id);
    return !!channel && ServerModel.isMember(channel.server_id, userId);
  }
  if (message.to_user_id) return Number(message.from_user_id)===Number(userId) || Number(message.to_user_id)===Number(userId) || Friendship.areFriends(userId, Number(message.to_user_id));
  return false;
}

function initSockets(io) {
  io.use((socket, next) => {
    const session = socket.request.session;
    if (!session || !session.userId) { return next(new Error('unauthorized')); }
    const authUser=User.findById(session.userId);
    if(!authUser || User.isBanned(authUser)) return next(new Error('banned'));
    socket.userId = session.userId;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;

    if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set());
    onlineSockets.get(userId).add(socket.id);

    socket.join(userRoom(userId));

    if (offlineTimers.has(userId)) {
      clearTimeout(offlineTimers.get(userId));
      offlineTimers.delete(userId);
    }

    User.setStatus(userId, 'online');
    io.emit('presence:update', { userId, status: 'online' });

    socket.on('server:join', (data) => {
      const serverId = data && data.serverId;
      if (!serverId || !ServerModel.isMember(serverId, userId)) return;
      socket.join(serverRoom(serverId));
    });

    socket.on('channel:join', (data) => {
      const channelId = data && data.channelId;
      const channel = channelId && Channel.findById(channelId);
      if (!channel || !ServerModel.isMember(channel.server_id, userId) || !Channel.canView(channel,userId)) return;
      socket.join(channelRoom(channelId));
    });

    socket.on('dm:join', (data) => {
      const otherId = data && data.userId;
      if (!otherId) return;
      if (otherId !== userId && !Friendship.areFriends(userId, otherId)) return;
      socket.join(dmRoom(userId, otherId));
    });

    socket.on('channel:message', (data, callback) => {
      callback = typeof callback === 'function' ? callback : () => {};
      const channelId = data && data.channelId;
      let content = data && typeof data.content === 'string' ? data.content.trim() : '';
      const sender=User.findById(userId);
      if(User.isChatMuted(sender)) return callback({error:'Você está impedido de enviar mensagens no momento.'});

      if (!channelId || !content) return callback({ error: 'Mensagem inválida.' });
      if (content.length > MAX_MESSAGE_LENGTH) return callback({ error: 'Mensagem muito longa.' });
      const channel = channelId && Channel.findById(channelId);
      if (!channel || !ServerModel.isMember(channel.server_id, userId) || !Channel.canView(channel,userId)) {
        return callback({ error: 'Não autorizado.' });
      }
      if (content.startsWith('__SUPER__:')) {
        const emoji = content.slice(10).trim();
        if (!ServerModel.getSettings(channel.server_id).allowSuperEmojis) return callback({ error: 'Super emojis estão desativados neste servidor.' });
        if (!SUPER_EMOJIS.has(emoji)) return callback({ error: 'Super emoji inválido.' });
        const quota = User.consumeSuperEmoji(userId);
        if (!quota.allowed) return callback({ error: 'Você usou seus 10 super emojis gratuitos. Ative o WFNA para uso ilimitado.' });
      }

      if (content.startsWith('__MEDIA__:')) {
        try {
          const media = JSON.parse(content.slice(10));
          const mf=db.prepare('SELECT id,user_id,original_name,mime_type,size_bytes,url FROM media_files WHERE id=?').get(Number(media?.id));
          if (!mf || Number(mf.user_id)!==Number(userId) || !String(mf.url||'').startsWith('/uploads/')) return callback({error:'Arquivo de mídia inválido.'});
          // Reconstroi a referência a partir do registro do banco para evitar
          // que diferenças de MIME/URL do navegador invalidem um upload válido.
          content='__MEDIA__:'+JSON.stringify({id:mf.id,url:mf.url,name:mf.original_name,mime:mf.mime_type,size:Number(mf.size_bytes)});
        } catch (_) { return callback({error:'Arquivo de mídia inválido.'}); }
      }
      const saved = Message.toPublic(Message.createChannelMessage(channelId, userId, content));
      saved.reactions = Message.getReactionSummary(saved.id, userId);
      rewardMessage(userId, content);
      io.to(channelRoom(channelId)).emit('channel:message', saved);
      callback({ message: saved });
    });

    socket.on('dm:message', (data, callback) => {
      callback = typeof callback === 'function' ? callback : () => {};
      const toUserId = data && data.toUserId;
      let content = data && typeof data.content === 'string' ? data.content.trim() : '';
      const sender=User.findById(userId);
      if(User.isChatMuted(sender)) return callback({error:'Você está impedido de enviar mensagens no momento.'});

      if (!toUserId || !content) return callback({ error: 'Mensagem inválida.' });
      if (content.length > MAX_MESSAGE_LENGTH) return callback({ error: 'Mensagem muito longa.' });
      if (!Friendship.areFriends(userId, toUserId)) {
        return callback({ error: 'Vocês precisam ser amigos para conversar.' });
      }
      if (content.startsWith('__SUPER__:')) {
        const emoji = content.slice(10).trim();
        if (!SUPER_EMOJIS.has(emoji)) return callback({ error: 'Super emoji inválido.' });
        const quota = User.consumeSuperEmoji(userId);
        if (!quota.allowed) return callback({ error: 'Você usou seus 10 super emojis gratuitos. Ative o WFNA para uso ilimitado.' });
      }
      if (content.startsWith('__MEDIA__:')) {
        try {
          const media = JSON.parse(content.slice(10));
          const mf=db.prepare('SELECT id,user_id,original_name,mime_type,size_bytes,url FROM media_files WHERE id=?').get(Number(media?.id));
          if (!mf || Number(mf.user_id)!==Number(userId) || !String(mf.url||'').startsWith('/uploads/')) return callback({error:'Arquivo de mídia inválido.'});
          // Reconstroi a referência a partir do registro do banco para evitar
          // que diferenças de MIME/URL do navegador invalidem um upload válido.
          content='__MEDIA__:'+JSON.stringify({id:mf.id,url:mf.url,name:mf.original_name,mime:mf.mime_type,size:Number(mf.size_bytes)});
        } catch (_) { return callback({error:'Arquivo de mídia inválido.'}); }
      }

      const saved = Message.toPublic(Message.createDirectMessage(userId, toUserId, content));
      saved.reactions = Message.getReactionSummary(saved.id, userId);
      rewardMessage(userId, content);
      io.to(dmRoom(userId, toUserId)).emit('dm:message', saved);
      io.to(userRoom(toUserId)).emit('dm:message', saved);
      callback({ message: saved });
    });

    socket.on('message:reaction', (data, callback) => {
      callback = typeof callback === 'function' ? callback : () => {};
      const messageId = Number(data && data.messageId);
      const emoji = String(data && data.emoji || '').trim();
      if (!Number.isInteger(messageId) || messageId <= 0 || !emoji || emoji.length > 16) return callback({error:'Reação inválida.'});
      const message = Message.findById(messageId);
      if (!canAccessMessage(userId, message)) return callback({error:'Não autorizado.'});
      Message.toggleReaction(messageId, userId, emoji);
      const reactions = Message.getReactionSummary(messageId, userId);
      const payload = {messageId, reactions};
      if (message.channel_id) io.to(channelRoom(message.channel_id)).emit('message:reaction', payload);
      else {
        io.to(dmRoom(message.from_user_id, message.to_user_id)).emit('message:reaction', payload);
        io.to(userRoom(message.from_user_id)).emit('message:reaction', payload);
        io.to(userRoom(message.to_user_id)).emit('message:reaction', payload);
      }
      callback({ok:true, ...payload});
    });

    socket.on('typing:start', (data) => broadcastTyping(io, socket, data, true));
    socket.on('typing:stop', (data) => broadcastTyping(io, socket, data, false));

    // Easter egg "piruleta": só repassa o evento para a mesma sala de
    // canal/DM já usada pelo typing, sem persistir nada.
    socket.on('piruleta:trigger', (data) => {
      if (!data) return;
      const payload = { userId };
      if (data.channelId) {
        payload.channelId = data.channelId;
        socket.to(channelRoom(data.channelId)).emit('piruleta:trigger', payload);
      } else if (data.toUserId) {
        socket.to(dmRoom(userId, data.toUserId)).emit('piruleta:trigger', payload);
      }
    });

    // Sinalização WebRTC 1:1. O servidor valida amizade e somente repassa
    // SDP/ICE; áudio, vídeo e tela continuam P2P entre os navegadores.
    function canCall(toUserId) {
      const me=User.findById(userId), target=User.findById(Number(toUserId));
      return Number.isInteger(Number(toUserId)) && Number(toUserId)!==Number(userId) && Friendship.areFriends(userId,Number(toUserId)) && !User.isBanned(me) && !User.isVoiceMuted(me) && !User.isBanned(target) && !User.isVoiceMuted(target);
    }

    socket.on('call:offer', (data) => {
      const toUserId = Number(data && data.toUserId);
      if (!canCall(toUserId) || !data?.sdp) return;
      io.to(userRoom(toUserId)).emit('call:offer', {
        fromUserId: userId,
        sdp: data.sdp,
        callType: data.callType === 'audio' ? 'audio' : 'video',
        renegotiation: data.renegotiation === true,
      });
    });

    socket.on('call:answer', (data) => {
      const toUserId = Number(data && data.toUserId);
      if (!canCall(toUserId) || !data?.sdp) return;
      io.to(userRoom(toUserId)).emit('call:answer', {
        fromUserId: userId,
        sdp: data.sdp,
        renegotiation: data.renegotiation === true,
      });
    });

    socket.on('call:ice-candidate', (data) => {
      const toUserId = Number(data && data.toUserId);
      if (!canCall(toUserId) || !data?.candidate) return;
      io.to(userRoom(toUserId)).emit('call:ice-candidate', {
        fromUserId: userId,
        candidate: data.candidate,
      });
    });

    socket.on('call:hangup', (data) => {
      const toUserId = Number(data && data.toUserId);
      if (!canCall(toUserId)) return;
      io.to(userRoom(toUserId)).emit('call:hangup', { fromUserId: userId });
    });

    // Chamadas em canais: malha P2P entre os membros do canal de voz.
    socket.on('server-call:join', (data, callback) => {
      callback = typeof callback === 'function' ? callback : () => {};
      const serverId = Number(data?.serverId), channelId = Number(data?.channelId);
      const channel = Channel.findById(channelId);
      if (!serverId || !channel || Number(channel.server_id)!==serverId || !ServerModel.isMember(serverId,userId) || !Channel.canView(channel,userId)) return callback({error:'Não autorizado.'});
      const room='server-call:'+serverId+':'+channelId;
      const peers=[]; const roomSet=io.sockets.adapter.rooms.get(room); if(roomSet){for(const sid of roomSet){const peer=io.sockets.sockets.get(sid);if(peer&&peer.userId!==userId)peers.push(Number(peer.userId));}}
      socket.join(room); socket.data.serverCall={serverId,channelId,room};
      callback({ok:true,peers:[...new Set(peers)]});
      socket.to(room).emit('server-call:user-joined',{userId,serverId,channelId});
    });
    socket.on('server-call:offer', data=>{const to=Number(data?.toUserId),serverId=Number(data?.serverId),channelId=Number(data?.channelId);if(!to||!serverId||!channelId||!ServerModel.isMember(serverId,userId))return;io.to(userRoom(to)).emit('server-call:offer',{fromUserId:userId,serverId,channelId,sdp:data.sdp,callType:data.callType==='video'?'video':'audio'});});
    socket.on('server-call:answer', data=>{const to=Number(data?.toUserId),serverId=Number(data?.serverId),channelId=Number(data?.channelId);if(!to||!serverId||!channelId||!ServerModel.isMember(serverId,userId))return;io.to(userRoom(to)).emit('server-call:answer',{fromUserId:userId,serverId,channelId,sdp:data.sdp});});
    socket.on('server-call:ice', data=>{const to=Number(data?.toUserId),serverId=Number(data?.serverId),channelId=Number(data?.channelId);if(!to||!serverId||!channelId||!data?.candidate||!ServerModel.isMember(serverId,userId))return;io.to(userRoom(to)).emit('server-call:ice',{fromUserId:userId,serverId,channelId,candidate:data.candidate});});
    socket.on('server-call:leave', data=>{const sc=socket.data.serverCall;if(!sc)return;const room=sc.room;socket.leave(room);socket.to(room).emit('server-call:user-left',{userId,serverId:sc.serverId,channelId:sc.channelId});socket.data.serverCall=null;});

    socket.on('message:delete', (data, callback) => {
      callback = typeof callback === 'function' ? callback : () => {};
      const messageId = Number(data && data.messageId);
      if (!Number.isInteger(messageId) || messageId <= 0) {
        return callback({ error: 'Mensagem inválida.' });
      }

      const message = Message.findById(messageId);
      if (!message || Number(message.from_user_id) !== Number(userId)) {
        return callback({ error: 'Você só pode apagar suas próprias mensagens.' });
      }

      let allowed = false;
      if (message.channel_id) {
        const channel = Channel.findById(message.channel_id);
        allowed = !!channel && ServerModel.isMember(channel.server_id, userId);
      } else if (message.to_user_id) {
        allowed = Number(message.to_user_id) === Number(userId) ||
          Friendship.areFriends(userId, Number(message.to_user_id));
      }

      if (!allowed) return callback({ error: 'Não autorizado.' });

      Message.deleteById(messageId);
      const payload = {
        messageId,
        channelId: message.channel_id || null,
        toUserId: message.to_user_id || null,
        fromUserId: message.from_user_id,
      };

      if (message.channel_id) {
        io.to(channelRoom(message.channel_id)).emit('message:deleted', payload);
      } else {
        io.to(dmRoom(message.from_user_id, message.to_user_id)).emit('message:deleted', payload);
        io.to(userRoom(message.from_user_id)).emit('message:deleted', payload);
        io.to(userRoom(message.to_user_id)).emit('message:deleted', payload);
      }
      callback({ ok: true, messageId });
    });

    socket.on('message:edit', (data, callback) => {
      callback = typeof callback === 'function' ? callback : () => {};
      const messageId = Number(data && data.messageId);
      let content = data && typeof data.content === 'string' ? data.content.trim() : '';
      if (!Number.isInteger(messageId) || messageId <= 0 || !content) {
        return callback({ error: 'Mensagem inválida.' });
      }
      if (content.length > MAX_MESSAGE_LENGTH) return callback({ error: 'Mensagem muito longa.' });

      const message = Message.findById(messageId);
      if (!message || Number(message.from_user_id) !== Number(userId)) {
        return callback({ error: 'Você só pode editar suas próprias mensagens.' });
      }
      if (String(message.content).startsWith('__MEDIA__:') || String(message.content).startsWith('__STICKER__:') || String(message.content).startsWith('__SUPER__:')) {
        return callback({ error: 'Esse tipo de mensagem não pode ser editado.' });
      }
      if (!canAccessMessage(userId, message)) return callback({ error: 'Não autorizado.' });

      const updated = Message.toPublic(Message.editContent(messageId, content));
      updated.reactions = Message.getReactionSummary(messageId, userId);
      const payload = { messageId, content: updated.content, editedAt: updated.editedAt };

      if (message.channel_id) {
        io.to(channelRoom(message.channel_id)).emit('message:edited', payload);
      } else {
        io.to(dmRoom(message.from_user_id, message.to_user_id)).emit('message:edited', payload);
        io.to(userRoom(message.from_user_id)).emit('message:edited', payload);
        io.to(userRoom(message.to_user_id)).emit('message:edited', payload);
      }
      callback({ ok: true, message: updated });
    });

    socket.on('message:pin', (data, callback) => {
      callback = typeof callback === 'function' ? callback : () => {};
      const messageId = Number(data && data.messageId);
      const pinned = !!(data && data.pinned);
      if (!Number.isInteger(messageId) || messageId <= 0) return callback({ error: 'Mensagem inválida.' });

      const message = Message.findById(messageId);
      if (!message || !canAccessMessage(userId, message)) return callback({ error: 'Não autorizado.' });

      const updated = Message.toPublic(Message.setPinned(messageId, pinned, userId));
      const payload = { messageId, pinnedAt: updated.pinnedAt, message: updated };

      if (message.channel_id) {
        io.to(channelRoom(message.channel_id)).emit('message:pin-changed', payload);
      } else {
        io.to(dmRoom(message.from_user_id, message.to_user_id)).emit('message:pin-changed', payload);
      }
      callback({ ok: true, ...payload });
    });

    // Confirmação de leitura simples em DMs: efêmera, sem persistência.
    socket.on('dm:seen', (data) => {
      const otherId = Number(data && data.toUserId);
      if (!otherId || !Friendship.areFriends(userId, otherId)) return;
      io.to(userRoom(otherId)).emit('dm:seen', { byUserId: userId, forUserId: otherId });
    });

    socket.on('presence:set', (data) => {
      const status = data && data.status;
      if (!['online', 'away', 'offline'].includes(status)) return;
      User.setStatus(userId, status);
      io.emit('presence:update', { userId, status });
    });

    socket.on('call:speaking', (data) => {
      const toUserId=Number(data&&data.toUserId);
      if(!canCall(toUserId)) return;
      io.to(userRoom(toUserId)).emit('call:speaking',{fromUserId:userId,speaking:!!data.speaking});
    });

    socket.on('admin:effect:ack', ()=>{});

    socket.on('disconnect', () => {
      const sc=socket.data.serverCall; if(sc){socket.to(sc.room).emit('server-call:user-left',{userId,serverId:sc.serverId,channelId:sc.channelId});}
      const set = onlineSockets.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineSockets.delete(userId);
          const timer = setTimeout(() => {
            User.setStatus(userId, 'offline');
            io.emit('presence:update', { userId, status: 'offline' });
            offlineTimers.delete(userId);
          }, OFFLINE_DELAY_MS);
          offlineTimers.set(userId, timer);
        }
      }
    });
  });
}

module.exports = { initSockets };
