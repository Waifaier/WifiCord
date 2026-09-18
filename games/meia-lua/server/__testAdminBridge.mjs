// Teste do adminBridge.js — SEM RoomManager real nenhum (não precisa: o
// bridge só olha pra `rooms.rooms`, um Map de `{ match }`), mas com uma
// Match REAL de verdade por trás, igual todo os outros testes headless
// deste projeto. Cobre exatamente o que o pedido marcou como mais crítico
// pro painel: reaproveitar o sistema de eventos de verdade (não uma versão
// fake) e nunca deixar uma partida/jogador/evento inválido passar batido.
import { Match } from './game/Match.js';
import { createAdminBridge, AdminBridgeError } from './adminBridge.js';

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.error(`  ❌ ${name}`); failures++; }
}

const sentTo = [];
const room = { channel: 'admin-bridge-room', systemMessage: () => {}, onMatchEnd: () => {} };
const io = { to: (target) => ({ emit: (ev, data) => sentTo.push({ target, ev, data }) }) };
function account(id, name) {
  return { id, displayName: name, attrs: { coragem: 5, investigacao: 5, velocidade: 5, resistencia: 5, tecnica: 5 }, equipment: {}, level: 5, xp: 0, money: 0, inventory: {} };
}
const participants = [1, 2, 3].map((n) => ({ account: account(n, `Jogador ${n}`), socketId: `sock${n}` }));

const match = new Match(room, io, 1, participants, 'normal');
clearInterval(match.interval);
for (const p of match.players.values()) p.invulnUntil = Infinity;
for (let i = 0; i < 100; i++) { match.lastTick = Date.now() - 200; match.tick(); } // passa da GRACE_SECONDS

const rooms = { rooms: new Map([['NOITE-0001', { code: 'NOITE-0001', match }]]) };
const bridge = createAdminBridge(rooms);

console.log('=== 1: listMatches / getMatchDetail refletem o estado REAL da Match ===');
{
  const list = bridge.listMatches();
  check('lista tem exatamente 1 partida ativa', list.length === 1);
  check('resumo tem os jogadores certos', list[0].playerCount === 3);
  const detail = bridge.getMatchDetail('noite-0001'); // minúsculo/maiúsculo não deveria importar
  check('getMatchDetail aceita o código em minúsculo (normaliza)', !!detail && detail.code);
  check('detail expõe o papel de cada jogador PRO ADMIN (nunca vaza pro snapshot normal, ver __smokeTestAnimMode)', detail.players.every((p) => 'role' in p));
}

console.log('=== 2: partida inexistente -> erro 404, nunca undefined silencioso ===');
{
  let threw = null;
  try { bridge.getMatchDetail('NOITE-9999'); } catch (err) { threw = err; }
  check('erro foi lançado', threw instanceof AdminBridgeError);
  check('status 404 pra partida inexistente', threw?.status === 404);
}

console.log('=== 3: triggerEvent chama o MESMO fx* real do Match (não uma versão fake) ===');
{
  sentTo.length = 0;
  const target = [...match.players.values()][0];
  const out = bridge.triggerEvent('NOITE-0001', { type: 'passosAtras', targetId: target.id });
  check('triggerEvent retornou ok', out.ok === true);
  const gotFx = sentTo.some((s) => s.target === target.socketId && s.ev === 'fx' && s.data?.s === 'stepsBehind');
  check('o alvo recebeu o MESMO fx que o jogo de verdade manda (Match.fxPassosAtras)', gotFx);
}

console.log('=== 4: tipo de evento desconhecido é rejeitado (nunca invoca função arbitrária) ===');
{
  let threw = null;
  try { bridge.triggerEvent('NOITE-0001', { type: 'apagarBancoDeDados' }); } catch (err) { threw = err; }
  check('evento desconhecido lança erro em vez de silenciosamente não fazer nada (ou pior, executar algo)', threw instanceof AdminBridgeError);
}

console.log('=== 5: broadcast=true dispara em TODOS os jogadores vivos ===');
{
  sentTo.length = 0;
  const out = bridge.triggerEvent('NOITE-0001', { type: 'respiracaoDistante', broadcast: true });
  const aliveCount = [...match.alivePlayers()].length;
  check('count retornado bate com o número de jogadores vivos', out.count === aliveCount);
  const distinctTargets = new Set(sentTo.filter((s) => s.data?.s === 'breathDistant').map((s) => s.target));
  check('cada jogador vivo recebeu o próprio fx (sendTo individual, não um broadcast genérico)', distinctTargets.size === aliveCount);
}

console.log('=== 6: setTension altera o MESMO TensionDirector que rege o jogo, com clamp 0..100 ===');
{
  const before = match.director.tension;
  const r1 = bridge.setTension('NOITE-0001', { delta: 25 });
  check('tensão subiu de verdade no director real', match.director.tension === Math.min(100, before + 25));
  check('bridge retornou o valor atualizado', r1.tension === Math.round(match.director.tension));
  bridge.setTension('NOITE-0001', { value: 500 });
  check('setTension com value satura em 100 (nunca passa do teto)', match.director.tension === 100);
  bridge.setTension('NOITE-0001', { value: -50 });
  check('setTension com value satura em 0 (nunca fica negativo)', match.director.tension === 0);
}

console.log('=== 7: forceShow dispara a sequência REAL (runShowEvent) — não é só tocar música ===');
{
  check('showActive começa false', match.showActive === false);
  const out = bridge.forceShow('NOITE-0001');
  check('forceShow retornou ok', out.ok === true);
  check('match.showActive ficou true de verdade (é a sequência real, não um efeito cosmético isolado)', match.showActive === true);
  let threw = null;
  try { bridge.forceShow('NOITE-0001'); } catch (err) { threw = err; }
  check('forçar de novo enquanto já está ativo é rejeitado (409), não duplica o show', threw instanceof AdminBridgeError && threw.status === 409);
  const out2 = bridge.cancelShow('NOITE-0001');
  check('cancelShow encerra pelo caminho normal (endShowEvent)', out2.ok === true && match.showActive === false);
}

console.log('=== 8: toggleDebug liga uma flag só no servidor — nunca aparece pro jogador comum ===');
{
  const r1 = bridge.toggleDebug('NOITE-0001', true);
  check('debug ligou', r1.debug === true && match.adminDebug === true);
  sentTo.length = 0;
  match.sendSnapshots();
  const anySnapshotMentionsDebug = sentTo.some((s) => s.ev === 'snap' && JSON.stringify(s.data).toLowerCase().includes('debug'));
  check('a flag adminDebug NÃO vaza pro payload de snapshot de nenhum jogador', !anySnapshotMentionsDebug);
}

if (failures) {
  console.error(`\n❌ ${failures} verificação(ões) falharam.`);
  process.exitCode = 1;
} else {
  console.log('\n✅ todas as verificações do adminBridge passaram.');
}
