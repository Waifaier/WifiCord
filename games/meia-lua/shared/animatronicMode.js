// Configuração central do "Modo Animatronic" (um ou mais jogadores se
// tornam, em segredo, um animatrônico jogável em vez de um sobrevivente
// humano). TODO valor de balanceamento do modo mora aqui — nenhum número
// mágico espalhado em Match.js/PlayerAnimatronic.js/adminBridge.js/client —
// exatamente como pedido: "todos os valores de balanceamento devem estar
// numa configuração central, não espalhados em números mágicos no código".
//
// Reaproveita os 3 animatrônicos "observantes" que já existiam (tonho,
// gregorio, maestro — ver server/ai/types.js) como as 3 identidades
// jogáveis, cada uma com um preset de custo/regeneração diferente — em vez
// de inventar personagens novos (o pedido também pede "só assets originais
// ou já licenciados... não copie personagens de outras franquias", então
// reaproveitar o que já existe no próprio jogo é o caminho mais seguro).

// Quantos animatrônicos jogadores para cada faixa de tamanho de sala —
// humanos sempre maioria (ver animCountFor abaixo, que aplica esse teto de
// qualquer forma).
const COUNT_TABLE = [
  { max: 3, count: 1 },
  { max: 6, count: 1 },
  { max: 9, count: 2 },
];

export function animCountFor(playerCount) {
  const n = Math.max(0, Math.floor(playerCount));
  if (n < 2) return 0; // não faz sentido o modo com menos de 2 jogadores
  for (const row of COUNT_TABLE) if (n <= row.max) return Math.min(row.count, n - 1);
  // 10+: proporcional, com teto de 4 — configurável mudando esses números.
  return Math.min(4, Math.max(1, Math.floor(n / 5)), n - 1);
}

// Recurso único (ENERGIA/PRESENÇA) — gasta em toda ação do animatrônico
// jogador, regenera sozinho aos poucos pra evitar spam de eventos.
export const RESOURCE = {
  max: 100,
  regenPerSec: 1.8, // ~56s pra encher do zero
};

// Custo/cooldown por habilidade — reaproveita o MESMO efeito real que já
// existe no jogo (ver Match.fxX* e Match.useAnimAbility). Pequeno evento =
// custo baixo; manifestação/perseguição = custo alto + cooldown longo.
export const ABILITIES = {
  passosAtras: { cost: 8, cooldown: 9, category: 'pequeno' },
  respiracaoDistante: { cost: 9, cooldown: 11, category: 'pequeno' },
  vultoRapido: { cost: 13, cooldown: 15, category: 'pequeno' },
  presenca: { cost: 10, cooldown: 13, category: 'pequeno' },
  flicker: { cost: 15, cooldown: 20, category: 'medio' },
  falsoAlarme: { cost: 20, cooldown: 26, category: 'medio' },
  observando: { cost: 26, cooldown: 32, category: 'manifestacao', manifestFor: 5 }, // aparição calma, visível por 5s
  manifestar: { cost: 34, cooldown: 42, category: 'manifestacao', manifestFor: 3.5 }, // aparição breve em outro lugar
  chase: { cost: 55, cooldown: 90, category: 'perseguicao' },
};

export function abilityDef(id) {
  return ABILITIES[id] || null;
}

// Perseguição do animatrônico-jogador: limitada, com duração máxima e
// cooldown — nunca pode simplesmente perseguir pra sempre nem repetir sem
// parar (proibições explícitas do pedido).
export const CHASE = {
  maxDuration: 22, // segundos
  cooldownAfter: 75, // segundos antes de poder iniciar outra
  catchRadius: 1.15, // tiles — alcance pra "pegar" o alvo durante a perseguição
  catchCheckEvery: 0.35, // segundos entre checagens de alcance (evita checar todo tick)
};

// 3 identidades jogáveis, cada uma reaproveitando um animatrônico "de IA"
// já existente (tipo/velocidade/flavor — ver server/ai/types.js e
// ANIMATRONIC_INFO em shared/nights.js), só com um preset de
// custo/regeneração diferente por cima.
export const TYPES = {
  tonho: {
    style: 'observador',
    label: 'Observador silencioso',
    resourceMax: 112, regenMult: 1.15,
    costMult: { pequeno: 0.85, medio: 0.95, manifestacao: 1, perseguicao: 1.2 },
  },
  gregorio: {
    style: 'agressivo',
    label: 'Agressivo, perseguidor',
    resourceMax: 88, regenMult: 0.88,
    costMult: { pequeno: 1.1, medio: 1.05, manifestacao: 1.05, perseguicao: 0.8 },
  },
  maestro: {
    style: 'imprevisivel',
    label: 'Manipulador, imprevisível',
    resourceMax: 100, regenMult: 1,
    costMult: { pequeno: 1, medio: 0.85, manifestacao: 0.85, perseguicao: 1 },
  },
};
const TYPE_KEYS = Object.keys(TYPES);

export function typePreset(type) {
  return TYPES[type] || TYPES[TYPE_KEYS[0]];
}

/** Sorteia N tipos jogáveis (com repetição só se N > nº de presets). */
export function pickAnimTypes(n) {
  const pool = [...TYPE_KEYS];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[i % pool.length]);
  return out;
}

// Opções padrão pro seletor de modo na criação de sala (pedido #28) — só
// "Automático"/"Aleatória"/"Padrão" por enquanto, arquitetura pronta pra
// virar configurável de verdade depois.
export const DEFAULT_ANIM_MODE_OPTS = {
  animCount: 'auto',
  selection: 'aleatoria',
  objectives: 'padrao',
  time: 'padrao',
};

export const GAME_MODES = ['normal', 'animatronic'];
