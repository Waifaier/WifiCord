```js
const db = require('../database/db');

const Message = {
  async createChannelMessage(channelId, fromUserId, content) {
    const result = await db.query(
      `INSERT INTO messages
       (channel_id, from_user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [channelId, fromUserId, content]
    );

    return Message.findById(result.rows[0].id);
  },

  async createDirectMessage(fromUserId, toUserId, content) {
    const result = await db.query(
      `INSERT INTO messages
       (from_user_id, to_user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [fromUserId, toUserId, content]
    );

    return Message.findById(result.rows[0].id);
  },

  async listReactions(messageId, userId = 0) {
    const result = await db.query(
      `SELECT
         r.emoji,
         COUNT(*) AS count,
         MAX(
           CASE
             WHEN r.user_id = $1 THEN 1
             ELSE 0
           END
         ) AS reacted
       FROM message_reactions r
       WHERE r.message_id = $2
       GROUP BY r.emoji
       ORDER BY count DESC, r.emoji ASC`,
      [userId, messageId]
    );

    return result.rows.map((r) => ({
      emoji: r.emoji,
      count: Number(r.count),
      reacted: !!Number(r.reacted),
    }));
  },

  async toggleReaction(messageId, userId, emoji) {
    const existing = await db.query(
      `SELECT id
       FROM message_reactions
       WHERE message_id = $1
         AND user_id = $2
         AND emoji = $3`,
      [messageId, userId, emoji]
    );

    if (existing.rows.length > 0) {
      await db.query(
        'DELETE FROM message_reactions WHERE id = $1',
        [existing.rows[0].id]
      );

      return false;
    }

    await db.query(
      `INSERT INTO message_reactions
       (message_id, user_id, emoji)
       VALUES ($1, $2, $3)`,
      [messageId, userId, emoji]
    );

    return true;
  },

  async getReactionSummary(messageId, userId) {
    const result = await db.query(
      `SELECT
         emoji,
         COUNT(*) AS count,
         MAX(
           CASE
             WHEN user_id = $1 THEN 1
             ELSE 0
           END
         ) AS reacted
       FROM message_reactions
       WHERE message_id = $2
       GROUP BY emoji
       ORDER BY count DESC, emoji ASC`,
      [userId, messageId]
    );

    return result.rows.map((r) => ({
      emoji: r.emoji,
      count: Number(r.count),
      reacted: !!Number(r.reacted),
    }));
  },

  async deleteById(id) {
    const result = await db.query(
      'DELETE FROM messages WHERE id = $1',
      [id]
    );

    return result.rowCount > 0;
  },

  async findById(id) {
    const result = await db.query(
      `SELECT
         m.*,
         u.username,
         u.display_name,
         u.avatar_url
       FROM messages m
       JOIN users u ON u.id = m.from_user_id
       WHERE m.id = $1`,
      [id]
    );

    return result.rows[0] || null;
  },

  async listForChannel(channelId, limit) {
    const n = Math.max(
      1,
      Math.min(1000, Number(limit) || 300)
    );

    const result = await db.query(
      `SELECT
         m.*,
         u.username,
         u.display_name,
         u.avatar_url
       FROM messages m
       JOIN users u ON u.id = m.from_user_id
       WHERE m.id IN (
         SELECT id
         FROM messages
         WHERE channel_id = $1
         ORDER BY id DESC
         LIMIT $2
       )
       ORDER BY m.id ASC`,
      [channelId, n]
    );

    return result.rows;
  },

  async listForDM(userA, userB, limit) {
    const n = Math.max(
      1,
      Math.min(1000, Number(limit) || 300)
    );

    const result = await db.query(
      `SELECT
         m.*,
         u.username,
         u.display_name,
         u.avatar_url
       FROM messages m
       JOIN users u ON u.id = m.from_user_id
       WHERE m.id IN (
         SELECT id
         FROM messages
         WHERE
           (from_user_id = $1 AND to_user_id = $2)
           OR
           (from_user_id = $2 AND to_user_id = $1)
         ORDER BY id DESC
         LIMIT $3
       )
       ORDER BY m.id ASC`,
      [userA, userB, n]
    );

    return result.rows;
  },

  toPublic(m) {
    return {
      id: m.id,
      channelId: m.channel_id,
      toUserId: m.to_user_id,
      content: m.content,
      createdAt: m.created_at,
      reactions: [],
      author: {
        id: m.from_user_id,
        username: m.username,
        displayName: m.display_name,
        avatarUrl: m.avatar_url,
      },
    };
  },
};

module.exports = Message;
```
