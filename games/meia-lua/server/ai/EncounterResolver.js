// Decide O QUE acontece quando um animatrônico "encontra" um jogador — a
// REGRA FUNDAMENTAL do pedido de reformulação: "animatronic apareceu" NÃO
// pode significar automaticamente "vai perseguir". Isso substitui os 3
// lugares em Animatronic.js que antes chamavam m.requestChase(...) direto
// assim que percebiam alguém (update()/sense "instant", updateAlert() com
// notice cheio, startBlackoutHunt()) — agora todos passam primeiro por
// Match.resolveEncounter(), que usa este arquivo pra sortear o desfecho e
// só DEPOIS despacha pra implementação (ver Match.js).
//
// requestChase() e firstChaseUnlocked continuam existindo exatamente como
// antes e continuam sendo o ÚNICO portão de "perseguição de verdade" —
// este resolver só decide SE vale tentar. Isso preserva 100% do
// comportamento já testado da sequência de abertura (regra #17: a primeira
// perseguição precisa ter contexto).
//
// Puro e testável de propósito: não mexe em Match nem em Animatronic, só
// recebe um tipo + contexto e devolve uma string. Quem executa o resultado
// reaproveita métodos que já existiam (fxVultoRapido, startObserve, o
// mesmo algoritmo de reposicionamento de teleportAfterAttack/endObserve,
// etc.) — nenhuma implementação paralela nova por trás de cada desfecho.

export const OUTCOMES = [
  'nothing', 'observe', 'vanish', 'environmental', 'block',
  'doorManipulate', 'manifest', 'relocate', 'chase', 'flee', 'inexplicable',
];

// Pesos-base (antes de qualquer modulação). "chase" começa como a fatia
// individual mais comum, mas ainda pequena frente às outras 10 somadas —
// isso sozinho já garante que perseguir nunca seja "o óbvio" (pedido #1).
const BASE_WEIGHTS = {
  nothing: 14, observe: 10, vanish: 8, environmental: 11, block: 6,
  doorManipulate: 6, manifest: 9, relocate: 4, chase: 20, flee: 6, inexplicable: 7,
};

// Multiplicadores por "filosofia comportamental" de cada animatrônico
// (pedido #2/#5: "não quero clones com skins diferentes"). Reaproveita os
// 5 tipos que já existem em server/ai/types.js — nenhum personagem novo,
// só a DECISÃO de encontro muda por identidade.
export const ARCHETYPE_MULT = {
  // Gregório = "O Implacável" (pedido #3): não foge, quase não some — ele
  // não precisa, ele anda até você. Bloquear rota e forçar porta ficam bem
  // mais prováveis que em qualquer outro (ver Match.encounterDoorManipulate
  // e o forceDoorSequence novo em Animatronic.js pro caso de perseguição).
  gregorio: {
    nothing: 0.8, observe: 1.0, vanish: 0.5, environmental: 1.0, block: 2.3,
    doorManipulate: 2.2, manifest: 0.45, relocate: 0, chase: 1.25, flee: 0.05, inexplicable: 0.7,
  },
  // Lume = "A Veloz" (pedido #7): vive de aparições curtas — reaproveita
  // fxVultoRapido — perseguições dela já são as mais curtas por natureza
  // (chaseLimit em types.js). Prefere MOSTRAR pouco a perseguir muito.
  lume: {
    nothing: 1.0, observe: 0.45, vanish: 1.3, environmental: 0.85, block: 0.3,
    doorManipulate: 0.4, manifest: 2.6, relocate: 0.3, chase: 0.8, flee: 1.5, inexplicable: 1.0,
  },
  // Maestro = "O Deslocado" (pedido #6): deslocamento/reposicionamento
  // anômalo é a marca dele — ver Match.encounterRelocate (nunca na frente
  // do jogador, sempre com cooldown próprio).
  maestro: {
    nothing: 1.0, observe: 1.1, vanish: 1.5, environmental: 1.1, block: 0.5,
    doorManipulate: 0.6, manifest: 1.2, relocate: 3.2, chase: 0.85, flee: 0.7, inexplicable: 1.7,
  },
  // Tonho = "O Observador": já tinha a flag `observant` em types.js — aqui
  // isso vira fato consumado no resolver também: observar/nada muito mais
  // comuns, perseguir bem menos.
  tonho: {
    nothing: 1.45, observe: 2.3, vanish: 1.2, environmental: 1.1, block: 0.55,
    doorManipulate: 0.5, manifest: 0.8, relocate: 0.15, chase: 0.65, flee: 0.85, inexplicable: 1.0,
  },
  // Marola = "Persistente contextual" (mantém campPunish já existente):
  // não é sobre aparecer bonito, é sobre fechar o cerco devagar.
  marola: {
    nothing: 1.0, observe: 0.9, vanish: 0.85, environmental: 1.0, block: 1.35,
    doorManipulate: 1.05, manifest: 0.85, relocate: 0.25, chase: 1.15, flee: 0.75, inexplicable: 0.9,
  },
};

function archetypeMult(type) { return ARCHETYPE_MULT[type] || {}; }

// Modulação por CONTEXTO (pedido #12: "terror não pode ser linear" +
// pedido #18: "Terror Director" — a mesma tensão que já rege
// flicker/observeBias em TensionDirector.js também mexe nesse sorteio).
function contextMult(outcome, ctx) {
  let m = 1;
  const t = ctx.tension ?? 0.3; // 0..1, ver TensionDirector.intensity01

  if (outcome === 'chase') m *= 0.55 + t * 1.5; // raro no início, comum perto do pico
  if (outcome === 'manifest') m *= 0.7 + t * 0.9;
  if (outcome === 'environmental') m *= 0.85 + t * 0.5;
  if (outcome === 'nothing') m *= 1.3 - t * 0.9; // mais raro no pico, nunca impossível
  if (outcome === 'observe') m *= 1.1 - t * 0.3;

  // Gatilho de origem: um apagão (Gregório) pesa diferente de um simples
  // "te vi de relance" — precisa continuar genuinamente perigoso.
  if (ctx.trigger === 'blackout') {
    if (outcome === 'chase') m *= 1.7;
    if (outcome === 'flee') m *= 0.25;
    if (outcome === 'observe') m *= 0.5;
    if (outcome === 'nothing') m *= 0.6;
  }
  // Já ficou de olho por um tempo (updateAlert acumulando notice) — bem
  // menos plausível que a única conclusão disso seja "nada" comparado a um
  // primeiro relance (trigger 'sense').
  if (ctx.trigger === 'alert') {
    if (outcome === 'nothing') m *= 0.5;
    if (outcome === 'chase') m *= 1.15;
  }

  // Isolamento (pedido #17: presença de outros jogadores muda o terror,
  // sem virar "sozinho = jumpscare" automático).
  if (ctx.isolated) {
    if (outcome === 'chase') m *= 1.2;
    if (outcome === 'manifest') m *= 1.15;
    if (outcome === 'nothing') m *= 0.9;
  } else {
    if (outcome === 'observe') m *= 1.15;
    if (outcome === 'environmental') m *= 1.15;
    if (outcome === 'chase') m *= 0.85;
  }

  // Anti-repetição (pedido #21): ctx.recent é um array com os últimos
  // desfechos DESSE animatrônico, mais recente primeiro — repetir o mesmo
  // tipo de coisa em sequência fica bem menos provável, nunca impossível.
  const recent = ctx.recent || [];
  const ix = recent.indexOf(outcome);
  if (ix === 0) m *= 0.22;
  else if (ix === 1) m *= 0.55;

  return Math.max(0, m);
}

export function weightsFor(type, ctx) {
  const am = archetypeMult(type);
  const w = {};
  for (const o of OUTCOMES) {
    const base = BASE_WEIGHTS[o] * (am[o] ?? 1);
    w[o] = Math.max(0, base * contextMult(o, ctx));
  }
  return w;
}

/**
 * @param {string} type - chave de ANIM_TYPES (tonho/marola/lume/gregorio/maestro)
 * @param {object} ctx - { tension: 0..1, trigger: 'sense'|'alert'|'blackout', isolated: bool, recent: string[] }
 * @param {() => number} rand - injetável pra teste determinístico
 * @returns {string} um dos OUTCOMES
 */
export function resolveEncounter(type, ctx = {}, rand = Math.random) {
  const weights = weightsFor(type, ctx);
  let total = 0;
  for (const o of OUTCOMES) total += weights[o];
  if (total <= 0) return 'nothing';
  let r = rand() * total;
  for (const o of OUTCOMES) {
    r -= weights[o];
    if (r <= 0) return o;
  }
  return OUTCOMES[OUTCOMES.length - 1];
}
