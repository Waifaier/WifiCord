// test/rateLimiter.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeRateLimiter } = require('../server/utils/rateLimiter');

// Fake mínimo de req/res do Express, só com o que o middleware usa.
function fakeReq(ip) {
  return { ip };
}
function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return res;
}

test('libera as primeiras N tentativas dentro da janela', () => {
  let now = 1000;
  const limit = makeRateLimiter(60000, 3, { clock: () => now });
  const req = fakeReq('1.2.3.4');

  for (let i = 0; i < 3; i++) {
    let called = false;
    limit(req, fakeRes(), () => { called = true; });
    assert.equal(called, true, `tentativa ${i + 1} deveria passar`);
  }
});

test('bloqueia com 429 depois do limite, na mesma janela', () => {
  let now = 1000;
  const limit = makeRateLimiter(60000, 2, { clock: () => now });
  const req = fakeReq('9.9.9.9');

  limit(req, fakeRes(), () => {}); // 1
  limit(req, fakeRes(), () => {}); // 2
  const res = fakeRes();
  let called = false;
  limit(req, res, () => { called = true; }); // 3: deve bloquear

  assert.equal(called, false);
  assert.equal(res.statusCode, 429);
  assert.ok(res.headers['Retry-After']);
});

test('libera de novo depois que a janela passa', () => {
  let now = 1000;
  const limit = makeRateLimiter(1000, 1, { clock: () => now });
  const req = fakeReq('5.5.5.5');

  let firstCalled = false;
  limit(req, fakeRes(), () => { firstCalled = true; });
  assert.equal(firstCalled, true);

  const blockedRes = fakeRes();
  let secondCalled = false;
  limit(req, blockedRes, () => { secondCalled = true; });
  assert.equal(secondCalled, false);
  assert.equal(blockedRes.statusCode, 429);

  now += 1001; // passa da janela
  let thirdCalled = false;
  limit(req, fakeRes(), () => { thirdCalled = true; });
  assert.equal(thirdCalled, true);
});

test('cada chave (IP) tem contagem independente', () => {
  let now = 1000;
  const limit = makeRateLimiter(60000, 1, { clock: () => now });

  let aCalled = false, bCalled = false;
  limit(fakeReq('1.1.1.1'), fakeRes(), () => { aCalled = true; });
  limit(fakeReq('2.2.2.2'), fakeRes(), () => { bCalled = true; });

  assert.equal(aCalled, true);
  assert.equal(bCalled, true);
});
