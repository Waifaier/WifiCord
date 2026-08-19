const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../database/db');
const { requireAuth } = require('./auth');
const { UPLOAD_DIR } = require('../storage');

const router = express.Router();
const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const ALLOWED = new Set([
  'image/png','image/jpeg','image/gif','image/webp','image/avif',
  'video/mp4','video/webm','video/quicktime','video/x-matroska',
  'audio/mpeg','audio/ogg','audio/wav','audio/webm',
  'application/pdf','application/zip','application/x-7z-compressed',
  'application/x-rar-compressed','text/plain','application/json','application/octet-stream'
]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function safeName(name) {
  return String(name || 'arquivo').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'arquivo';
}
function publicRow(row) {
  return { id: row.id, name: row.original_name, mime: row.mime_type, size: Number(row.size_bytes), url: row.url, createdAt: row.created_at, ownerId: row.user_id };
}

router.get('/library', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM media_files WHERE user_id = ? ORDER BY id DESC LIMIT 200`).all(Number(req.session.userId));
    res.json({ media: rows.map(publicRow) });
  } catch (err) {
    console.error('Erro ao carregar biblioteca:', err);
    res.status(500).json({ error: 'Não foi possível carregar a biblioteca.' });
  }
});

router.post('/upload', requireAuth, (req, res) => {
  const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  let rawName = String(req.headers['x-file-name'] || 'arquivo');
  try { rawName = decodeURIComponent(rawName); } catch (_) {}
  const name = safeName(rawName);
  const sizeHeader = Number(req.headers['content-length'] || 0);

  if (sizeHeader > MAX_BYTES) return res.status(413).json({ error: 'O arquivo excede o limite de 4 GB.' });
  if (!ALLOWED.has(mime)) return res.status(415).json({ error: 'Tipo de arquivo não suportado.' });

  const ext = path.extname(name).slice(0, 12);
  const filename = `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;
  const dest = path.join(UPLOAD_DIR, filename);
  const stream = fs.createWriteStream(dest, { flags: 'wx' });
  let bytes = 0;
  let aborted = false;
  let responded = false;

  const cleanup = () => { try { fs.unlinkSync(dest); } catch (_) {} };
  const fail = (status, error) => {
    if (responded || res.headersSent) return;
    responded = true;
    cleanup();
    res.status(status).json({ error });
  };

  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > MAX_BYTES && !aborted) {
      aborted = true;
      stream.destroy();
      req.destroy();
      fail(413, 'O arquivo excede o limite de 4 GB.');
    }
  });
  req.on('aborted', () => { aborted = true; stream.destroy(); cleanup(); });
  stream.on('error', err => {
    console.error('Erro no upload:', err);
    fail(500, aborted ? 'Upload interrompido.' : 'Não foi possível salvar o arquivo.');
  });
  stream.on('finish', () => {
    if (aborted || responded) return;
    try {
      const stat = fs.statSync(dest);
      if (stat.size > MAX_BYTES) return fail(413, 'O arquivo excede o limite de 4 GB.');
      const url = `/uploads/${encodeURIComponent(filename)}`;
      const info = db.prepare(`INSERT INTO media_files (user_id, original_name, stored_name, mime_type, size_bytes, url) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(Number(req.session.userId), name, filename, mime, stat.size, url);
      const row = db.prepare('SELECT * FROM media_files WHERE id = ?').get(Number(info.lastInsertRowid));
      responded = true;
      res.json({ ok: true, media: publicRow(row) });
    } catch (err) {
      console.error('Erro ao registrar mídia no SQLite:', err);
      fail(500, 'Não foi possível registrar o arquivo.');
    }
  });
  req.pipe(stream);
});

module.exports = router;
