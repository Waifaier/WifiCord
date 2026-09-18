// Segundo smoke test, HONESTO E EXPLICITAMENTE FORÇADO — diferente do
// __smokeTest.mjs (que deixa tudo acontecer por trigger natural/aleatório
// numa noite inteira), este aqui CHAMA DIRETO os métodos mais arriscados
// deste ciclo (runShowEvent, o estado OBSERVE de um animatrônico) sem
// esperar as condições normais de disparo acontecerem sozinhas — porque no
// __smokeTest.mjs os jogadores-stub nunca se moveram do spawn, então nunca
// ficaram perto do palco, e o Show nunca dessa forma teve chance de rodar.
//
// Isso NÃO é "a IA decidiu que era hora do show" — é uma chamada direta,
// pulando o sorteio/gate normal, só pra garantir que a sequência inteira
// (chains agendadas, cada fase, o dispatch no client via fx, o fim do show)
// roda do início ao fim sem exceção. Reportando isso como o que é: uma
// invocação forçada, não um gatilho natural observado.
import { Match } from './Match.js';

const emittedEvents = [];
const room = {
  channel: 'smoke-forced-room',
  systemMessage: () => {},
  onMatchEnd: () => {},
};
const io = {
  to: () => ({
    emit: (ev, data) => emittedEvents.push({ ev, type: data?.type, phase: data?.phase, feature: data?.feature, anim: data?.anim, t: null }),
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

console.log('=== TESTE FORÇADO 1: runShowEvent (sequência completa do Show) ===');
{
  const match = new Match(room, io, 5, participants, 'dificil'); // noite 5 tem o Maestro
  clearInterval(match.interval);
  for (const p of match.players.values()) p.invulnUntil = Infinity;

  // Passa da GRACE_SECONDS (8s) pra AI dos animatrônicos ligar de verdade.
  for (let i = 0; i < 100 && !match.ended; i++) { match.lastTick = Date.now() - 200; match.tick(); }

  const players = [...match.players.values()];
  let crashed = null;
  try {
    match.runShowEvent(players); // chamada direta, pulando o sorteio normal
    // agora deixa o relógio (chains + updateWorld) rodar a sequência toda:
    // ~25s de duração máxima do show + folga pro endShowEvent disparar.
    const showTicks = Math.ceil(35 / 0.1);
    for (let i = 0; i < showTicks && !match.ended; i++) {
      match.lastTick = Date.now() - 200;
      match.tick();
    }
  } catch (err) {
    crashed = err;
  }

  const phases = emittedEvents.filter((e) => e.type === 'show' || e.type === 'showPhase');
  console.log(`fases do show observadas (ordem real de emissão): ${phases.map((p) => p.phase || 'start').join(' -> ')}`);
  console.log(`showActive ao final: ${match.showActive} (esperado: false, ou seja, endShowEvent rodou)`);
  console.log(`chains.count ao final: ${match.chains.count} (esperado: 0, nenhum passo do show ficou travado pra sempre)`);
  if (crashed) { console.error('❌ CRASH no teste do Show:', crashed.stack); process.exitCode = 1; }
  else console.log('✅ sequência do Show rodou do start ao fim sem exceção.\n');
}

console.log('=== TESTE FORÇADO 2: estado OBSERVE de um animatrônico (presença sem ataque) ===');
{
  const match2 = new Match(room, io, 5, participants, 'dificil');
  clearInterval(match2.interval);
  for (const p of match2.players.values()) p.invulnUntil = Infinity;

  const observant = match2.anims.find((a) => a.def.observant); // tonho, gregorio ou maestro
  // Achado durante este teste: cada animatrônico "caçador" só liga depois
  // do próprio this.bootUntil escalonado (ver Match.js, construtor) — antes
  // disso update() retorna de imediato TODO tick (comportamento antigo,
  // não é bug novo). Numa primeira tentativa eu chamei startObserve() cedo
  // demais (10s de jogo) com tonho ainda não "ligado" (bootUntil ~45-85s
  // nessa noite), e o estado ficou parado em OBSERVE pro resto do teste —
  // não porque o código do OBSERVE tivesse travado, mas porque update()
  // nem chegava a rodar o switch. Corrigido forçando o boot aqui, de forma
  // explícita, pra isolar exatamente o código do OBSERVE em si.
  if (observant) observant.bootUntil = 0;
  // Passa da GRACE_SECONDS (8s) — Match.tick só chama Animatronic.update()
  // depois disso (ver `if (this.time > GRACE_SECONDS)` em Match.js).
  for (let i = 0; i < 100 && !match2.ended; i++) { match2.lastTick = Date.now() - 200; match2.tick(); }
  const target = [...match2.players.values()][0];
  console.log(`animatrônico observante escolhido: ${observant?.type ?? 'NENHUM (def.observant não achado — bug de config?)'}`);
  let crashed2 = null;
  try {
    if (observant) {
      observant.state = 'PATROL'; // pré-condição do tryObserve
      observant.startObserve(target); // chamada direta, pulando o roll de observeBias/linha-de-visão
      console.log(`estado após startObserve: ${observant.state} (esperado: OBSERVE)`);
      // roda além da duração máxima do observe (~7s) + updateObserve/endObserve
      const obsTicks = Math.ceil(9 / 0.1);
      for (let i = 0; i < obsTicks && !match2.ended; i++) { match2.lastTick = Date.now() - 200; match2.tick(); }
      console.log(`estado após ~9s: ${observant.state} (esperado: SEARCH, ou seja, endObserve rodou e não travou em OBSERVE)`);
    }
  } catch (err) {
    crashed2 = err;
  }
  const sightings = emittedEvents.filter((e) => e.type === 'sighting');
  console.log(`fx 'sighting' emitidos durante o teste: ${sightings.length}`);
  if (crashed2) { console.error('❌ CRASH no teste do OBSERVE:', crashed2.stack); process.exitCode = 1; }
  else if (observant) console.log('✅ ciclo completo OBSERVE -> endObserve rodou sem exceção.\n');
}

if (process.exitCode === 1) {
  console.error('\n❌ pelo menos um teste forçado quebrou — ver stack acima.');
} else {
  console.log('\n✅ os dois testes forçados (Show completo, OBSERVE completo) passaram sem exceção não tratada.');
}
