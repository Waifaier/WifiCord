```js
const db = require('../database/db');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    status: user.status,
    bannerUrl: user.banner_url || null,
    bio: user.bio || '',
    customStatusText: user.custom_status_text || '',
    customStatusEmoji: user.custom_status_emoji || '',
    points: Number(user.points || 0),
    wfna: !!user.wfna,
    role: user.role || 'user',
    superEmojiUses: Number(user.super_emoji_uses || 0),
    superEmojiRemaining: user.wfna
      ? null
      : Math.max(0, 10 - Number(user.super_emoji_uses || 0)),
    decoration: user.decoration || null,
    frame: user.frame || null,
    settings: user.settings_json
      ? (() => {
          try {
            return JSON.parse(user.settings_json);
          } catch (_) {
            return {};
          }
        })()
      : {},
  };
}

async function getUserByQuery(query, params) {
  const result = await db.query(query, params);
  return result.rows[0] || null;
}

const User = {
  async create({ username, email, password, displayName }) {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await db.query(
      `INSERT INTO users
       (username, email, password_hash, display_name, status)
       VALUES ($1, $2, $3, $4, 'online')
       RETURNING *`,
      [username, email, hash, displayName || username]
    );

    return result.rows[0];
  },

  async findById(id) {
    return getUserByQuery(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
  },

  async findByEmail(email) {
    return getUserByQuery(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
  },

  async findByUsername(username) {
    return getUserByQuery(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
  },

  async verifyPassword(user, password) {
    return bcrypt.compare(password, user.password_hash);
  },

  async setStatus(id, status) {
    await db.query(
      'UPDATE users SET status = $1 WHERE id = $2',
      [status, id]
    );
  },

  async setCustomStatus(id, status, text, emoji) {
    await db.query(
      `UPDATE users
       SET status = $1,
           custom_status_text = $2,
           custom_status_emoji = $3
       WHERE id = $4`,
      [status, text || '', emoji || '', id]
    );

    return User.findById(id);
  },

  async consumeSuperEmoji(id) {
    const user = await User.findById(id);

    if (!user) {
      throw new Error('Usuário não encontrado.');
    }

    if (user.wfna) {
      return { allowed: true, remaining: null };
    }

    const used = Number(user.super_emoji_uses || 0);

    if (used >= 10) {
      return { allowed: false, remaining: 0 };
    }

    await db.query(
      `UPDATE users
       SET super_emoji_uses = super_emoji_uses + 1
       WHERE id = $1`,
      [id]
    );

    return {
      allowed: true,
      remaining: Math.max(0, 9 - used),
    };
  },

  async resetSuperEmojiUses(id) {
    await db.query(
      'UPDATE users SET super_emoji_uses = 0 WHERE id = $1',
      [id]
    );

    return User.findById(id);
  },

  async addPoints(id, amount, reason) {
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE users
         SET points = GREATEST(0, points + $1)
         WHERE id = $2`,
        [amount, id]
      );

      await client.query(
        `INSERT INTO point_events
         (user_id, amount, reason)
         VALUES ($1, $2, $3)`,
        [id, amount, reason]
      );

      const result = await client.query(
        'SELECT * FROM users WHERE id = $1',
        [id]
      );

      await client.query('COMMIT');

      return result.rows[0] || null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async setPoints(id, points) {
    await db.query(
      `UPDATE users
       SET points = GREATEST(0, $1)
       WHERE id = $2`,
      [points, id]
    );

    return User.findById(id);
  },

  async setWFNA(id, value) {
    await db.query(
      'UPDATE users SET wfna = $1 WHERE id = $2',
      [value ? true : false, id]
    );

    return User.findById(id);
  },

  async setRole(id, role) {
    await db.query(
      'UPDATE users SET role = $1 WHERE id = $2',
      [role, id]
    );

    return User.findById(id);
  },

  async setModeration(id, field, value) {
    const allowed = {
      bannedUntil: 'banned_until',
      chatMutedUntil: 'chat_muted_until',
      voiceMutedUntil: 'voice_muted_until',
      punishedUntil: 'punished_until',
      punishmentReason: 'punishment_reason',
      rainbowUntil: 'rainbow_until',
    };

    const col = allowed[field];

    if (!col) {
      throw new Error('Campo de moderação inválido.');
    }

    await db.query(
      `UPDATE users SET ${col} = $1 WHERE id = $2`,
      [value ?? null, id]
    );

    return User.findById(id);
  },

  async clearModeration(id) {
    await db.query(
      `UPDATE users
       SET banned_until = NULL,
           chat_muted_until = NULL,
           voice_muted_until = NULL,
           punished_until = NULL,
           punishment_reason = NULL,
           rainbow_until = NULL
       WHERE id = $1`,
      [id]
    );

    return User.findById(id);
  },

  isBanned(user) {
    return !!user &&
      (
        Number(user.banned_until) === -1 ||
        (
          user.banned_until != null &&
          Number(user.banned_until) > Date.now()
        )
      );
  },

  isChatMuted(user) {
    return !!user &&
      (
        Number(user.chat_muted_until) === -1 ||
        (
          user.chat_muted_until != null &&
          Number(user.chat_muted_until) > Date.now()
        ) ||
        Number(user.punished_until) === -1 ||
        (
          user.punished_until != null &&
          Number(user.punished_until) > Date.now()
        )
      );
  },

  isVoiceMuted(user) {
    return !!user &&
      (
        Number(user.voice_muted_until) === -1 ||
        (
          user.voice_muted_until != null &&
          Number(user.voice_muted_until) > Date.now()
        ) ||
        Number(user.punished_until) === -1 ||
        (
          user.punished_until != null &&
          Number(user.punished_until) > Date.now()
        )
      );
  },

  async updateSettings(id, settings) {
    const current = await User.findById(id);

    let merged = {};

    try {
      merged = current?.settings_json
        ? JSON.parse(current.settings_json)
        : {};
    } catch (_) {}

    merged = {
      ...merged,
      ...(settings || {}),
    };

    await db.query(
      'UPDATE users SET settings_json = $1 WHERE id = $2',
      [JSON.stringify(merged), id]
    );

    return User.findById(id);
  },

  async setAvatar(id, avatarUrl) {
    await db.query(
      'UPDATE users SET avatar_url = $1 WHERE id = $2',
      [avatarUrl || null, id]
    );
  },

  async updateProfile(id, {
    displayName,
    avatarUrl,
    bannerUrl,
    bio,
  }) {
    await db.query(
      `UPDATE users
       SET display_name = $1,
           avatar_url = $2,
           banner_url = $3,
           bio = $4
       WHERE id = $5`,
      [
        displayName,
        avatarUrl || null,
        bannerUrl || null,
        bio || '',
        id,
      ]
    );

    return User.findById(id);
  },

  toPublic: publicUser,
};

module.exports = User;
```
