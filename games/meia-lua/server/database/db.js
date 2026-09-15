// Camada de banco de dados SQLite.
// Usa o módulo nativo "node:sqlite" (Node >= 22.13), sem dependências nativas para compilar.
// Se não estiver disponível, tenta "better-sqlite3" (instale manualmente com npm i better-sqlite3).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let DatabaseCtor = null;
let driver = '';
try {
  const mod = await import('node:sqlite');
  DatabaseCtor = mod.DatabaseSync;
  driver = 'node:sqlite';
} catch {
  try {
    const mod = await import('better-sqlite3');
    DatabaseCtor = mod.default;
    driver = 'better-sqlite3';
  } catch {
    console.error('\n[db] Nenhum driver SQLite encontrado. Use Node.js 22.13+ ou rode: npm i better-sqlite3\n');
    process.exit(1);
  }
}

const dbFile = path.resolve(config.dbPath);
if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new DatabaseCtor(dbFile);
console.log(`[db] SQLite (${driver}) em ${dbFile}`);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  pass_hash TEXT,
  pass_salt TEXT,
  is_guest INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  money INTEGER NOT NULL DEFAULT 50,
  attr_points INTEGER NOT NULL DEFAULT 0,
  coragem INTEGER NOT NULL DEFAULT 1,
  investigacao INTEGER NOT NULL DEFAULT 1,
  velocidade INTEGER NOT NULL DEFAULT 1,
  resistencia INTEGER NOT NULL DEFAULT 1,
  tecnica INTEGER NOT NULL DEFAULT 1,
  max_night INTEGER NOT NULL DEFAULT 1,
  equip_lanterna TEXT DEFAULT 'lanterna_velha',
  equip_corpo TEXT,
  equip_pes TEXT,
  equip_acessorio TEXT,
  -- Vínculo com a conta do WifiCord (login único — ver
  -- server/routes/meiaLua.js e server/database/accounts.js#loginOrCreateLinkedAccount
  -- no repositório do WifiCord). NULL para contas antigas/standalone
  -- (ex.: rodando o jogo fora do WifiCord, com "npm start" nesta pasta).
  wificord_user_id INTEGER,
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  PRIMARY KEY (account_id, item_id)
);

CREATE TABLE IF NOT EXISTS stats (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  nights_played INTEGER NOT NULL DEFAULT 0,
  nights_won INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  missions_completed INTEGER NOT NULL DEFAULT 0,
  items_found INTEGER NOT NULL DEFAULT 0,
  jumpscares INTEGER NOT NULL DEFAULT 0,
  play_seconds INTEGER NOT NULL DEFAULT 0,
  true_ending INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS night_progress (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  night INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  best_missions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, night)
);
`);

// Migração aditiva: bancos criados antes do login único não tinham a
// coluna wificord_user_id. SQLite não tem "ADD COLUMN IF NOT EXISTS", então
// conferimos o schema atual antes de adicionar. Índice único é criado à
// parte (ADD COLUMN não aceita UNIQUE direto) e ignora linhas antigas com
// wificord_user_id NULL (várias linhas podem ter NULL sem violar o índice).
{
  const cols = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  if (!cols.includes('wificord_user_id')) {
    db.exec('ALTER TABLE accounts ADD COLUMN wificord_user_id INTEGER');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_wificord_user_id ON accounts(wificord_user_id) WHERE wificord_user_id IS NOT NULL');
}

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Limpeza de sessões expiradas
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
