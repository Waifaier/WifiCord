const express = require('express');
const { requireAuth } = require('./auth');
const PushToken = require('../models/PushToken');
const router = express.Router();

// O app mobile chama isso assim que o Firebase entrega um token de
// notificação (no login e sempre que o token muda) — é esse token que o
// servidor usa depois pra acordar o app quando uma ligação chega e o app
// está fechado/tela bloqueada.
router.post('/register', requireAuth, (req, res) => {
  const token = String(req.body.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Token inválido.' });
  PushToken.register(req.session.userId, token, req.body.platform || 'android');
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

router.post('/unregister', requireAuth, (req, res) => {
  const token = String(req.body.token || '').trim();
  if (token) PushToken.unregister(token);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

// Chamado pelo botão "Rejeitar" da notificação nativa de ligação, sem
// precisar abrir o app — avisa quem ligou na hora.
router.post('/reject-call', requireAuth, (req, res) => {
  const callerUserId = Number(req.body.fromUserId);
  if (callerUserId) {
    req.app.get('io')?.wcRejectPendingCall?.(req.session.userId, callerUserId);
  }
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

module.exports = router;
