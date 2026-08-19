const db = require('../database/db');
const User = require('./User');

const Friendship = {
  findBetween(userA, userB) {
    return db
      .prepare(
        `SELECT * FROM friendships
         WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`
      )
      .get(userA, userB, userB, userA);
  },

  request(requesterId, friendUsername) {
    const friend = User.findByUsername(friendUsername);
    if (!friend) {
      const err = new Error('Usuário não encontrado.');
      err.status = 404;
      throw err;
    }
    if (friend.id === requesterId) {
      const err = new Error('Você não pode adicionar a si mesmo.');
      err.status = 400;
      throw err;
    }
    const existing = Friendship.findBetween(requesterId, friend.id);
    if (existing) {
      const err = new Error('Já existe uma solicitação ou amizade com esse usuário.');
      err.status = 409;
      throw err;
    }
    const stmt = db.prepare(`
      INSERT INTO friendships (user_id, friend_id, requester_id, status)
      VALUES (?, ?, ?, 'pending')
    `);
    const info = stmt.run(requesterId, friend.id, requesterId);
    return db.prepare('SELECT * FROM friendships WHERE id = ?').get(info.lastInsertRowid);
  },

  respond(friendshipId, userId, accept) {
    const f = db.prepare('SELECT * FROM friendships WHERE id = ?').get(friendshipId);
    if (!f) {
      const err = new Error('Solicitação não encontrada.');
      err.status = 404;
      throw err;
    }
    const recipientId = f.requester_id === f.user_id ? f.friend_id : f.user_id;
    if (recipientId !== userId) {
      const err = new Error('Não autorizado.');
      err.status = 403;
      throw err;
    }
    if (accept) {
      db.prepare(`UPDATE friendships SET status = 'accepted' WHERE id = ?`).run(friendshipId);
      return db.prepare('SELECT * FROM friendships WHERE id = ?').get(friendshipId);
    }
    db.prepare('DELETE FROM friendships WHERE id = ?').run(friendshipId);
    return { id: friendshipId, status: 'rejected' };
  },

  listFriends(userId) {
    const rows = db
      .prepare(
        `SELECT u.* FROM friendships f
         JOIN users u ON u.id = (CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END)
         WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'`
      )
      .all(userId, userId, userId);
    return rows.map(User.toPublic);
  },

  listPending(userId) {
    const received = db
      .prepare(
        `SELECT f.*, u.username, u.display_name, u.avatar_url FROM friendships f
         JOIN users u ON u.id = f.requester_id
         WHERE f.status = 'pending' AND f.requester_id != ? AND (f.user_id = ? OR f.friend_id = ?)`
      )
      .all(userId, userId, userId);

    const sent = db
      .prepare(
        `SELECT f.*, u.username, u.display_name, u.avatar_url FROM friendships f
         JOIN users u ON u.id = (CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END)
         WHERE f.status = 'pending' AND f.requester_id = ?`
      )
      .all(userId, userId);

    return {
      received: received.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
        requester: {
          id: r.requester_id,
          username: r.username,
          displayName: r.display_name,
          avatarUrl: r.avatar_url,
        },
      })),
      sent: sent.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
        to: { username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url },
      })),
    };
  },

  areFriends(userA, userB) {
    const f = Friendship.findBetween(userA, userB);
    return !!f && f.status === 'accepted';
  },

  remove(userId, otherUserId) {
    db.prepare(
      `DELETE FROM friendships
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`
    ).run(userId, otherUserId, otherUserId, userId);
  },
};

module.exports = Friendship;
