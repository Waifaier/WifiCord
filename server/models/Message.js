const db = require('../database/db');

const Message = {
  createChannelMessage(channelId, fromUserId, content) {
    const stmt = db.prepare('INSERT INTO messages (channel_id, from_user_id, content) VALUES (?, ?, ?)');
    const info = stmt.run(channelId, fromUserId, content);
    return Message.findById(info.lastInsertRowid);
  },

  createDirectMessage(fromUserId, toUserId, content) {
    const stmt = db.prepare('INSERT INTO messages (from_user_id, to_user_id, content) VALUES (?, ?, ?)');
    const info = stmt.run(fromUserId, toUserId, content);
    return Message.findById(info.lastInsertRowid);
  },

  listReactions(messageId) {
    return db.prepare(`SELECT r.emoji, COUNT(*) AS count, MAX(CASE WHEN r.user_id = ? THEN 1 ELSE 0 END) AS reacted
      FROM message_reactions r WHERE r.message_id = ? GROUP BY r.emoji ORDER BY count DESC, r.emoji ASC`).all(0, messageId);
  },

  toggleReaction(messageId, userId, emoji) {
    const exists = db.prepare('SELECT id FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?').get(messageId, userId, emoji);
    if (exists) {
      db.prepare('DELETE FROM message_reactions WHERE id=?').run(exists.id);
      return false;
    }
    db.prepare('INSERT INTO message_reactions(message_id,user_id,emoji) VALUES (?,?,?)').run(messageId, userId, emoji);
    return true;
  },

  getReactionSummary(messageId, userId) {
    return db.prepare(`SELECT emoji, COUNT(*) AS count, MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS reacted
      FROM message_reactions WHERE message_id=? GROUP BY emoji ORDER BY count DESC, emoji ASC`).all(userId, messageId).map(r=>({emoji:r.emoji,count:Number(r.count),reacted:!!r.reacted}));
  },

  deleteById(id) {
    const info = db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    return info.changes > 0;
  },

  deleteDMConversation(userA, userB) {
    const info = db.prepare(`DELETE FROM messages WHERE (from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?)`)
      .run(userA, userB, userB, userA);
    return info.changes;
  },

  editContent(id, content) {
    db.prepare("UPDATE messages SET content=?, edited_at=datetime('now') WHERE id=?").run(content, id);
    return Message.findById(id);
  },

  setPinned(id, pinned, byUserId) {
    if (pinned) db.prepare("UPDATE messages SET pinned_at=datetime('now'), pinned_by=? WHERE id=?").run(byUserId, id);
    else db.prepare('UPDATE messages SET pinned_at=NULL, pinned_by=NULL WHERE id=?').run(id);
    return Message.findById(id);
  },

  listPinnedForChannel(channelId) {
    return db.prepare(`SELECT m.*, u.username, u.display_name, u.avatar_url
      FROM messages m JOIN users u ON u.id=m.from_user_id
      WHERE m.channel_id=? AND m.pinned_at IS NOT NULL
      ORDER BY m.pinned_at DESC`).all(channelId);
  },

  findById(id) {
    return db
      .prepare(
        `SELECT m.*, u.username, u.display_name, u.avatar_url
         FROM messages m JOIN users u ON u.id = m.from_user_id
         WHERE m.id = ?`
      )
      .get(id);
  },

  listForChannel(channelId, limit) {
    const n=Math.max(1,Math.min(1000,Number(limit)||300));
    return db.prepare(`SELECT m.*, u.username, u.display_name, u.avatar_url
      FROM messages m JOIN users u ON u.id=m.from_user_id
      WHERE m.id IN (SELECT id FROM messages WHERE channel_id=? ORDER BY id DESC LIMIT ?)
      ORDER BY m.id ASC`).all(channelId,n);
  },

  listForDM(userA, userB, limit) {
    const n=Math.max(1,Math.min(1000,Number(limit)||300));
    return db.prepare(`SELECT m.*, u.username, u.display_name, u.avatar_url
      FROM messages m JOIN users u ON u.id=m.from_user_id
      WHERE m.id IN (SELECT id FROM messages WHERE ((from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?)) ORDER BY id DESC LIMIT ?)
      ORDER BY m.id ASC`).all(userA,userB,userB,userA,n);
  },

  toPublic(m) {
    return {
      id: m.id,
      channelId: m.channel_id,
      toUserId: m.to_user_id,
      content: m.content,
      createdAt: m.created_at,
      editedAt: m.edited_at || null,
      pinnedAt: m.pinned_at || null,
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
