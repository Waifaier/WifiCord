// server/utils/adminAuth.js
// Comparação de tempo constante do código de ativação do primeiro
// administrador, extraída de routes/auth.js pra virar uma função isolada e
// testável (ver test/adminAuth.test.js). Usa crypto.timingSafeEqual pra não
// vazar por diferença de tempo de resposta o tamanho/conteúdo do código
// configurado em ADMIN_CLAIM_CODE.
'use strict';

const crypto = require('crypto');

function codeMatches(provided, expected) {
  const expectedStr = String(expected || '');
  if (!expectedStr) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expectedStr);
  if (a.length !== b.length) {
    // Compara mesmo assim (um buffer contra ele mesmo) pra manter o tempo
    // de execução parecido com o caminho em que os tamanhos batem.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

module.exports = { codeMatches };
