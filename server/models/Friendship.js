```js
const db = require('../database/db');
const User = require('./User');

const Friendship = {
  async findBetween(userA, userB) {
    const result = await db.query(
      `SELECT * FROM friendships
       WHERE (user_id = $1 AND friend_id = $2)
          OR (user_id = $2 AND friend_id = $1)`,
      [userA, userB]
    );

    return result.rows[0] || null;
  },

  async request(requesterId, friendUsername) {
    const friend = await User.findByUsername(friendUsername);

    if (!friend) {
      const err = new Error('Usuário não encontrado.');
      err.status = 404;
      throw err;
    }

    if (Number(friend.id) === Number(requesterId)) {
      const err = new Error('Você não pode adicionar a si mesmo.');
      err.status = 400;
      throw err;
    }

    const existing = await Friendship.findBetween(
      requesterId,
      friend.id
    );

    if (existing) {
      const err = new Error(
        'Já existe uma solicitação ou amizade com esse usuário.'
      );
      err.status = 409;
      throw err;
    }

    const result = await db.query(
      `INSERT INTO friendships
       (user_id, friend_id, requester_id, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [requesterId, friend.id, requesterId]
    );

    return result.rows[0];
  },

  async respond(friendshipId, userId, accept) {
    const result = await db.query(
      'SELECT * FROM friendships WHERE id = $1',
      [friendshipId]
    );

    const f = result.rows[0];

    if (!f) {
      const err = new Error('Solicitação não encontrada.');
      err.status = 404;
      throw err;
    }

    const recipientId =
      Number(f.requester_id) === Number(f.user_id)
        ? f.friend_id
        : f.user_id;

    if (Number(recipientId) !== Number(userId)) {
      const err = new Error('Não autorizado.');
      err.status = 403;
      throw err;
    }

    if (accept) {
      const updated = await db.query(
        `UPDATE friendships
         SET status = 'accepted'
         WHERE id = $1
         RETURNING *`,
        [friendshipId]
      );

      return updated.rows[0];
    }

    await db.query(
      'DELETE FROM friendships WHERE id = $1',
      [friendshipId]
    );

    return {
      id: friendshipId,
      status: 'rejected',
    };
  },

  async listFriends(userId) {
    const result = await db.query(
      `SELECT u.*
       FROM friendships f
       JOIN users u
         ON u.id = CASE
           WHEN f.user_id = $1 THEN f.friend_id
           ELSE f.user_id
         END
       WHERE (f.user_id = $1 OR f.friend_id = $1)
         AND f.status = 'accepted'`,
      [userId]
    );

    return result.rows.map(User.toPublic);
  },

  async listPending(userId) {
    const receivedResult = await db.query(
      `SELECT f.*,
              u.username,
              u.display_name,
              u.avatar_url
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.status = 'pending'
         AND f.requester_id != $1
         AND (f.user_id = $1 OR f.friend_id = $1)`,
      [userId]
    );

    const sentResult = await db.query(
      `SELECT f.*,
              u.username,
              u.display_name,
              u.avatar_url
       FROM friendships f
       JOIN users u
         ON u.id = CASE
           WHEN f.user_id = $1 THEN f.friend_id
           ELSE f.user_id
         END
       WHERE f.status = 'pending'
         AND f.requester_id = $1`,
      [userId]
    );

    return {
      received: receivedResult.rows.map((r) => ({
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

      sent: sentResult.rows.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
        to: {
          username: r.username,
          displayName: r.display_name,
          avatarUrl: r.avatar_url,
        },
      })),
    };
  },

  async areFriends(userA, userB) {
    const f = await Friendship.findBetween(userA, userB);

    return !!f && f.status === 'accepted';
  },

  async remove(userId, otherUserId) {
    await db.query(
      `DELETE FROM friendships
       WHERE (user_id = $1 AND friend_id = $2)
          OR (user_id = $2 AND friend_id = $1)`,
      [userId, otherUserId]
    );
  },
};

module.exports = Friendship;
```
