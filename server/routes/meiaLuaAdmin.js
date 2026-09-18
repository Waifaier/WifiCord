// Painel Admin do Meia-Lua — router CJS do WifiCord (o jogo em si é ESM,
// ver comentário grande em server/server.js e em games/meia-lua/server/
// integration.js). Reaproveita EXATAMENTE o mesmo padrão de autorização
// admin que já existe em server/routes/admin.js (mesmo requireAuth, mesma
// checagem `role==='admin'` via User.findById, mesma tabela admin_actions
// pra log) — nada novo inventado pra autenticação/autorização.
//
// Segurança (pedido explícito, tratado como crítico):
//  - NUNCA confia em nada que o cliente mande sobre ser admin — a única
//    fonte de verdade é `req.session.userId` + `User.findById(...).role`,
//    igual o resto do painel admin do WifiCord já fazia.
//  - `router.use(requireAuth, admin)` protege TODAS as rotas abaixo,
//    incluindo a que serve a PÁGINA HTML (pedido: "não esconda só o
//    botão — proteja a rota E as APIs") — um usuário comum recebe 401/403
//    tanto pra a página quanto pra qualquer chamada de API.
//  - Toda ação que muda o estado de uma partida passa pela camada
//    adminBridge.js (ESM, já carregada — ver integration.js), que por sua
//    vez só chama métodos REAIS de Match.js — nenhuma rota aqui manipula
//    Match diretamente nem duplica regra de jogo nenhuma.
const express = require('express');
const path = require('path');
const db = require('../database/db');
const User = require('../models/User');
const { requireAuth } = require('./auth');

function admin(req, res, next) {
  const u = User.findById(req.session.userId);
  if (u?.role !== 'admin') return res.status(403).json({ error: 'Acesso administrativo negado.' });
  next();
}

function logAction(adminId, action, payload = {}) {
  db.prepare('INSERT INTO admin_actions(admin_id,target_user_id,action,payload_json) VALUES (?,?,?,?)').run(adminId, null, action, JSON.stringify(payload));
}

/**
 * @param {object} opts
 * @param {object} opts.adminBridge - o objeto devolvido por createAdminBridge (ver games/meia-lua/server/adminBridge.js), já carregado por integration.js/mountMeiaLua e repassado por server.js.
 */
function createMeiaLuaAdminRouter({ adminBridge }) {
  const router = express.Router();
  router.use(express.json({ limit: '8kb' }));
  router.use(requireAuth, admin);

  const wrap = (fn) => (req, res) => {
    try {
      const out = fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
      if (status === 500) console.error('[meia-lua admin]', err);
      res.status(status).json({ error: status === 500 ? 'Erro interno.' : err.message });
    }
  };

  // Página do painel — fora de QUALQUER diretório servido por
  // express.static (ver comentário no topo), então só chega até aqui
  // passando pelo requireAuth+admin logo acima. Nunca colocar esse HTML
  // dentro de games/meia-lua/client (aquilo é servido sem autenticação
  // nenhuma pro jogo em si).
  router.get('/', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '..', 'adminPanels', 'meiaLuaAdmin.html'));
  });

  router.get('/api/matches', wrap(() => ({ matches: adminBridge.listMatches() })));
  router.get('/api/matches/:code', wrap((req) => ({ match: adminBridge.getMatchDetail(req.params.code) })));

  router.post('/api/matches/:code/event', wrap((req) => {
    const { type, targetId, targetIds, broadcast } = req.body || {};
    const out = adminBridge.triggerEvent(req.params.code, { type: String(type || ''), targetId, targetIds, broadcast: !!broadcast });
    logAction(req.session.userId, 'meialua:event', { code: req.params.code, type, targetId, targetIds, broadcast: !!broadcast });
    return out;
  }));

  router.post('/api/matches/:code/tension', wrap((req) => {
    const { delta, value } = req.body || {};
    const out = adminBridge.setTension(req.params.code, { delta, value });
    logAction(req.session.userId, 'meialua:tension', { code: req.params.code, delta, value });
    return out;
  }));

  router.post('/api/matches/:code/show', wrap((req) => {
    const out = adminBridge.forceShow(req.params.code);
    logAction(req.session.userId, 'meialua:force-show', { code: req.params.code });
    return out;
  }));

  router.post('/api/matches/:code/show/cancel', wrap((req) => {
    const out = adminBridge.cancelShow(req.params.code);
    logAction(req.session.userId, 'meialua:cancel-show', { code: req.params.code });
    return out;
  }));

  router.post('/api/matches/:code/debug', wrap((req) => {
    const out = adminBridge.toggleDebug(req.params.code, !!req.body?.on);
    logAction(req.session.userId, 'meialua:debug', { code: req.params.code, on: !!req.body?.on });
    return out;
  }));

  router.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  return router;
}

module.exports = { createMeiaLuaAdminRouter };
