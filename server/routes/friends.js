const express = require('express');
const Friendship = require('../models/Friendship');
const { parsePositiveInt, isNonEmptyString } = require('../utils/validate');
const { requireAuth } = require('./auth');

const router = express.Router();

router.post('/request', requireAuth, (req, res) => {
  const username = String(req.body.username || '').trim();
  if (!isNonEmptyString(username, 32)) {
    return res.status(400).json({ error: 'Informe um nome de usuário.' });
  }
  try {
    const friendship = Friendship.request(req.session.userId, username);
    const io=req.app.get('io'); if(io){ const target = friendship.user_id === req.session.userId ? friendship.friend_id : friendship.user_id; io.to('user:'+target).emit('friend:request:update'); }
    res.json({ friendship });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:friendshipId/respond', requireAuth, (req, res) => {
  const friendshipId = parsePositiveInt(req.params.friendshipId);
  if (!friendshipId) return res.status(400).json({ error: 'ID inválido.' });
  const accept = req.body.accept === true;

  try {
    const result = Friendship.respond(friendshipId, req.session.userId, accept);
    const io=req.app.get('io'); if(io){ io.to('user:'+req.session.userId).emit('friend:request:update'); const other=result.user_id===req.session.userId?result.friend_id:result.user_id; io.to('user:'+other).emit('friend:request:update'); }
    res.json({ friendship: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/pending', requireAuth, (req, res) => {
  res.json(Friendship.listPending(req.session.userId));
});

router.get('/', requireAuth, (req, res) => {
  res.json({ friends: Friendship.listFriends(req.session.userId) });
});

router.delete('/:userId', requireAuth, (req, res) => {
  const otherId = parsePositiveInt(req.params.userId);
  if (!otherId) return res.status(400).json({ error: 'ID inválido.' });
  Friendship.remove(req.session.userId, otherId);
  res.json({ ok: true });
});

module.exports = router;
