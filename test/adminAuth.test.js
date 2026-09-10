// test/adminAuth.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { codeMatches } = require('../server/utils/adminAuth');

test('codeMatches aceita quando o código bate exatamente', () => {
  assert.equal(codeMatches('segredo123', 'segredo123'), true);
});

test('codeMatches rejeita código errado', () => {
  assert.equal(codeMatches('errado', 'segredo123'), false);
});

test('codeMatches rejeita quando nada foi configurado no servidor', () => {
  assert.equal(codeMatches('qualquer-coisa', ''), false);
  assert.equal(codeMatches('qualquer-coisa', undefined), false);
});

test('codeMatches rejeita quando nada foi enviado pelo cliente', () => {
  assert.equal(codeMatches('', 'segredo123'), false);
  assert.equal(codeMatches(undefined, 'segredo123'), false);
});

test('codeMatches é sensível a maiúsculas/minúsculas e não trunca', () => {
  assert.equal(codeMatches('Segredo123', 'segredo123'), false);
  assert.equal(codeMatches('segredo12', 'segredo123'), false);
  assert.equal(codeMatches('segredo1234', 'segredo123'), false);
});
