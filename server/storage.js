const path = require('path');
const fs = require('fs');

const DEFAULT_DB_PATH = path.join(__dirname, 'database', 'chat.db');
const SQLITE_PATH = path.resolve(process.env.SQLITE_PATH || DEFAULT_DB_PATH);

const DEFAULT_UPLOAD_DIR = path.join(__dirname, 'uploads');
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR);

fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = {
  SQLITE_PATH,
  UPLOAD_DIR,
};
