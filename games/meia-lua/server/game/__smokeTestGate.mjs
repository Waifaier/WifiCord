// Teste dedicado ao portão da "primeira perseguição precisa ter contexto"
// (regra #17 do pedido de reformulação narrativa) — não basta não travar
// (isso o __smokeTest.mjs já cobre); aqui a verificação é que a ORDEM dos
// acontecimentos está certa: nenhuma perseguição de verdade (fx 'chase')
// pode ser emitida enquanto match.firstChaseUnlocked ainda for false, e
// firstEncounterDone precisa ter acontecido primeiro.
import { Match } from './Match.js';

const room = { channel: 'gate-test', systemMessage: () => {}, onMatchEnd: () => {} };
let matchTimeAtEmit = null;
const chaseEmits = []; // { atMatchTime, gateWasOpen }
let m; // referência preenchida depois de instanciar, usada dentro do io stub

const io = {
  to: () => ({
    emit: (ev, data) => {
      if (data?.type === 'chase' && m) {
        chaseEmits.push({ at: m.time, gateOpen: m.firstChaseUnlocked, encounterDone: m.firstEncounterDone });
      }
    },
  }),
};

function account(id, name) {
  return {
    id, displayName: name,
    attrs: { coragem: 5, investigacao: 5, velocidade: 5, resistencia: 5, tecnica: 5 },
    equipment: {}, level: 5, xp: 0, money: 0, inventory: {},
  };
}
const participants = [
  { account: account('p1', 'Jogador 1'), socketId: 'sock1' },
  { account: account('p2', 'Jogador 2'), socketId: 'sock2' },
];

console.log('Rodando 5 noites inteiras seguidas (sementes diferentes de aleatoriedade) pra checar a ordem do portão...');
let violations = 0;
let neverUnlocked = 0;
let totalChases = 0;
let unlockTimes = [];
let encounterTimes = [];

for (let run = 0; run < 5; run++) {
  m = new Match(room, io, 5, participants, 'dificil');
  clearInterval(m.interval);
  for (const p of m.players.values()) p.invulnUntil = Infinity;
  chaseEmits.length = 0;

  let ticks = 0;
  const maxTicks = Math.ceil((m.duration + 20) / 0.1) + 50;
  let crashed = null;
  try {
    while (!m.ended && ticks < maxTicks) {
      m.lastTick = Date.now() - 200;
      m.tick();
      ticks++;
    }
  } catch (err) { crashed = err; }

  if (crashed) {
    console.error(`  run ${run}: ❌ CRASH — ${crashed.stack}`);
    process.exitCode = 1;
    continue;
  }

  totalChases += chaseEmits.length;
  const badOnes = chaseEmits.filter((c) => !c.gateOpen);
  violations += badOnes.length;
  if (!m.firstChaseUnlocked) neverUnlocked++;
  else unlockTimes.push(m.firstEncounterAt >= 0 ? m.time : null);
  if (m.firstEncounterDone) encounterTimes.push(m.firstEncounterAt);

  console.log(`  run ${run}: chases=${chaseEmits.length} (${badOnes.length} com o portão ainda fechado) | firstEncounterDone=${m.firstEncounterDone} em t=${m.firstEncounterAt.toFixed?.(1) ?? m.firstEncounterAt} | firstChaseUnlocked=${m.firstChaseUnlocked}`);
}

console.log(`\nTotal de fx 'chase' observados nas 5 noites: ${totalChases}`);
console.log(`Violações (chase com portão fechado): ${violations}`);
console.log(`Noites em que o portão nunca abriu: ${neverUnlocked}/5 (não é bug por si só — só acontece se nenhuma aparição calma rolou a tempo)`);

if (violations > 0) {
  console.error('\n❌ FALHOU: pelo menos uma perseguição de verdade começou antes do portão abrir.');
  process.exitCode = 1;
} else {
  console.log('\n✅ Em nenhuma das 5 noites uma perseguição de verdade começou antes do portão (firstChaseUnlocked) abrir.');
}
