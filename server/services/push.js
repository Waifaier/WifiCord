// server/services/push.js
// Envia notificações push (Firebase Cloud Messaging) pros tokens de um
// usuário — é o que acorda o app no celular quando ele está fechado ou com
// a tela bloqueada e uma ligação/mensagem chega (a sinalização em tempo real
// via socket.io continua sendo o caminho normal quando o app já está
// aberto/em segundo plano vivo — ver client/js/notifications.js).
//
// Se a variável de ambiente FIREBASE_SERVICE_ACCOUNT_JSON não estiver
// configurada, tudo aqui vira um no-op silencioso — o resto do app
// continua funcionando normal, só sem esse aviso quando o app tá fechado
// (ver mobile/LEIA-ME-PUSH.txt pro passo a passo de configurar).
'use strict';

const PushToken = require('../models/PushToken');

let firebaseApp = null;
let attemptedInit = false;

function getMessaging() {
  if (attemptedInit) return firebaseApp;
  attemptedInit = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const admin = require('firebase-admin');
    const serviceAccount = JSON.parse(raw);
    firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return firebaseApp;
  } catch (err) {
    console.error('Falha ao inicializar Firebase Admin (push notifications):', err.message);
    firebaseApp = null;
    return null;
  }
}

// Base comum pros dois tipos de push abaixo: resolve os tokens da pessoa,
// manda a mensagem "data-only" (sem "notification" — quem monta a
// notificação de verdade é o WifiCordFirebaseMessagingService.kt no
// Android, que decide o formato pelo campo "type"), e limpa tokens que o
// Firebase já não reconhece mais (desinstalou o app, trocou de aparelho etc.).
async function sendPush(toUserId, data, errorLabel) {
  const app = getMessaging();
  if (!app) return;
  const tokens = PushToken.listForUser(toUserId);
  if (!tokens.length) return;
  const admin = require('firebase-admin');
  try {
    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      data,
      android: { priority: 'high' },
    });
    res.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')) {
        PushToken.unregister(tokens[i]);
      }
    });
  } catch (err) {
    console.error(`Erro ao enviar push de ${errorLabel}:`, err.message);
  }
}

async function sendIncomingCallPush(toUserId, { fromUserId, fromName, fromAvatar, callType }) {
  await sendPush(toUserId, {
    type: 'incoming_call',
    fromUserId: String(fromUserId),
    fromName: String(fromName || 'Alguém'),
    fromAvatar: String(fromAvatar || ''),
    callType: callType === 'audio' ? 'audio' : 'video',
  }, 'ligação');
}

// Mensagem direta nova, ou menção num canal de servidor, chegando pra
// alguém sem nenhum socket conectado no momento. "kind" distingue os dois
// no app Android pra montar o deep link certo ao tocar na notificação (ver
// onMessageReceived em WifiCordFirebaseMessagingService.kt).
async function sendMessagePush(toUserId, { fromUserId, fromName, fromAvatar, preview, kind, channelId, serverId, channelName }) {
  await sendPush(toUserId, {
    type: 'new_message',
    fromUserId: String(fromUserId),
    fromName: String(fromName || 'Alguém'),
    fromAvatar: String(fromAvatar || ''),
    preview: String(preview || '').slice(0, 200),
    kind: kind === 'channel' ? 'channel' : 'dm',
    channelId: channelId ? String(channelId) : '',
    serverId: serverId ? String(serverId) : '',
    channelName: String(channelName || ''),
  }, 'mensagem');
}

module.exports = { sendIncomingCallPush, sendMessagePush };
