// Ponte de login único entre a sessão do WifiCord e o Meia-Lua: Turno da
// Noite (jogo embutido em games/meia-lua/ — ver server/integration.js
// daquele jogo e o comentário grande em server/server.js sobre o boot
// assíncrono). Só existe esta rota aqui: /api/meia-lua/session.
//
// Fica em CommonJS como o resto do WifiCord — o módulo `accounts` do jogo
// (ESM) é recebido pronto por injeção (createMeiaLuaBridgeRouter é chamada
// depois que server.js já fez `await mountMeiaLua(...)`), então este
// arquivo nunca precisa dar import() nele sozinho.
'use strict';
const express = require('express');
const User = require('../models/User');
const { requireAuth } = require('./auth');
const { makeRateLimiter } = require('../utils/rateLimiter');

function createMeiaLuaBridgeRouter({ accounts }) {
  const router = express.Router();

  // Por usuário logado (não por IP — requireAuth já garante que tem
  // sessão válida antes de chegar aqui), 20 chamadas por minuto é mais que
  // suficiente pro boot do jogo (uma chamada por vez que a aba "Jogos" é
  // aberta) e ainda impede abuso se algo no cliente ficar num loop.
  const sessionLimiter = makeRateLimiter(60000, 20, {
    keyFn: (req) => 'meia-lua-session:' + req.session.userId,
  });

  router.get('/session', requireAuth, sessionLimiter, async (req, res) => {
    try {
      const user = User.findById(req.session.userId);
      if (!user) return res.status(401).json({ error: 'Não autenticado.' });
      const { token } = await accounts.loginOrCreateLinkedAccount(user.id, user.display_name);
      res.set('Cache-Control', 'no-store');
      res.json({ token });
    } catch (err) {
      console.error('[meia-lua] falha ao gerar sessão vinculada:', err);
      res.status(500).json({ error: 'Não foi possível conectar ao Meia-Lua agora.' });
    }
  });

  return router;
}

module.exports = { createMeiaLuaBridgeRouter };
