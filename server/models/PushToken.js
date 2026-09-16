const db = require('../database/db');

// Tokens de notificação push (FCM) por dispositivo — usados pra "acordar"
// o app no celular (fechado/tela bloqueada) quando uma ligação chega e a
// pessoa não está com nenhum socket conectado no momento.
const PushTokenModel = {
  register(userId, token, platform) {
    const clean = String(token || '').trim().slice(0, 512);
    if (!userId || !clean) return;
    db.prepare(`
      INSERT INTO push_tokens(user_id, token, platform) VALUES (?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = datetime('now')
    `).run(userId, clean, String(platform || 'android').slice(0, 32));
  },
  unregister(token) {
    if (!token) return;
    db.prepare('DELETE FROM push_tokens WHERE token = ?').run(String(token).trim().slice(0, 512));
  },
  listForUser(userId) {
    if (!userId) return [];
    return db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(userId).map(r => r.token);
  },
  // Todos os tokens de todo mundo — usado só pros "avisos do app" (anúncios
  // de admin), que são pra todo usuário ver, diferente de ligação/mensagem
  // que são só pra uma pessoa.
  allTokens() {
    return db.prepare('SELECT token FROM push_tokens').all().map(r => r.token);
  },
};

module.exports = PushTokenModel;
