// server/utils/gameFairness.js
// Regra anti-fraude do minigame, extraída de routes/games.js pra virar uma
// função pura e testável (ver test/gameFairness.test.js): o placar que o
// cliente manda pro /finish nunca é aceito de olhos fechados, ele é limitado
// ao que é fisicamente possível alcançar no tempo real de jogo daquela
// sessão (marcada no servidor em /start), pra impedir chamar a API direto
// com um placar alto sem ter jogado de verdade.
'use strict';

const MAX_SCORE = 500;

// minMsPerPoint: quanto tempo mínimo uma partida real leva pra fazer 1 ponto.
function plausibleMaxScore(elapsedMs, minMsPerPoint) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (!Number.isFinite(minMsPerPoint) || minMsPerPoint <= 0) return 0;
  return Math.floor(elapsedMs / minMsPerPoint);
}

// Combina o que o cliente pediu com o que é plausível: nunca deixa passar
// de MAX_SCORE, nunca deixa negativo, e nunca deixa passar do que o tempo
// decorrido permite.
function clampScore(requestedScore, elapsedMs, minMsPerPoint) {
  const requested = Math.max(0, Math.min(MAX_SCORE, Math.floor(Number(requestedScore) || 0)));
  const plausibleMax = plausibleMaxScore(elapsedMs, minMsPerPoint);
  return Math.min(requested, plausibleMax);
}

function rewardForScore(score, maxReward, pointsPerScore = 10) {
  const s = Math.max(0, Math.floor(Number(score) || 0));
  return Math.min(maxReward, s * pointsPerScore);
}

module.exports = { MAX_SCORE, plausibleMaxScore, clampScore, rewardForScore };
