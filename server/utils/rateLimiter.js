// server/utils/rateLimiter.js
// Rate limiter simples em memória, por janela fixa. Extraído de
// routes/auth.js (onde era uma função interna não testável) pra virar uma
// peça isolada e coberta por testes automatizados — ver test/rateLimiter.test.js.
'use strict';

// keyFn extrai a chave de limite do request (por padrão, o IP). Recebe
// clock opcional (função que devolve "agora" em ms) só pra permitir testar
// a passagem do tempo sem precisar de setTimeout de verdade.
function makeRateLimiter(windowMs, max, opts = {}) {
  const keyFn = opts.keyFn || ((req) => req.ip || (req.connection && req.connection.remoteAddress) || 'unknown');
  const clock = opts.clock || (() => Date.now());
  const hits = new Map();

  function middleware(req, res, next) {
    const key = keyFn(req);
    const now = clock();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }
    next();
  }

  // Exposto só pra teste/inspeção: quantas tentativas uma chave já usou na
  // janela atual, sem afetar a contagem (não chama a função middleware).
  middleware._hitsFor = function (key) {
    return hits.get(key) || null;
  };
  middleware._reset = function () {
    hits.clear();
  };

  return middleware;
}

module.exports = { makeRateLimiter };
