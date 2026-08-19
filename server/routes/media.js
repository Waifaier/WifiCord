const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../database/db');
const User = require('../models/User');
const { requireAuth } = require('./auth');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const ALLOWED = new Set([
  'image/png','image/jpeg','image/gif','image/webp','image/avif',
  'video/mp4','video/webm','video/quicktime','video/x-matroska',
  'audio/mpeg','audio/ogg','audio/wav','audio/webm',
  'application/pdf','application/zip','application/x-7z-compressed','application/x-rar-compressed',
  'text/plain','application/json','application/octet-stream'
]);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function safeName(name) {
  return String(name || 'arquivo').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'arquivo';
}
function publicRow(row) {
  return { id: row.id, name: row.original_name, mime: row.mime_type, size: Number(row.size_bytes), url: row.url, createdAt: row.created_at, ownerId: row.user_id };
}

router.get('/library', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM media_files WHERE user_id=? ORDER BY id DESC LIMIT 200').all(req.session.userId);
  res.json({ media: rows.map(publicRow) });
});

router.post('/upload', requireAuth, (req, res) => {
  const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  let rawName=String(req.headers['x-file-name'] || 'arquivo'); try{rawName=decodeURIComponent(rawName);}catch(_){} const name = safeName(rawName);
  const sizeHeader = Number(req.headers['content-length'] || 0);
  const user = User.findById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });
  if (sizeHeader > MAX_BYTES) return res.status(413).json({ error: 'O arquivo excede o limite de 4 GB.' });
  if (!ALLOWED.has(mime)) return res.status(415).json({ error: 'Tipo de arquivo não suportado.' });
  const ext = path.extname(name).slice(0, 12);
  const filename = `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;
  const dest = path.join(UPLOAD_DIR, filename);
  const stream = fs.createWriteStream(dest, { flags: 'wx' });
  let bytes = 0;
  let aborted = false;
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) {
      aborted = true;
      req.destroy(new Error('Arquivo muito grande'));
      stream.destroy();
      try { fs.unlinkSync(dest); } catch (_) {}
    }
  });
  req.on('aborted', () => { aborted = true; stream.destroy(); try { fs.unlinkSync(dest); } catch (_) {} });
  req.pipe(stream);
  stream.on('error', err => {
    if (!res.headersSent) res.status(500).json({ error: aborted ? 'Upload interrompido.' : 'Não foi possível salvar o arquivo.' });
  });
  stream.on('finish', () => {
    if (aborted) return;
    const stat = fs.statSync(dest);
    const url = `/uploads/${encodeURIComponent(filename)}`;
    const info = db.prepare('INSERT INTO media_files(user_id,original_name,stored_name,mime_type,size_bytes,url) VALUES(?,?,?,?,?,?)').run(req.session.userId,name,filename,mime,stat.size,url);
    const row = db.prepare('SELECT * FROM media_files WHERE id=?').get(info.lastInsertRowid);
    res.json({ ok: true, media: publicRow(row) });
  });
});

module.exports = router;
