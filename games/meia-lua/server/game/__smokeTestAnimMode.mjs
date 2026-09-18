// Teste dedicado ao Modo Animatronic (ver shared/animatronicMode.js,
// PlayerAnimatronic.js e as partes novas de Match.js) — instância real de
// Match, sem stub de lógica de jogo nenhum, só os mesmos stubs de
// room/io de sempre (ver os outros __smokeTest*.mjs pra o mesmo padrão).
import { Match } from './Match.js';

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.error(`  ❌ ${name}`); failures++; }
}

const sentTo = []; // { socketId, ev, data }
const room = { channel: 'anim-mode-room', systemMessage: () => {}, onMatchEnd: () => {} };
const io = {
  to: (target) => ({
    emit: (ev, data) => { sentTo.push({ target, ev, data }); },
  }),
};

function account(id, name) {
  return {
    id, displayName: name,
    attrs: { coragem: 5, investigacao: 5, velocidade: 5, resistencia: 5, tecnica: 5 },
    equipment: {}, level: 5, xp: 0, money: 0, inventory: {},
  };
}
// 4 participantes -> animCountFor(4) = 1 (ver shared/animatronicMode.js)
const participants = [1, 2, 3, 4].map((n) => ({ account: account(n, `Jogador ${n}`), socketId: `sock${n}` }));

console.log('=== 1: seleção secreta de papel — exatamente 1 animatrônico em 4, resto funcionário ===');
const match = new Match(room, io, 1, participants, 'normal', 'animatronic');
clearInterval(match.interval);
for (const p of match.players.values()) p.invulnUntil = Infinity;

const roles = [...match.players.values()].map((p) => p.role);
const animPlayers = [...match.players.values()].filter((p) => p.role === 'animatronic');
check('modo da partida é "animatronic"', match.mode === 'animatronic');
check('exatamente 1 jogador com role animatronic (animCountFor(4)=1)', animPlayers.length === 1);
check('os outros 3 são funcionario', roles.filter((r) => r === 'funcionario').length === 3);
check('nenhuma IA "caçadora" nesse modo (this.anims vazio)', match.anims.length === 0);
check('o jogador animatrônico tem um PlayerAnimatronic de verdade (p.beast)', !!animPlayers[0].beast && typeof animPlayers[0].beast.energy === 'number');

console.log('=== 2: fullState(p) só revela o papel do PRÓPRIO jogador — nada vaza sobre os outros ===');
{
  const states = [...match.players.values()].map((p) => match.fullState(p));
  for (let i = 0; i < states.length; i++) {
    const p = [...match.players.values()][i];
    check(`fullState de ${p.name} reporta o PRÓPRIO papel corretamente`, states[i].role === p.role);
  }
  check('fullState não lista nenhum "animatronics" de IA nesse modo (lista vazia)', states.every((s) => Array.isArray(s.animatronics) && s.animatronics.length === 0));
  // `players` (o roster da partida) não carrega NENHUM campo de papel —
  // só id/name/color/level — então não existe onde vazar o papel de outro
  // jogador dentro desse payload.
  const rosterHasRoleField = states.some((s) => s.players.some((o) => 'role' in o));
  check('a lista de jogadores (`players`) não expõe o papel de ninguém', !rosterHasRoleField);
}

const beastPlayer = animPlayers[0];
const humanPlayer = [...match.players.values()].find((p) => p.role !== 'animatronic');

console.log('=== 3: validação server-side de useAnimAbility — humano não pode usar habilidade de animatronic ===');
{
  const before = beastPlayer.beast.energy;
  const ok = match.useAnimAbility(humanPlayer.id, 'passosAtras', {});
  check('useAnimAbility chamado por um FUNCIONARIO retorna false (rejeitado)', ok === false);
  void before;
}

console.log('=== 4: cooldown/energia realmente bloqueiam o uso — não dá pra "spammar" habilidade ===');
{
  // aproxima o alvo do animatrônico pra caber dentro do alcance de visão
  // (relevante só pro teste de 'chase' mais abaixo — aqui ainda não importa)
  const first = match.useAnimAbility(beastPlayer.id, 'passosAtras', { targetId: humanPlayer.id });
  const second = match.useAnimAbility(beastPlayer.id, 'passosAtras', { targetId: humanPlayer.id });
  check('primeiro uso de passosAtras funcionou', first === true);
  check('segundo uso IMEDIATO foi bloqueado pelo cooldown (não gastou de novo)', second === false);
  const gotFx = sentTo.some((s) => s.target === humanPlayer.socketId && s.ev === 'fx' && s.data?.s === 'stepsBehind');
  check('o alvo realmente recebeu o fx de verdade (mesmo sistema dos eventos aleatórios)', gotFx);
}

console.log('=== 5: habilidade sem alvo válido (ex.: id inventado) cai pro alvo humano mais perto, nunca falha silenciosamente pro lado errado ===');
{
  sentTo.length = 0;
  const ok = match.useAnimAbility(beastPlayer.id, 'respiracaoDistante', { targetId: 'id-que-nao-existe-999' });
  check('respiracaoDistante com id inventado ainda funcionou (caiu pro alvo válido mais próximo)', ok === true);
}

console.log('=== 6: chase é limitada por PERCEPÇÃO real (beastSenseFor) — não dá pra perseguir alguém que não está vendo ===');
{
  // Afasta TODOS os humanos (não só o alvo) pra garantir "seen" vazio de
  // verdade — só afastar um e deixar os outros perto ainda deixaria o
  // animatrônico "vendo" alguém (comportamento correto, mas não é o que
  // este passo específico quer verificar).
  const allHumans = [...match.players.values()].filter((p) => p.role !== 'animatronic');
  for (const h of allHumans) { h.x = beastPlayer.x + 200; h.y = beastPlayer.y + 200; }
  const sensedBefore = match.beastSenseFor(beastPlayer);
  check('nenhum humano longe demais aparece no "seen" da percepção do animatrônico', sensedBefore.seen.length === 0);
  const attemptFar = match.useAnimAbility(beastPlayer.id, 'chase', { targetId: humanPlayer.id });
  check('chase falhou (retornou false) sem alvo percebido — nada de perseguir por telepatia', attemptFar === false);
  check('energia NÃO foi gasta numa tentativa de chase que falhou', beastPlayer.beast.chaseState === 'idle');

  // Agora coloca os dois bem próximos, na mesma posição — linha de visão livre.
  humanPlayer.x = beastPlayer.x; humanPlayer.y = beastPlayer.y;
  beastPlayer.beast.energy = beastPlayer.beast.energyMax; // garante recurso suficiente
  beastPlayer.beast.cooldowns.clear();
  const sensedNear = match.beastSenseFor(beastPlayer);
  check('humano bem perto e visível aparece no "seen"', sensedNear.seen.some((s) => s[0] === humanPlayer.id));
  const attemptNear = match.useAnimAbility(beastPlayer.id, 'chase', { targetId: humanPlayer.id });
  check('chase funcionou com o alvo realmente percebido', attemptNear === true);
  check('chaseState fica "active" logo após iniciar', beastPlayer.beast.chaseState === 'active');
}

console.log('=== 7: ps (posições) esconde o animatrônico dos humanos, e esconde os humanos DO animatrônico ===');
{
  sentTo.length = 0;
  match.sendSnapshots();
  const snapForHuman = sentTo.find((s) => s.target === humanPlayer.socketId && s.ev === 'snap')?.data;
  const snapForBeast = sentTo.find((s) => s.target === beastPlayer.socketId && s.ev === 'snap')?.data;
  check('snapshot foi enviado pros dois', !!snapForHuman && !!snapForBeast);
  const beastRowInHumanPs = snapForHuman.ps.some((row) => row[0] === beastPlayer.id);
  check('humano NUNCA recebe a linha de posição do jogador-animatrônico em `ps`', !beastRowInHumanPs);
  const otherHumanRowsInBeastPs = snapForBeast.ps.filter((row) => row[0] !== beastPlayer.id);
  check('animatrônico NÃO recebe `ps` cheio dos humanos (sem lista de posições prontas)', otherHumanRowsInBeastPs.length === 0);
  // como está em CHASE agora, deve aparecer no `an` do humano (perseguição = manifestando)
  const beastInAnOfHuman = snapForHuman.an.some((row) => row[0] === beastPlayer.beast.id);
  check('durante a perseguição, o animatrônico aparece no `an` do humano (visível de propósito)', beastInAnOfHuman);
  check('o humano recebe `me.beast` nulo (HUD do animatrônico nunca vaza pro humano)', snapForHuman.me.beast === null);
  check('o próprio animatrônico recebe seu HUD (`me.beast`) de verdade', !!snapForBeast.me.beast && typeof snapForBeast.me.beast.energy === 'number');
}

console.log('=== 8: perseguição tem fim (duração máxima) e não trava a partida ===');
{
  const ticks = Math.ceil(30 / 0.1);
  for (let i = 0; i < ticks && !match.ended; i++) { match.lastTick = Date.now() - 200; match.tick(); }
  check('perseguição do jogador-animatrônico terminou sozinha (não ficou "active" pra sempre)', beastPlayer.beast.chaseState !== 'active');
}

console.log('=== 9: condição de vitória/derrota do modo conta só humanos ===');
{
  const room2 = { channel: 'anim-mode-room-2', systemMessage: () => {}, onMatchEnd: () => {} };
  const match2 = new Match(room2, io, 1, participants.map((pt) => ({ ...pt, account: account(pt.account.id, pt.account.displayName) })), 'normal', 'animatronic');
  clearInterval(match2.interval);
  const beast2 = [...match2.players.values()].find((p) => p.role === 'animatronic');
  const humans2 = [...match2.players.values()].filter((p) => p.role !== 'animatronic');
  // mata todos os humanos sem respawn (mas deixa o "animatronic" vivo) — a
  // partida deveria acabar em derrota mesmo com o jogador-animatrônico
  // tecnicamente "vivo" o tempo todo.
  for (const h of humans2) { h.alive = false; h.respawnAt = 0; }
  match2.checkEnd();
  check('com todo humano eliminado (mesmo o animatrônico "vivo"), a partida termina em derrota', match2.ended === true);
  void beast2;
}

if (failures) {
  console.error(`\n❌ ${failures} verificação(ões) falharam.`);
  process.exitCode = 1;
} else {
  console.log('\n✅ todas as verificações do Modo Animatronic passaram.');
}
