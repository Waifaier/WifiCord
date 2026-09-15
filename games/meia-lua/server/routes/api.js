// Rotas REST: autenticação, perfil, inventário e loja.
import express from 'express';
import { config } from '../config.js';
import * as acc from '../database/accounts.js';
import { SHOP_ITEMS } from '../../shared/items.js';

export function apiRouter(rooms) {
  const r = express.Router();
  r.use(express.json({ limit: '8kb' }));

  // limitador simples por IP para rotas de autenticação
  const hits = new Map();
  const rateLimit = (max, windowMs) => (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const h = hits.get(key) || { n: 0, reset: now + windowMs };
    if (now > h.reset) { h.n = 0; h.reset = now + windowMs; }
    h.n++;
    hits.set(key, h);
    if (h.n > max) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco.' });
    next();
  };
  setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now > h.reset) hits.delete(k); }, 60000).unref();

  const wrap = (fn) => (req, res) => {
    try {
      const out = fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      const status = err instanceof acc.GameError ? err.status : 500;
      if (status === 500) console.error(err);
      res.status(status).json({ error: status === 500 ? 'Erro interno.' : err.message });
    }
  };

  const auth = (req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const id = acc.accountIdFromToken(token);
    if (!id) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    req.accountId = id;
    req.token = token;
    next();
  };
  const notInMatch = (req, res, next) => {
    if (rooms.isInActiveMatch(req.accountId)) return res.status(409).json({ error: 'Indisponível durante uma partida.' });
    next();
  };

  r.get('/config', (req, res) => res.json({
    maxPlayersPerRoom: config.maxPlayersPerRoom,
    nightSeconds: config.nightSeconds,
    iceServers: config.iceServers,
    shop: SHOP_ITEMS,
  }));

  // /auth/guest, /auth/register e /auth/login ficam DESATIVADAS nesta cópia:
  // o Meia-Lua só roda embutido no WifiCord, e a única porta de entrada
  // válida é a ponte de sessão em /api/meia-lua/session (server/routes/
  // meiaLua.js no WifiCord, que chama acc.loginOrCreateLinkedAccount).
  // Deixar essas rotas ativas permitiria criar contas soltas do Meia-Lua
  // sem passar pelo login do WifiCord — inclusive pra alguém banido.
  const disabledAuthRoute = (req, res) => res.status(404).json({ error: 'Rota não encontrada.' });
  r.post('/auth/guest', disabledAuthRoute);
  r.post('/auth/register', disabledAuthRoute);
  r.post('/auth/login', disabledAuthRoute);
  r.post('/auth/logout', auth, wrap((req) => { acc.logout(req.token); }));
  r.post('/auth/claim', auth, rateLimit(10, 60000), wrap((req) => { acc.claimGuest(req.accountId, req.body?.username, req.body?.password); return { profile: acc.getAccount(req.accountId) }; }));

  r.get('/profile', auth, wrap((req) => ({ profile: acc.getAccount(req.accountId), inMatch: rooms.isInActiveMatch(req.accountId) })));
  r.post('/profile/name', auth, notInMatch, wrap((req) => { acc.setDisplayName(req.accountId, req.body?.name); return { profile: acc.getAccount(req.accountId) }; }));
  r.post('/profile/attribute', auth, notInMatch, wrap((req) => { acc.spendAttributePoint(req.accountId, String(req.body?.attr)); return { profile: acc.getAccount(req.accountId) }; }));
  r.post('/inventory/equip', auth, notInMatch, wrap((req) => { acc.equipItem(req.accountId, String(req.body?.item)); return { profile: acc.getAccount(req.accountId) }; }));
  r.post('/inventory/unequip', auth, notInMatch, wrap((req) => { acc.unequipSlot(req.accountId, String(req.body?.slot)); return { profile: acc.getAccount(req.accountId) }; }));
  r.post('/shop/buy', auth, notInMatch, wrap((req) => { acc.buyItem(req.accountId, String(req.body?.item), req.body?.qty ?? 1); return { profile: acc.getAccount(req.accountId) }; }));
  r.get('/leaderboard', wrap(() => ({ top: acc.leaderboard() })));

  r.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  return r;
}
