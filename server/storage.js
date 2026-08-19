const path = require('path');
const fs = require('fs');

// SQLite and uploads live on Render's Persistent Disk when /var/data exists.
// Locally we keep the database inside the project. SQLITE_PATH/UPLOAD_DIR always win.
const renderDataRoot = fs.existsSync('/var/data') ? '/var/data' : null;
const DEFAULT_DATA_ROOT = renderDataRoot || path.join(__dirname, 'database');
const SQLITE_PATH = path.resolve(process.env.SQLITE_PATH || path.join(DEFAULT_DATA_ROOT, 'chat.db'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(renderDataRoot || path.join(__dirname, 'uploads'), renderDataRoot ? 'uploads' : ''));

fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = { SQLITE_PATH, UPLOAD_DIR };
