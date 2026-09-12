// server/services/push.js
// Envia notificações push (Firebase Cloud Messaging) pros tokens de um
// usuário — é o que acorda o app no celular quando ele está fechado ou com
// a tela bloqueada e uma ligação chega (a sinalização em tempo real via
// socket.io continua sendo o caminho normal quando o app já está aberto).
//
// Se a variável de ambiente FIREBASE_SERVICE_ACCOUNT_JSON não estiver
// configurada, tudo aqui vira um no-op silencioso — o resto do app
// continua funcionando normal, só sem esse aviso quando o app tá fechado.
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

async function sendIncomingCallPush(toUserId, { fromUserId, fromName, fromAvatar, callType }) {
  const app = getMessaging();
  if (!app) return;
  const tokens = PushToken.listForUser(toUserId);
  if (!tokens.length) return;
  const admin = require('firebase-admin');
  try {
    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        type: 'incoming_call',
        fromUserId: String(fromUserId),
        fromName: String(fromName || 'Alguém'),
        fromAvatar: String(fromAvatar || ''),
        callType: callType === 'audio' ? 'audio' : 'video',
      },
      android: { priority: 'high' },
    });
    res.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')) {
        PushToken.unregister(tokens[i]);
      }
    });
  } catch (err) {
    console.error('Erro ao enviar push de ligação:', err.message);
  }
}

module.exports = { sendIncomingCallPush };
