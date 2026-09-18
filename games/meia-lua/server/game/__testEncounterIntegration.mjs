// Teste de integração do EncounterResolver DENTRO de uma Match de verdade
// (não só a função pura, que __testEncounterResolver.mjs já cobre) — aqui a
// pergunta é: quando a IA de verdade "vê" um jogador de verdade, ao longo de
// uma noite inteira simulada, os desfechos realmente variam? O portão
// firstChaseUnlocked continua sendo respeitado? Instrumenta
// Match.resolveEncounter (wrap, não mexe no arquivo de verdade) pra
// registrar todo desfecho que rolou de verdade em jogo, não só o sorteio
// isolado.
import { Match } from './Match.js';

const room = { channel: 'encounter-test', systemMessage: () => {}, onMatchEnd: () => {} };
let m;
const chaseEmits = [];
const io = {
  to: () => ({
    emit: (ev, data) => {
      if (data?.type === 'chase' && m) chaseEmits.push({ gateOpen: m.firstChaseUnlocked });
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
  { account: account('p3', 'Jogador 3'), socketId: 'sock3' },
];

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

const globalOutcomeCounts = {};
let totalResolved = 0;

for (let run = 0; run < 3; run++) {
  m = new Match(room, io, 5, participants, 'dificil');
  clearInterval(m.interval);
  for (const p of m.players.values()) p.invulnUntil = Infinity;
  chaseEmits.length = 0;

  // Instrumentação: embrulha resolveEncounter SÓ pra registrar o retorno
  // (o método real não muda em nada, o wrap só observa).
  const realResolve = m.resolveEncounter.bind(m);
  const outcomesThisRun = [];
  m.resolveEncounter = (anim, target, trigger) => {
    const outcome = realResolve(anim, target, trigger);
    outcomesThisRun.push(outcome);
    globalOutcomeCounts[outcome] = (globalOutcomeCounts[outcome] || 0) + 1;
    totalResolved++;
    return outcome;
  };

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

  check(`run ${run}: noite inteira sem exceção`, !crashed);
  if (crashed) { console.error(crashed.stack); continue; }

  const badGate = chaseEmits.filter((c) => !c.gateOpen);
  check(`run ${run}: nenhuma perseguição de verdade com o portão fechado (${chaseEmits.length} chases, ${badGate.length} violações)`, badGate.length === 0);
  console.log(`  run ${run}: resolveEncounter foi chamado ${outcomesThisRun.length}x — desfechos: ${JSON.stringify(
    outcomesThisRun.reduce((acc, o) => { acc[o] = (acc[o] || 0) + 1; return acc; }, {})
  )}`);
}

console.log(`\nTotal de encontros resolvidos nas 3 noites: ${totalResolved}`);
console.log('Distribuição agregada:', globalOutcomeCounts);

check('resolveEncounter foi chamado pelo menos algumas vezes nas 3 noites (a IA de verdade "viu" jogadores)', totalResolved > 5);

// A REGRA FUNDAMENTAL testada dentro de uma Match de verdade, não só na
// função pura: 'chase' não pode ser a esmagadora maioria dos desfechos.
const chaseCount = globalOutcomeCounts.chase || 0;
check(`'chase' não domina os encontros de verdade em jogo (${chaseCount}/${totalResolved} = ${totalResolved ? (100 * chaseCount / totalResolved).toFixed(1) : 0}%)`,
  totalResolved === 0 || chaseCount / totalResolved < 0.45);

// Pelo menos alguma variedade real aconteceu (não travou sempre no mesmo
// desfecho, seja qual for).
const distinctOutcomes = Object.keys(globalOutcomeCounts).length;
check(`pelo menos 3 tipos de desfecho diferentes realmente ocorreram em jogo (${distinctOutcomes})`, distinctOutcomes >= 3);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
