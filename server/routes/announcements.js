const express = require('express');
const { requireAuth } = require('./auth');
const User = require('../models/User');
const Announcement = require('../models/Announcement');
const router = express.Router();

// GET fica fora do middleware de admin de propósito: QUALQUER usuário
// logado precisa poder ler o aviso atual (é isso que faz o pop-up aparecer
// pra quem abre o site depois de o admin já ter mandado o aviso, não só
// pra quem estava conectado na hora — ver client/js/announcements.js).
router.get('/current', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ announcement: Announcement.current() });
});

router.post('/', requireAuth, (req, res) => {
  const u = User.findById(req.session.userId);
  if (u?.role !== 'admin') return res.status(403).json({ error: 'Acesso administrativo negado.' });
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const message = String(req.body?.message || '').trim().slice(0, 800);
  if (!title || !message) return res.status(400).json({ error: 'Preencha o título e a mensagem do aviso.' });
  const announcement = Announcement.create({ title, message, createdBy: req.session.userId });
  req.app.get('io')?.emit('admin:announcement', { announcement });
  res.json({ announcement });
});

module.exports = router;
