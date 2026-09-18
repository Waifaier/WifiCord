// Smoke test HONESTO (não é playtest, não é teste de client/render/áudio).
//
// Instancia um Match real (não um mock) com room/io falsificados (stubs que
// só gravam o que foi emitido, sem socket de verdade), roda a noite 5
// inteira (a que tem TODOS os animatrônicos + Maestro + evento do Show) tick
// a tick, chamando os métodos reais do Match/Animatronic/TensionDirector/
// EventChains — o objetivo único é pegar exceções não tratadas nos caminhos
// de código NOVOS deste ciclo (OBSERVE, falsoAlarme em 3 passos,
// ecoEntreJogadores, runShowEvent com as fases novas, o viés por área do
// TensionDirector, o glitch de câmera) que `node --check` (só sintaxe) não
// pega.
//
// O que isso NÃO prova: nada sobre como fica na tela, no áudio real do
// navegador, ou sob rede/latência de verdade — client/js/audio.js e
// client/js/game.js não são exercitados aqui.
//
// Jogadores ficam invulneráveis de propósito (ver `p.invulnUntil = Infinity`
// abaixo) — isso NÃO é validação de balanceamento, é só pra garantir que a
// noite inteira rode do começo ao fim sem os jogadores morrerem cedo e
// encerrando a partida antes da hora do Show (~3h de jogo) ter chance de
// disparar.
import { Match } from './Match.js';

const emittedEvents = new Map(); // 'ev:type' -> contagem
const systemMsgs = [];
let matchEndPayload = null;

const room = {
  channel: 'smoke-test-room',
  systemMessage: (text) => systemMsgs.push(text),
  onMatchEnd: (payload) => { matchEndPayload = payload; },
};
const io = {
  to: () => ({
    emit: (ev, data) => {
      const key = ev + (data && data.type ? ':' + data.type : '') + (data && data.phase ? ':' + data.phase : '');
      emittedEvents.set(key, (emittedEvents.get(key) || 0) + 1);
    },
  }),
};

function account(id, name) {
  return {
    id, displayName: name,
    attrs: { coragem: 5, investigacao: 5, velocidade: 5, resistencia: 5, tecnica: 5 },
    equipment: {},
    level: 5, xp: 0, money: 0,
    inventory: {},
  };
}

const participants = [
  { account: account('p1', 'Jogador 1'), socketId: 'sock1' },
  { account: account('p2', 'Jogador 2'), socketId: 'sock2' },
];

console.log('Instanciando Match real (noite 5, dificuldade difícil, 2 jogadores stub)...');
const match = new Match(room, io, 5, participants, 'dificil');
clearInterval(match.interval); // vamos avançar os ticks manualmente, não em tempo real

for (const p of match.players.values()) p.invulnUntil = Infinity; // ver comentário no topo do arquivo

let ticks = 0;
let crashed = null;
const startReal = Date.now();
const maxTicks = Math.ceil((match.duration + 20) / 0.1) + 50;

try {
  while (!match.ended && ticks < maxTicks) {
    // força dt no teto de 0.1s por tick (ver Match.tick: dt = min(0.1, ...))
    // independente da velocidade real do loop, pra simular a noite inteira
    // em segundos reais em vez de esperar 360s de verdade.
    match.lastTick = Date.now() - 200;
    match.tick();
    ticks++;
  }
} catch (err) {
  crashed = err;
}

const realSecs = (Date.now() - startReal) / 1000;

console.log(`\nticks executados: ${ticks}`);
console.log(`tempo simulado de jogo: ${match.time.toFixed(1)}s / ${match.duration}s`);
console.log(`tempo real gasto rodando o loop: ${realSecs.toFixed(2)}s`);
console.log(`match.ended: ${match.ended}  (payload de fim: ${matchEndPayload ? matchEndPayload.result + '/' + matchEndPayload.reason : 'nenhum'})`);
console.log(`mensagens de sistema emitidas: ${systemMsgs.length}`);
console.log(`\nEventos/fx distintos observados (chave:contagem):`);
for (const [k, n] of [...emittedEvents.entries()].sort()) console.log(`  ${k}: ${n}`);

console.log(`\nchains.count ao final: ${match.chains.count} (passos agendados ainda pendentes, deveria ser baixo/zero se nada travou)`);

if (crashed) {
  console.error('\n❌ CRASH durante a simulação:');
  console.error(crashed.stack);
  process.exit(1);
} else {
  console.log('\n✅ noite inteira simulada (ticks reais do Match, sem stub de lógica) sem exceção não tratada.');
  process.exit(0);
}
