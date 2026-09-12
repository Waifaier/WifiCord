const express = require('express');
const db = require('../database/db');
const User = require('../models/User');
const Block = require('../models/Block');
const Friendship = require('../models/Friendship');
const Report = require('../models/Report');
const { requireAuth } = require('./auth');
const { parsePositiveInt, isNonEmptyString } = require('../utils/validate');

const router = express.Router();

router.post('/block/:userId', requireAuth, (req, res) => {
  const targetId = parsePositiveInt(req.params.userId);
  if (!targetId) return res.status(400).json({ error: 'ID inválido.' });
  if (targetId === Number(req.session.userId)) {
    return res.status(400).json({ error: 'Você não pode bloquear a si mesmo.' });
  }
  const target = User.findById(targetId);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

  Block.block(req.session.userId, targetId);
  // Bloquear encerra qualquer amizade/solicitação pendente nos dois sentidos
  // (o mesmo efeito de "unfriend"), já que DMs e chamadas 1:1 só funcionam
  // entre amigos (ver Friendship.areFriends em server/sockets/index.js).
  Friendship.remove(req.session.userId, targetId);

  res.json({ ok: true, blocked: true });
});

router.delete('/block/:userId', requireAuth, (req, res) => {
  const targetId = parsePositiveInt(req.params.userId);
  if (!targetId) return res.status(400).json({ error: 'ID inválido.' });
  Block.unblock(req.session.userId, targetId);
  res.json({ ok: true, blocked: false });
});

router.get('/blocked', requireAuth, (req, res) => {
  res.json({ blocked: Block.listBlockedByUser(req.session.userId) });
});

router.post('/report', requireAuth, (req, res) => {
  const targetId = parsePositiveInt(req.body.userId);
  if (!targetId) return res.status(400).json({ error: 'Usuário inválido.' });
  if (targetId === Number(req.session.userId)) {
    return res.status(400).json({ error: 'Você não pode denunciar a si mesmo.' });
  }
  const target = User.findById(targetId);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const reason = String(req.body.reason || '').trim();
  if (!isNonEmptyString(reason, 500) || reason.length < 5) {
    return res.status(400).json({ error: 'Descreva o motivo da denúncia (mínimo 5 caracteres).' });
  }

  // As URLs de evidência têm que apontar pra um arquivo que a própria pessoa
  // já subiu por /api/media/upload (nunca uma URL externa arbitrária) — o
  // upload em si já limita tamanho/tipo, então isso é seguro pra guardar e
  // exibir como <img> no painel de admin.
  const evidenceUrls = Array.isArray(req.body.evidence) ? req.body.evidence.slice(0, 5) : [];
  for (const url of evidenceUrls) {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) {
      return res.status(400).json({ error: 'Evidência inválida.' });
    }
  }

  const rawContext = req.body.context && typeof req.body.context === 'object' ? req.body.context : {};
  const context = {
    serverId: parsePositiveInt(rawContext.serverId) || null,
    channelId: parsePositiveInt(rawContext.channelId) || null,
    messageId: parsePositiveInt(rawContext.messageId) || null,
    preview: String(rawContext.preview || '').slice(0, 300),
  };

  const report = Report.create({
    reporterId: req.session.userId,
    reportedUserId: targetId,
    reason,
    evidenceUrls,
    context,
  });

  const io = req.app.get('io');
  if (io) {
    db.prepare("SELECT id FROM users WHERE role = 'admin'").all().forEach(admin => {
      io.to('user:' + admin.id).emit('admin:report:new', { reportId: report.id });
    });
  }

  res.json({ ok: true, report });
});

module.exports = router;
