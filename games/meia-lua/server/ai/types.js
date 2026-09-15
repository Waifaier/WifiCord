// Parâmetros de cada animatrônico original.
// speed/chase em tiles por segundo; sight/hearing em tiles; fov em graus.
export const ANIM_TYPES = {
  tonho: {
    speed: 1.95, chase: 3.6, sight: 8, fov: 115, hearing: 10, damage: 36,
    doorTime: 1.4, home: { x: 26.5, y: 16.5 },
    patrol: ['palco', 'salao', 'corredor_oeste', 'corredor_norte', 'corredor_leste', 'escritorio', 'seguranca'],
    idle: [4, 9], shyOnCamera: true, rolls: true,
  },
  marola: {
    speed: 1.45, chase: 4.6, sight: 9, fov: 95, hearing: 8, damage: 30,
    doorTime: 1.8, home: { x: 37.5, y: 16.5 },
    patrol: ['cozinha', 'banheiros', 'corredor_leste', 'salao', 'palco'],
    idle: [4, 9], chaseLimit: 4.5, tiredTime: 4,
  },
  lume: {
    speed: 2.25, chase: 3.85, sight: 5.5, fov: 140, hearing: 6, damage: 26,
    doorTime: 1.0, home: { x: 60.5, y: 24.5 },
    patrol: ['cozinha', 'salao', 'banheiros', 'corredor_leste', 'corredor_norte', 'corredor_oeste', 'deposito', 'palco'],
    idle: [3, 7], lightSeeker: true, lightSight: 14,
  },
  gregorio: {
    speed: 1.8, chase: 3.3, sight: 7, fov: 105, hearing: 16, damage: 50,
    doorTime: 0.4, home: { x: 64.5, y: 33.5 },
    patrol: ['cozinha', 'salao', 'corredor_leste', 'corredor_oeste', 'corredor_norte', 'porao', 'deposito', 'escritorio', 'seguranca'],
    idle: [3, 8], bashDoors: true,
  },
  maestro: {
    speed: 1.35, chase: 2.9, sight: 12, fov: 360, hearing: 18, damage: 75,
    doorTime: 0.8, home: { x: 31.5, y: 14.5 },
    patrol: ['palco', 'salao', 'corredor_norte', 'corredor_leste', 'corredor_oeste', 'cozinha', 'banheiros', 'porao', 'sala_secreta', 'deposito', 'escritorio', 'seguranca'],
    idle: [2, 5], conductor: true, blinks: true, dormant: true,
  },
  pipoca: {
    speed: 0, chase: 0, sight: 6, fov: 360, hearing: 0, damage: 0,
    doorTime: 1, home: { x: 44.5, y: 25.5 },
    patrol: [], idle: [9999, 9999], trap: true,
    spots: [{ x: 44.5, y: 25.5 }, { x: 14.5, y: 20.5 }, { x: 48.5, y: 20.5 }, { x: 58.5, y: 34.5 }, { x: 29.5, y: 10.5 }, { x: 19.5, y: 34.5 }, { x: 8.5, y: 5.5 }, { x: 38.5, y: 18.5 }],
  },
};

export const STATES = ['IDLE', 'PATROL', 'INVESTIGATE', 'CHASE', 'SEARCH', 'RETURN', 'STUNNED', 'DORMANT', 'DISABLED', 'ALERT'];
export const STATE_CODE = Object.fromEntries(STATES.map((s, i) => [s, i]));
export const TYPE_LIST = Object.keys(ANIM_TYPES);
