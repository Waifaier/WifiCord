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
    customStatusText: user.custom_status_text || '', customStatusEmoji: user.custom_status_emoji || '',
    points: Number(user.points || 0), wfna: !!user.wfna, role: user.role || 'user', superEmojiUses: Number(user.super_emoji_uses || 0), superEmojiRemaining: user.wfna ? null : Math.max(0, 10 - Number(user.super_emoji_uses || 0)),
    decoration: user.decoration || null, frame: user.frame || null, settings: user.settings_json ? (()=>{try{return JSON.parse(user.settings_json)}catch(_){return {}}})() : {},
  };
}

const User = {
  create({ username, email, password, displayName }) {
    const hash = bcrypt.hashSync(password, SALT_ROUNDS);
    const stmt = db.prepare(`
      INSERT INTO users (username, email, password_hash, display_name, status)
      VALUES (?, ?, ?, ?, 'online')
    `);
    const info = stmt.run(username, email, hash, displayName || username);
    return User.findById(info.lastInsertRowid);
  },

  findById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  findByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  },

  findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },

  verifyPassword(user, password) {
    return bcrypt.compareSync(password, user.password_hash);
  },

  setStatus(id, status) { db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id); },
  setCustomStatus(id, status, text, emoji) {
    db.prepare('UPDATE users SET status=?, custom_status_text=?, custom_status_emoji=? WHERE id=?').run(status, text || '', emoji || '', id);
    return User.findById(id);
  },
  consumeSuperEmoji(id) {
    const user = User.findById(id);
    if (!user) throw new Error('Usuário não encontrado.');
    if (user.wfna) return { allowed: true, remaining: null };
    const used = Number(user.super_emoji_uses || 0);
    if (used >= 10) return { allowed: false, remaining: 0 };
    db.prepare('UPDATE users SET super_emoji_uses=super_emoji_uses+1 WHERE id=?').run(id);
    return { allowed: true, remaining: Math.max(0, 9 - used) };
  },
  resetSuperEmojiUses(id) { db.prepare('UPDATE users SET super_emoji_uses=0 WHERE id=?').run(id); return User.findById(id); },
  addPoints(id, amount, reason) {
    const tx=db.transaction(()=>{ db.prepare('UPDATE users SET points=MAX(0, points + ?) WHERE id=?').run(amount,id); db.prepare('INSERT INTO point_events(user_id,amount,reason) VALUES (?,?,?)').run(id,amount,reason); return User.findById(id); }); return tx();
  },
  setPoints(id, points) { db.prepare('UPDATE users SET points=MAX(0,?) WHERE id=?').run(points,id); return User.findById(id); },
  setWFNA(id, value) { db.prepare('UPDATE users SET wfna=? WHERE id=?').run(value?1:0,id); return User.findById(id); },
  setRole(id, role) { db.prepare('UPDATE users SET role=? WHERE id=?').run(role,id); return User.findById(id); },
  setModeration(id, field, value) { const allowed={bannedUntil:'banned_until',chatMutedUntil:'chat_muted_until',voiceMutedUntil:'voice_muted_until',punishedUntil:'punished_until',punishmentReason:'punishment_reason',rainbowUntil:'rainbow_until'}; const col=allowed[field]; if(!col) throw new Error('Campo de moderação inválido.'); db.prepare(`UPDATE users SET ${col}=? WHERE id=?`).run(value ?? null,id); return User.findById(id); },
  clearModeration(id) { db.prepare('UPDATE users SET banned_until=NULL,chat_muted_until=NULL,voice_muted_until=NULL,punished_until=NULL,punishment_reason=NULL,rainbow_until=NULL WHERE id=?').run(id); return User.findById(id); },
  isBanned(user) { return !!user && (Number(user.banned_until) === -1 || (user.banned_until != null && Number(user.banned_until) > Date.now())); },
  isChatMuted(user) { return !!user && (Number(user.chat_muted_until) === -1 || (user.chat_muted_until != null && Number(user.chat_muted_until) > Date.now()) || Number(user.punished_until) === -1 || (user.punished_until != null && Number(user.punished_until) > Date.now())); },
  isVoiceMuted(user) { return !!user && (Number(user.voice_muted_until) === -1 || (user.voice_muted_until != null && Number(user.voice_muted_until) > Date.now()) || Number(user.punished_until) === -1 || (user.punished_until != null && Number(user.punished_until) > Date.now())); },
  updateSettings(id, settings) { const current=User.findById(id); let merged={}; try{merged=current?.settings_json?JSON.parse(current.settings_json):{}}catch(_){ } merged={...merged,...(settings||{})}; db.prepare('UPDATE users SET settings_json=? WHERE id=?').run(JSON.stringify(merged),id); return User.findById(id); },

  setAvatar(id, avatarUrl) { db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl || null, id); },
  updateProfile(id, { displayName, avatarUrl, bannerUrl, bio }) {
    db.prepare('UPDATE users SET display_name = ?, avatar_url = ?, banner_url = ?, bio = ? WHERE id = ?').run(displayName, avatarUrl || null, bannerUrl || null, bio || '', id);
    return User.findById(id);
  },

  toPublic: publicUser,
};

module.exports = User;
