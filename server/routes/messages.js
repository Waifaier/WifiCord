const express = require('express');
const Message = require('../models/Message');
const Channel = require('../models/Channel');
const ServerModel = require('../models/Server');
const Friendship = require('../models/Friendship');
const { parsePositiveInt } = require('../utils/validate');
const { requireAuth } = require('./auth');

const router = express.Router();

router.get('/channel/:channelId', requireAuth, (req, res) => {
  const channelId = parsePositiveInt(req.params.channelId);
  if (!channelId) return res.status(400).json({ error: 'ID inválido.' });

  const channel = Channel.findById(channelId);
  if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });
  if (!ServerModel.isMember(channel.server_id, req.session.userId) || !Channel.canView(channel, req.session.userId)) {
    return res.status(403).json({ error: 'Não autorizado.' });
  }

  const messages = Message.listForChannel(channelId).map(m => { const x=Message.toPublic(m); x.reactions=Message.getReactionSummary(x.id, req.session.userId); return x; });
  res.json({ messages });
});

router.get('/dm/:userId', requireAuth, (req, res) => {
  const otherId = parsePositiveInt(req.params.userId);
  if (!otherId) return res.status(400).json({ error: 'ID inválido.' });

  if (otherId !== req.session.userId && !Friendship.areFriends(req.session.userId, otherId)) {
    return res.status(403).json({ error: 'Vocês precisam ser amigos para conversar.' });
  }

  const messages = Message.listForDM(req.session.userId, otherId).map(m => { const x=Message.toPublic(m); x.reactions=Message.getReactionSummary(x.id, req.session.userId); return x; });
  res.json({ messages });
});

module.exports = router;
