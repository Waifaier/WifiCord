const session = require('express-session');
const db = require('../database/db');

class SqliteSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.cleanupIntervalMs = options.cleanupIntervalMs || 15 * 60 * 1000;
    this.cleanupExpired();

    this.cleanupTimer = setInterval(() => {
      try {
        this.cleanupExpired();
      } catch (err) {
        this.emit('error', err);
      }
    }, this.cleanupIntervalMs);

    if (typeof this.cleanupTimer.unref === 'function') this.cleanupTimer.unref();
  }

  static expiryFromSession(sess) {
    const expires = sess?.cookie?.expires;
    if (expires) {
      const timestamp = new Date(expires).getTime();
      if (Number.isFinite(timestamp)) return timestamp;
    }

    const maxAge = Number(sess?.cookie?.maxAge);
    return Number.isFinite(maxAge) && maxAge > 0
      ? Date.now() + maxAge
      : Date.now() + 24 * 60 * 60 * 1000;
  }

  cleanupExpired() {
    db.prepare('DELETE FROM sessions WHERE expire_at <= ?').run(Date.now());
  }

  get(sid, callback) {
    try {
      const row = db.prepare('SELECT sess, expire_at FROM sessions WHERE sid=?').get(sid);
      if (!row) return callback(null, null);

      if (Number(row.expire_at) <= Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
        return callback(null, null);
      }

      let sess;
      try {
        sess = JSON.parse(row.sess);
      } catch (err) {
        db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
        return callback(err);
      }

      callback(null, sess);
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const expireAt = SqliteSessionStore.expiryFromSession(sess);
      const payload = JSON.stringify(sess);

      db.prepare(`
        INSERT INTO sessions (sid, sess, expire_at)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
          sess=excluded.sess,
          expire_at=excluded.expire_at
      `).run(sid, payload, expireAt);

      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      const expireAt = SqliteSessionStore.expiryFromSession(sess);
      db.prepare('UPDATE sessions SET expire_at=? WHERE sid=?').run(expireAt, sid);
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid, callback) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  clear(callback) {
    try {
      db.prepare('DELETE FROM sessions').run();
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  length(callback) {
    try {
      const row = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expire_at > ?').get(Date.now());
      callback?.(null, Number(row.count));
    } catch (err) {
      callback?.(err);
    }
  }

  all(callback) {
    try {
      const rows = db.prepare('SELECT sess FROM sessions WHERE expire_at > ?').all(Date.now());
      const sessions = rows.map(row => JSON.parse(row.sess));
      callback?.(null, sessions);
    } catch (err) {
      callback?.(err);
    }
  }

  ids(callback) {
    try {
      const rows = db.prepare('SELECT sid FROM sessions WHERE expire_at > ?').all(Date.now());
      callback?.(null, rows.map(row => row.sid));
    } catch (err) {
      callback?.(err);
    }
  }
}

module.exports = SqliteSessionStore;
