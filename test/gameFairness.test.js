// test/gameFairness.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plausibleMaxScore, clampScore, rewardForScore, MAX_SCORE } = require('../server/utils/gameFairness');

test('plausibleMaxScore cresce com o tempo decorrido', () => {
  assert.equal(plausibleMaxScore(3000, 300), 10); // 3s / 300ms por ponto
  assert.equal(plausibleMaxScore(0, 300), 0);
  assert.equal(plausibleMaxScore(299, 300), 0); // não deu tempo de nem 1 ponto
});

test('plausibleMaxScore trata entrada inválida como 0', () => {
  assert.equal(plausibleMaxScore(NaN, 300), 0);
  assert.equal(plausibleMaxScore(1000, 0), 0);
  assert.equal(plausibleMaxScore(-100, 300), 0);
});

test('clampScore não deixa passar do que o tempo de jogo permite (anti-fraude)', () => {
  // Alguém chamando /finish direto com score=500 sem ter jogado (elapsedMs baixo)
  const score = clampScore(500, 600, 300); // só deu tempo pra 2 pontos
  assert.equal(score, 2);
});

test('clampScore aceita o placar pedido quando é plausível', () => {
  const score = clampScore(5, 3000, 300); // dava pra fazer até 10, pediu 5
  assert.equal(score, 5);
});

test('clampScore nunca passa do teto absoluto (MAX_SCORE), mesmo com tempo de sobra', () => {
  const score = clampScore(999999, 999999999, 1); // tempo "infinito", ainda assim...
  assert.equal(score, MAX_SCORE);
});

test('clampScore nunca fica negativo', () => {
  assert.equal(clampScore(-50, 3000, 300), 0);
});

test('rewardForScore multiplica e respeita o teto máximo de recompensa', () => {
  assert.equal(rewardForScore(3, 500), 30);
  assert.equal(rewardForScore(100, 500), 500); // 100*10=1000, mas o teto é 500
});
