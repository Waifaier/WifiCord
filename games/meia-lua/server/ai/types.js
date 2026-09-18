// Parâmetros de cada animatrônico original.
// speed/chase em tiles por segundo; sight/hearing em tiles; fov em graus.
// BALANCEAMENTO: antes só a Marola cansava numa perseguição longa
// (chaseLimit/tiredTime) — todo o resto perseguia sem parar, o que somado
// à stamina curta do jogador tornava fugir quase impossível. Agora todos
// os 5 animatrônicos de verdade têm um "fôlego": depois de perseguir sem
// parar por `chaseLimit` segundos, ficam com metade da velocidade e caem
// pra SEARCH por `tiredTime` segundos (ver updateChase em Animatronic.js).
// O tempo de fôlego varia com o "personagem" de cada um — quem já é lento
// aguenta perseguir mais tempo, quem é rápido cansa antes.
export const ANIM_TYPES = {
  tonho: {
    speed: 1.95, chase: 3.6, sight: 8, fov: 115, hearing: 10, damage: 36,
    doorTime: 1.4, home: { x: 26.5, y: 16.5 },
    patrol: ['palco', 'salao', 'corredor_oeste', 'corredor_norte', 'corredor_leste', 'escritorio', 'seguranca'],
    idle: [4, 9], shyOnCamera: true, rolls: true, chaseLimit: 7, tiredTime: 4.5,
    // "Observante": de vez em quando, em vez de rondar normal, ele para a
    // uma certa distância e só fica ali, encarando — sem se aproximar,
    // sem atacar (ver OBSERVE em Animatronic.js) — e depois some. Só os
    // 3 com essa flag entram nesse comportamento; os outros dois (Marola,
    // Lume) são mais sobre velocidade/perseguição do que sobre presença
    // silenciosa (pedido #14: "cada animatronic deve possuir
    // personalidade comportamental").
    observant: true,
  },
  marola: {
    speed: 1.45, chase: 4.6, sight: 9, fov: 95, hearing: 8, damage: 30,
    doorTime: 1.8, home: { x: 37.5, y: 16.5 },
    patrol: ['cozinha', 'banheiros', 'corredor_leste', 'salao', 'palco'],
    idle: [4, 9], chaseLimit: 4.5, tiredTime: 4,
    campPunish: true, // evento: quem fica parado no mesmo lugar por muito
    // tempo vira alvo preferido da próxima ronda dela (ver startPatrol()).
  },
  lume: {
    // É a mais rápida de todas (speed/chase) e é completamente surda
    // (hearing: 0) — passos, gritos, correr, nada disso a alerta. Só
    // enxerga mesmo, e enxerga muito bem perto de luz (lightSeeker). Por
    // ser a mais rápida de todas, é quem tem o fôlego mais curto.
    speed: 2.25, chase: 3.85, sight: 5.5, fov: 140, hearing: 0, damage: 26,
    doorTime: 1.0, home: { x: 60.5, y: 24.5 },
    patrol: ['cozinha', 'salao', 'banheiros', 'corredor_leste', 'corredor_norte', 'corredor_oeste', 'deposito', 'palco'],
    idle: [3, 7], lightSeeker: true, lightSight: 14, chaseLimit: 5.5, tiredTime: 5,
  },
  gregorio: {
    speed: 1.8, chase: 3.3, sight: 7, fov: 105, hearing: 16, damage: 50,
    doorTime: 0.4, home: { x: 64.5, y: 33.5 },
    patrol: ['cozinha', 'salao', 'corredor_leste', 'corredor_oeste', 'corredor_norte', 'porao', 'deposito', 'escritorio', 'seguranca'],
    idle: [3, 8], bashDoors: true, hearsVoice: true, // também escuta o microfone (ver Match.playerVoiceNoise)
    blackoutStalker: true, // evento: quando a energia acaba, ele para de
    // rondar normal e vem caçando por audição (ver Animatronic.startBlackoutHunt) —
    // só dá pra ver os olhos brilhando dele no escuro até a luz voltar.
    // "O Implacável" (pedido #3/#4): só ele força porta COMUM em estágios
    // durante perseguição (ver Animatronic.forceDoorSequence) — os outros
    // 4 continuam abrindo porta comum do jeito de sempre, silencioso.
    doorBreaker: true,
    chaseLimit: 8, tiredTime: 4, observant: true,
  },
  maestro: {
    speed: 1.35, chase: 2.9, sight: 12, fov: 360, hearing: 18, damage: 75,
    doorTime: 0.8, home: { x: 31.5, y: 14.5 },
    patrol: ['palco', 'salao', 'corredor_norte', 'corredor_leste', 'corredor_oeste', 'cozinha', 'banheiros', 'porao', 'sala_secreta', 'deposito', 'escritorio', 'seguranca'],
    idle: [2, 5], conductor: true, blinks: true, dormant: true, chaseLimit: 9, tiredTime: 3.5, observant: true,
  },
  pipoca: {
    speed: 0, chase: 0, sight: 6, fov: 360, hearing: 0, damage: 0,
    doorTime: 1, home: { x: 44.5, y: 25.5 },
    patrol: [], idle: [9999, 9999], trap: true,
    spots: [{ x: 44.5, y: 25.5 }, { x: 14.5, y: 20.5 }, { x: 48.5, y: 20.5 }, { x: 58.5, y: 34.5 }, { x: 29.5, y: 10.5 }, { x: 19.5, y: 34.5 }, { x: 8.5, y: 5.5 }, { x: 38.5, y: 18.5 }],
  },
};

// OBSERVE adicionado no FIM da lista de propósito (índice 10) — o código
// de estado (STATE_CODE) vai pro snapshot da rede como número (ver
// Match.js ~linha 1633), e o cliente decodifica de volta pelo MESMO índice
// numa cópia própria dessa lista (ver STATES em client/js/render.js) —
// adicionar no fim em vez de no meio não muda o índice de nenhum estado
// que já existia.
export const STATES = ['IDLE', 'PATROL', 'INVESTIGATE', 'CHASE', 'SEARCH', 'RETURN', 'STUNNED', 'DORMANT', 'DISABLED', 'ALERT', 'OBSERVE'];
export const STATE_CODE = Object.fromEntries(STATES.map((s, i) => [s, i]));
export const TYPE_LIST = Object.keys(ANIM_TYPES);
