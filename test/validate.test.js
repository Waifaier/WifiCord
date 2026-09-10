// test/validate.test.js
// Roda com: npm test (usa o test runner nativo do Node, sem dependência nova).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePositiveInt, isNonEmptyString, normalizeEmail } = require('../server/utils/validate');

test('parsePositiveInt aceita inteiros positivos', () => {
  assert.equal(parsePositiveInt('42'), 42);
  assert.equal(parsePositiveInt(7), 7);
});

test('parsePositiveInt rejeita zero, negativos, texto e decimais', () => {
  assert.equal(parsePositiveInt('0'), null);
  assert.equal(parsePositiveInt('-5'), null);
  assert.equal(parsePositiveInt('abc'), null);
  assert.equal(parsePositiveInt('3.5'), null);
  assert.equal(parsePositiveInt(undefined), null);
  assert.equal(parsePositiveInt(null), null);
});

test('isNonEmptyString aceita string não vazia dentro do limite', () => {
  assert.equal(isNonEmptyString('ola', 10), true);
  assert.equal(isNonEmptyString('ola'), true); // sem maxLen, não limita
});

test('isNonEmptyString rejeita vazio, só espaços, não-string e string longa demais', () => {
  assert.equal(isNonEmptyString(''), false);
  assert.equal(isNonEmptyString('   '), false);
  assert.equal(isNonEmptyString(123), false);
  assert.equal(isNonEmptyString(null), false);
  assert.equal(isNonEmptyString('12345', 3), false);
});

test('normalizeEmail remove espaços e deixa minúsculo', () => {
  assert.equal(normalizeEmail('  User@Example.COM  '), 'user@example.com');
});

test('normalizeEmail trata entrada vazia/ausente como string vazia', () => {
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(''), '');
});
