// Backup/restauração do banco SQLite usando o Turso como armazenamento
// durável.
//
// O app continua funcionando exatamente como antes: SQLite local, mesmo
// db.js, mesmos models, nenhuma query muda. Isso aqui só resolve o
// problema de perder tudo a cada reinício/deploy no Render, que apaga o
// disco local (efêmero) toda vez que o serviço reinicia.
//
// Como funciona:
// 1. Antes do servidor abrir o banco local (antes de qualquer outro
//    módulo dar require('./db')), baixamos o snapshot mais recente do
//    Turso, se existir, e sobrescrevemos o arquivo local com ele.
// 2. A cada poucos minutos — e sempre que o processo recebe SIGTERM/SIGINT
//    (é exatamente o sinal que o Render manda antes de reiniciar ou
//    reimplantar o serviço) — fazemos um checkpoint do WAL e enviamos o
//    arquivo .db inteiro pro Turso.
//
// Se as variáveis TURSO_DATABASE_URL / TURSO_AUTH_TOKEN não estiverem
// configuradas (ex: rodando local na sua máquina), tudo vira no-op
// silencioso: o app roda com o SQLite puramente local, do jeito que
// sempre funcionou.
//
// Importante: isso cobre usuários, mensagens, servidores, sessões — tudo
// que fica nas tabelas do banco. Arquivos enviados (avatar, banner,
// imagens/anexos do chat) ficam em UPLOAD_DIR, fora do banco, e não são
// cobertos por este backup.

const fs = require('fs');
const { SQLITE_PATH } = require('../storage');

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const BACKUP_INTERVAL_MS = Number(process.env.TURSO_BACKUP_INTERVAL_MS) || 3 * 60 * 1000; // 3 min

let client = null;
function getClient() {
  if (!TURSO_URL) return null;
  if (!client) {
    const { createClient } = require('@libsql/client');
    client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  }
  return client;
}

async function ensureTable(c) {
  await c.execute(`CREATE TABLE IF NOT EXISTS wificord_snapshots (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

async function restoreFromRemote() {
  const c = getClient();
  if (!c) {
    console.log('ℹ️  TURSO_DATABASE_URL não configurada — usando só o SQLite local, sem backup remoto.');
    return;
  }
  try {
    await ensureTable(c);
    const result = await c.execute('SELECT data, updated_at FROM wificord_snapshots WHERE id = 1');
    const row = result.rows[0];
    if (row && row.data) {
      const buf = Buffer.from(row.data);
      fs.mkdirSync(require('path').dirname(SQLITE_PATH), { recursive: true });
      fs.writeFileSync(SQLITE_PATH, buf);
      console.log(`✅ Banco restaurado do Turso (snapshot de ${row.updated_at}, ${(buf.length / 1024).toFixed(1)} KB).`);
    } else {
      console.log('ℹ️  Nenhum snapshot no Turso ainda — começando com banco novo (primeiro backup cria o snapshot).');
    }
  } catch (err) {
    console.error('⚠️  Falha ao restaurar do Turso, seguindo com o banco local se existir:', err.message);
  }
}

async function backupToRemote() {
  const c = getClient();
  if (!c) return;
  try {
    // Garante que tudo que estava só no WAL foi gravado no arquivo
    // principal antes de ler os bytes — senão o snapshot pode sair
    // incompleto.
    try {
      const db = require('./db');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (_) {}

    if (!fs.existsSync(SQLITE_PATH)) return;
    const buf = fs.readFileSync(SQLITE_PATH);
    await ensureTable(c);
    await c.execute({
      sql: `INSERT INTO wificord_snapshots (id, data, updated_at) VALUES (1, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
      args: [buf],
    });
    console.log(`💾 Backup enviado ao Turso (${(buf.length / 1024).toFixed(1)} KB).`);
  } catch (err) {
    console.error('⚠️  Falha ao enviar backup pro Turso:', err.message);
  }
}

let backupTimer = null;
let signalsBound = false;

function startAutoBackup() {
  if (!getClient()) return; // sem Turso configurado, não faz nada

  if (!backupTimer) {
    backupTimer = setInterval(() => { backupToRemote(); }, BACKUP_INTERVAL_MS);
    if (typeof backupTimer.unref === 'function') backupTimer.unref();
    console.log(`🔁 Backup automático pro Turso ativado (a cada ${Math.round(BACKUP_INTERVAL_MS / 60000)} min).`);
  }

  if (!signalsBound) {
    signalsBound = true;
    // O Render manda SIGTERM antes de reiniciar/reimplantar o serviço —
    // esse é o momento mais importante de fazer backup, pra não depender
    // só do intervalo periódico e perder as últimas mensagens.
    let shuttingDown = false;
    const finalBackup = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`🔻 Recebido ${signal}, enviando backup final pro Turso antes de encerrar...`);
      await backupToRemote();
      process.exit(0);
    };
    process.on('SIGTERM', () => finalBackup('SIGTERM'));
    process.on('SIGINT', () => finalBackup('SIGINT'));
  }
}

module.exports = { restoreFromRemote, backupToRemote, startAutoBackup };
