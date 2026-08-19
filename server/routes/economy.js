const express = require('express');
const db = require('../database/db');
const User = require('../models/User');
const { requireAuth } = require('./auth');

const router = express.Router();

const ITEMS = [
  { id: 'frame-neon', type: 'frame', name: 'Moldura Neon', price: 500, icon: '💠' },
  { id: 'frame-cyber', type: 'frame', name: 'Moldura Cyber', price: 900, icon: '🪩' },
  { id: 'frame-gold', type: 'frame', name: 'Moldura Ouro', price: 1800, icon: '👑' },
  { id: 'frame-fire', type: 'frame', name: 'Moldura Fogo', price: 2600, icon: '🔥' },
  { id: 'frame-rainbow', type: 'frame', name: 'Moldura Arco-íris', price: 5000, icon: '🌈' },
  { id: 'frame-void', type: 'frame', name: 'Moldura Void', price: 7500, icon: '🌌' },
  { id: 'frame-glitch', type: 'frame', name: 'Moldura Glitch', price: 12000, icon: '📺' },
  { id: 'frame-aurora', type: 'frame', name: 'Moldura Aurora', price: 15000, icon: '🌌' },
  { id: 'frame-electric', type: 'frame', name: 'Moldura Elétrica', price: 18000, icon: '⚡' },
  { id: 'frame-galaxy', type: 'frame', name: 'Moldura Galáxia', price: 22000, icon: '🌠' },
  { id: 'frame-hologram', type: 'frame', name: 'Moldura Holograma', price: 26000, icon: '🧬' },
  { id: 'decor-stars', type: 'decoration', name: 'Estrelas', price: 750, icon: '✨' },
  { id: 'decor-hearts', type: 'decoration', name: 'Corações', price: 1200, icon: '💖' },
  { id: 'decor-lightning', type: 'decoration', name: 'Raios', price: 1800, icon: '⚡' },
  { id: 'decor-snow', type: 'decoration', name: 'Neve', price: 2200, icon: '❄️' },
  { id: 'decor-particles', type: 'decoration', name: 'Partículas', price: 3000, icon: '✦' },
  { id: 'effect-aura', type: 'effect', name: 'Aura', price: 1200, icon: '🔮' },
  { id: 'effect-glow', type: 'effect', name: 'Brilho', price: 1600, icon: '💫' },
  { id: 'effect-shadow', type: 'effect', name: 'Sombra', price: 2400, icon: '🌑' },
  { id: 'effect-pulse', type: 'effect', name: 'Pulso', price: 3500, icon: '💓' },
  { id: 'effect-hologram', type: 'effect', name: 'Holograma', price: 6000, icon: '🧬' },
  { id: 'profile-badge-star', type: 'badge', name: 'Emblema Estrela', price: 1000, icon: '⭐' },
  { id: 'profile-badge-fire', type: 'badge', name: 'Emblema Fogo', price: 2000, icon: '🔥' },
  { id: 'profile-badge-rocket', type: 'badge', name: 'Emblema Foguete', price: 4000, icon: '🚀' },
  { id: 'super-pack', type: 'effect', name: 'Pacote Super Emojis', price: 8000, icon: '💥' }
];

const WFNA_COST = 25000;
const WFNA_PRICE_BRL = 20;

function inventory(uid) {
  return db.prepare(`
    SELECT item_id, item_type, equipped
    FROM user_inventory
    WHERE user_id = ?
    ORDER BY acquired_at DESC, item_id
  `).all(uid).map(x => ({
    id: x.item_id,
    type: x.item_type,
    equipped: Number(x.equipped) === 1
  }));
}

function userPayload(uid) {
  return User.toPublic(User.findById(uid));
}

router.get('/store', requireAuth, (req, res, next) => {
  try {
    const uid = Number(req.session.userId);
    res.json({
      items: ITEMS,
      wfnaCost: WFNA_COST,
      wfnaPriceBrl: WFNA_PRICE_BRL,
      wfnaPaymentConfigured: !!process.env.WFNA_PAYMENT_URL,
      wfnaPaymentUrl: process.env.WFNA_PAYMENT_URL || null,
      inventory: inventory(uid),
      user: userPayload(uid)
    });
  } catch (err) { next(err); }
});

router.post('/buy/:itemId', requireAuth, (req, res, next) => {
  const item = ITEMS.find(x => x.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });

  const uid = Number(req.session.userId);
  const user = User.findById(uid);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  try {
    db.transaction(() => {
      const existing = db.prepare(`SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ? LIMIT 1`).get(uid, item.id);
      if (existing) {
        const err = new Error('Você já possui este item.');
        err.statusCode = 409;
        throw err;
      }

      const current = db.prepare('SELECT points FROM users WHERE id = ?').get(uid);
      if (!current || Number(current.points) < item.price) {
        const err = new Error('Pontos insuficientes.');
        err.statusCode = 400;
        throw err;
      }

      db.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?').run(item.price, uid, item.price);
      db.prepare('INSERT INTO user_inventory (user_id, item_id, item_type) VALUES (?, ?, ?)').run(uid, item.id, item.type);
      db.prepare('INSERT INTO point_events (user_id, amount, reason) VALUES (?, ?, ?)').run(uid, -item.price, `purchase:${item.id}`);
    })();

    res.json({ ok: true, inventory: inventory(uid), user: userPayload(uid) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.post('/unequip/:itemId', requireAuth, (req, res, next) => {
  try {
    const uid = Number(req.session.userId);
    const item = ITEMS.find(x => x.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item não encontrado.' });

    db.transaction(() => {
      db.prepare('UPDATE user_inventory SET equipped = 0 WHERE user_id = ? AND item_id = ?').run(uid, item.id);
      if (item.type === 'frame') db.prepare('UPDATE users SET frame = NULL WHERE id = ? AND frame = ?').run(uid, item.id);
      if (item.type === 'decoration') db.prepare('UPDATE users SET decoration = NULL WHERE id = ? AND decoration = ?').run(uid, item.id);
    })();

    res.json({ ok: true, user: userPayload(uid), inventory: inventory(uid) });
  } catch (err) { next(err); }
});

router.post('/equip/:itemId', requireAuth, (req, res, next) => {
  const item = ITEMS.find(x => x.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  const uid = Number(req.session.userId);

  try {
    db.transaction(() => {
      const owned = db.prepare('SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ? LIMIT 1').get(uid, item.id);
      if (!owned) {
        const err = new Error('Item não adquirido.');
        err.statusCode = 403;
        throw err;
      }

      db.prepare('UPDATE user_inventory SET equipped = 0 WHERE user_id = ? AND item_type = ?').run(uid, item.type);
      db.prepare('UPDATE user_inventory SET equipped = 1 WHERE user_id = ? AND item_id = ?').run(uid, item.id);
      if (item.type === 'frame') db.prepare('UPDATE users SET frame = ? WHERE id = ?').run(item.id, uid);
      if (item.type === 'decoration') db.prepare('UPDATE users SET decoration = ? WHERE id = ?').run(item.id, uid);
    })();

    res.json({ ok: true, user: userPayload(uid), inventory: inventory(uid) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.post('/wfna/buy', requireAuth, (req, res, next) => {
  const uid = Number(req.session.userId);
  try {
    db.transaction(() => {
      const u = db.prepare('SELECT points, wfna FROM users WHERE id = ?').get(uid);
      if (!u) { const e = new Error('Usuário não encontrado.'); e.statusCode = 404; throw e; }
      if (Number(u.wfna) === 1) { const e = new Error('WFNA já ativo.'); e.statusCode = 409; throw e; }
      if (Number(u.points) < WFNA_COST) { const e = new Error('Pontos insuficientes.'); e.statusCode = 400; throw e; }
      db.prepare('UPDATE users SET points = points - ?, wfna = 1 WHERE id = ? AND points >= ?').run(WFNA_COST, uid, WFNA_COST);
      db.prepare('INSERT INTO point_events (user_id, amount, reason) VALUES (?, ?, ?)').run(uid, -WFNA_COST, 'wfna');
    })();
    res.json({ ok: true, user: userPayload(uid), animation: 'rocket' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.post('/wfna/payment-intent', requireAuth, (req, res, next) => {
  try {
    const u = User.findById(req.session.userId);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (u.wfna) return res.status(409).json({ error: 'WFNA já ativo.' });
    if (!process.env.WFNA_PAYMENT_URL) return res.status(503).json({ error: 'O checkout de R$ 20,00 ainda não foi configurado. Defina WFNA_PAYMENT_URL no servidor.' });
    res.json({ ok: true, amount: WFNA_PRICE_BRL, currency: 'BRL', url: process.env.WFNA_PAYMENT_URL });
  } catch (err) { next(err); }
});

module.exports = router;
