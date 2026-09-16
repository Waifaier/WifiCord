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
// que fica nas tabelas do banco principal (chat.db). Arquivos enviados
// (avatar, banner, imagens/anexos do chat) ficam em UPLOAD_DIR, fora do
// banco, e não são cobertos por este backup.
//
// MOTIVO RAIZ do "save do Meia-Lua sempre volta pro nível 1": o banco do
// jogo (meia-lua.sqlite, arquivo SEPARADO do chat.db — ver
// server/server.js e games/meia-lua/server/integration.js) fica na mesma
// pasta do chat.db, mas nunca foi incluído neste backup — só o chat.db
// (tabela wificord_snapshots, id=1) sempre foi salvo/restaurado. Então a
// cada reinício do processo no Render (deploy, ou o serviço "dormir" por
// inatividade e acordar de novo), o chat.db voltava do Turso normalmente
// mas o meia-lua.sqlite nascia zerado no disco efêmero — exatamente o
// "volta pro level 1 com 50 de dinheiro". `registerExtraFile`/
// `restoreExtraFile` abaixo generalizam esse mesmo mecanismo pra outros
// arquivos .sqlite além do chat.db, numa tabela própria
// (wificord_extra_snapshots) — sem mexer em nada da lógica/tabela do
// chat.db acima, pra não arriscar o backup que já funciona.

const fs = require('fs');
const path = require('path');
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
      fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
      fs.writeFileSync(SQLITE_PATH, buf);
      console.log(`✅ Banco restaurado do Turso (snapshot de ${row.updated_at}, ${(buf.length / 1024).toFixed(1)} KB).`);
    } else {
      console.log('ℹ️  Nenhum snapshot no Turso ainda — começando com banco novo (primeiro backup cria o snapshot).');
    }
  } catch (err) {
    console.error('⚠️  Falha ao restaurar do Turso, seguindo com o banco local se existir:', err.message);
  }
}

// ---------------------------------------------------------------------
// Arquivos "extra" (fora do chat.db) — hoje usado só pelo meia-lua.sqlite,
// mas serve pra qualquer outro banco separado que apareça no futuro. Fica
// em tabela própria, separada de wificord_snapshots, de propósito: zero
// chance de uma migração de schema aqui afetar o backup do chat que já
// funciona em produção.
const extraFiles = []; // [{ path, key, checkpoint? }]

async function ensureExtraTable(c) {
  await c.execute(`CREATE TABLE IF NOT EXISTS wificord_extra_snapshots (
    key TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

/**
 * Restaura um arquivo .sqlite extra do Turso pro disco local, se existir
 * snapshot. Preciso ser chamado ANTES de qualquer módulo abrir esse
 * arquivo (mesma regra do restoreFromRemote() pro chat.db) — ver a chamada
 * em server/server.js, logo antes de montar o Meia-Lua.
 * @param {string} filePath caminho absoluto do arquivo .sqlite local
 * @param {string} key identificador único desse arquivo (ex: "meia-lua")
 */
async function restoreExtraFile(filePath, key) {
  const c = getClient();
  if (!c) return; // sem Turso configurado — mesmo no-op silencioso do chat.db
  try {
    await ensureExtraTable(c);
    const result = await c.execute({ sql: 'SELECT data, updated_at FROM wificord_extra_snapshots WHERE key = ?', args: [key] });
    const row = result.rows[0];
    if (row && row.data) {
      const buf = Buffer.from(row.data);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buf);
      console.log(`✅ [${key}] restaurado do Turso (snapshot de ${row.updated_at}, ${(buf.length / 1024).toFixed(1)} KB).`);
    } else {
      console.log(`ℹ️  [${key}] nenhum snapshot no Turso ainda — começando com banco novo.`);
    }
  } catch (err) {
    console.error(`⚠️  Falha ao restaurar [${key}] do Turso, seguindo com o banco local se existir:`, err.message);
  }
}

/**
 * Registra um arquivo extra pra entrar no backup periódico/SIGTERM daqui
 * pra frente (chamado por backupToRemote() junto com o chat.db).
 * @param {string} filePath caminho absoluto do arquivo .sqlite local
 * @param {string} key identificador único desse arquivo (ex: "meia-lua")
 * @param {() => void} [checkpoint] opcional — roda um PRAGMA
 *   wal_checkpoint antes de ler os bytes, igual o chat.db faz com o
 *   require('./db') dele; sem isso o snapshot pode sair sem as escritas
 *   mais recentes que ainda só existem no arquivo -wal.
 */
function registerExtraFile(filePath, key, checkpoint) {
  if (extraFiles.some((f) => f.key === key)) return; // evita duplicar se chamado de novo
  extraFiles.push({ path: filePath, key, checkpoint });
}

async function backupExtraFile({ path: filePath, key, checkpoint }) {
  const c = getClient();
  if (!c) return;
  try {
    if (checkpoint) { try { checkpoint(); } catch (_) { /* melhor tentar sem checkpoint do que não salvar nada */ } }
    if (!fs.existsSync(filePath)) return;
    const buf = fs.readFileSync(filePath);
    await ensureExtraTable(c);
    await c.execute({
      sql: `INSERT INTO wificord_extra_snapshots (key, data, updated_at) VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
      args: [key, buf],
    });
    console.log(`💾 [${key}] backup enviado ao Turso (${(buf.length / 1024).toFixed(1)} KB).`);
  } catch (err) {
    console.error(`⚠️  Falha ao enviar backup [${key}] pro Turso:`, err.message);
  }
}

async function backupMainFile(c) {
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

async function backupToRemote() {
  const c = getClient();
  if (!c) return;
  // backupMainFile() nunca deixa o `return` cedo dela (ex: chat.db ainda
  // não existir) impedir o backup dos arquivos extra abaixo — motivo de
  // ela ser uma função própria em vez de estar tudo solto aqui, com um
  // `return` que cortaria a função inteira no meio.
  await backupMainFile(c);
  // Arquivos extra (meia-lua.sqlite etc.) — cada um em try/catch próprio
  // dentro de backupExtraFile, então um falhar não impede os outros nem o
  // backup do chat.db acima.
  for (const f of extraFiles) await backupExtraFile(f);
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
    // só do intervalo periódico e perder as últimas mensagens (ou, agora,
    // o progresso mais recente do Meia-Lua).
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

module.exports = { restoreFromRemote, backupToRemote, startAutoBackup, restoreExtraFile, registerExtraFile };
