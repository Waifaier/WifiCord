const db = require('../database/db');
const User = require('./User');

// Bloqueio é guardado só numa direção (quem bloqueou -> quem foi bloqueado),
// mas a maioria das checagens (ex.: pode mandar solicitação de amizade?)
// precisa considerar as duas direções — por isso isBlocked() olha ambos os
// lados enquanto blockedByMe() é direcional (usado pra saber se EU bloqueei
// alguém, de propósito, pra mostrar o botão certo no perfil).
const Block = {
  isBlocked(userA, userB) {
    return !!db.prepare(
      `SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`
    ).get(userA, userB, userB, userA);
  },

  blockedByMe(blockerId, blockedId) {
    return !!db.prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get(blockerId, blockedId);
  },

  block(blockerId, blockedId) {
    db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)').run(blockerId, blockedId);
  },

  unblock(blockerId, blockedId) {
    db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId);
  },

  listBlockedByUser(userId) {
    const rows = db.prepare(
      `SELECT u.* FROM blocked_users b JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ? ORDER BY b.created_at DESC`
    ).all(userId);
    return rows.map(User.toPublic);
  },
};

module.exports = Block;
