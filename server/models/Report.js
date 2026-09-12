const db = require('../database/db');

function parseEvidence(json) {
  try { return JSON.parse(json || '[]'); } catch (_) { return []; }
}
function parseContext(json) {
  try { return JSON.parse(json || '{}'); } catch (_) { return {}; }
}

// IMPORTANTE: a listagem (list()) NUNCA seleciona u.avatar_url/banner_url dos
// usuários envolvidos. Avatar/banner são salvos como data URI base64 (até
// ~2,8MB de texto por usuário — ver server/routes/auth.js) e essa mesma
// combinação (muitas linhas de uma vez, cada uma carregando o avatar
// completo de alguém) foi exatamente o que derrubou o servidor por OOM no
// histórico de mensagens (ver server/models/Message.js). O painel de admin
// não precisa do avatar pra revisar uma denúncia — só username/nome.
const Report = {
  create({ reporterId, reportedUserId, reason, evidenceUrls, context }) {
    const info = db.prepare(
      `INSERT INTO reports (reporter_id, reported_user_id, reason, evidence_json, context_json, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).run(reporterId, reportedUserId, reason, JSON.stringify(evidenceUrls || []), JSON.stringify(context || {}));
    return Report.findById(info.lastInsertRowid);
  },

  findById(id) {
    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
    return row ? Report.toPublic(row) : null;
  },

  list({ status } = {}) {
    const base = `SELECT r.*, rep.username AS reporter_username, rep.display_name AS reporter_display_name,
        tgt.username AS reported_username, tgt.display_name AS reported_display_name
      FROM reports r
      JOIN users rep ON rep.id = r.reporter_id
      JOIN users tgt ON tgt.id = r.reported_user_id`;
    const rows = status && status !== 'all'
      ? db.prepare(`${base} WHERE r.status = ? ORDER BY r.id DESC LIMIT 200`).all(status)
      : db.prepare(`${base} ORDER BY r.id DESC LIMIT 200`).all();
    return rows.map(Report.toPublicWithNames);
  },

  resolve(id, { resolution, resolvedBy }) {
    db.prepare(
      `UPDATE reports SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`
    ).run(resolution, resolvedBy, id);
    return Report.findById(id);
  },

  toPublic(r) {
    return {
      id: r.id,
      reporterId: r.reporter_id,
      reportedUserId: r.reported_user_id,
      reason: r.reason,
      evidence: parseEvidence(r.evidence_json),
      context: parseContext(r.context_json),
      status: r.status,
      resolution: r.resolution || null,
      resolvedBy: r.resolved_by || null,
      resolvedAt: r.resolved_at || null,
      createdAt: r.created_at,
    };
  },

  toPublicWithNames(r) {
    const base = Report.toPublic(r);
    base.reporter = { username: r.reporter_username, displayName: r.reporter_display_name };
    base.reportedUser = { username: r.reported_username, displayName: r.reported_display_name };
    return base;
  },
};

module.exports = Report;
