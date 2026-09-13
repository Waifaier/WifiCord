const db = require('../database/db');

// Avisos da equipe: uma mensagem que a administração manda e que aparece
// pra TODO MUNDO (como um pop-up), tanto pra quem já está com o site aberto
// (via socket, em tempo real) quanto pra quem abrir o site depois (via
// GET /current) — nesse segundo caso o cliente compara com o último aviso
// que ele mesmo já marcou como lido (guardado no localStorage dele, não
// aqui) pra decidir se mostra de novo ou não.
const Announcement = {
  create({ title, message, createdBy }) {
    const info = db.prepare(
      'INSERT INTO announcements (title, message, created_by) VALUES (?, ?, ?)'
    ).run(title, message, createdBy || null);
    return Announcement.findById(info.lastInsertRowid);
  },

  findById(id) {
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    return row ? Announcement.toPublic(row) : null;
  },

  current() {
    const row = db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 1').get();
    return row ? Announcement.toPublic(row) : null;
  },

  toPublic(r) {
    return {
      id: r.id,
      title: r.title,
      message: r.message,
      createdAt: r.created_at,
    };
  },
};

module.exports = Announcement;
