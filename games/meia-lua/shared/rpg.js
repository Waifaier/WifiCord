// Regras de RPG compartilhadas (fórmulas). O servidor é quem aplica.
import { ITEMS, EQUIP_SLOTS } from './items.js';

export const ATTRIBUTES = ['coragem', 'investigacao', 'velocidade', 'resistencia', 'tecnica'];
export const ATTR_NAMES = {
  coragem: 'Coragem',
  investigacao: 'Investigação',
  velocidade: 'Velocidade',
  resistencia: 'Resistência',
  tecnica: 'Técnica',
};
export const ATTR_DESC = {
  coragem: 'Reduz o ganho de medo e o tempo atordoado após um ataque.',
  investigacao: 'Revasculha mais rápido, acha mais dinheiro e sente itens de missão por perto.',
  velocidade: 'Aumenta velocidade de movimento e stamina.',
  resistencia: 'Aumenta HP máximo e reduz dano recebido.',
  tecnica: 'Conserta mais rápido e reduz o gasto de energia das câmeras.',
};
export const ATTR_MAX = 10;
export const MAX_LEVEL = 50;
export const POINTS_PER_LEVEL = 2;

export function xpToNext(level) {
  return Math.round(90 * Math.pow(level, 1.35));
}

/** Aplica XP e retorna { level, xp, levelsGained } */
export function applyXp(level, xp, gained) {
  let l = level, x = xp + gained, up = 0;
  while (l < MAX_LEVEL && x >= xpToNext(l)) {
    x -= xpToNext(l);
    l++;
    up++;
  }
  if (l >= MAX_LEVEL) x = Math.min(x, xpToNext(l));
  return { level: l, xp: x, levelsGained: up };
}

/** Atributos efetivos = base + bônus de equipamentos */
export function effectiveAttrs(base, equipment) {
  const out = {};
  for (const a of ATTRIBUTES) out[a] = base[a] || 1;
  for (const slot of EQUIP_SLOTS) {
    const it = ITEMS[equipment[slot]];
    if (it && it.bonus) for (const k in it.bonus) out[k] += it.bonus[k];
  }
  return out;
}

export function derivedStats(attrs, equipment) {
  const armorItem = ITEMS[equipment.corpo];
  const lamp = ITEMS[equipment.lanterna];
  const feet = ITEMS[equipment.pes];
  return {
    maxHp: 100 + 12 * (attrs.resistencia - 1),
    damageMult: (1 - (armorItem?.armor || 0)) * (1 - 0.035 * (attrs.resistencia - 1)),
    speed: 3.1 * (1 + 0.045 * (attrs.velocidade - 1)),
    // Base subiu de 100 pra 115 — parte do ajuste pra fugir dos
    // animatrônicos não ficar tão punitivo pra quem ainda não investiu
    // pontos em velocidade (ver também o gasto/regeneração de stamina em
    // Match.js e o "cansaço" ao perseguir em Animatronic.js).
    maxStamina: 115 + 8 * (attrs.velocidade - 1),
    fearMult: Math.max(0.35, 1 - 0.07 * (attrs.coragem - 1)),
    stunMult: Math.max(0.4, 1 - 0.06 * (attrs.coragem - 1)),
    searchTime: Math.max(0.7, 2.6 - 0.2 * (attrs.investigacao - 1)),
    lootMult: 1 + 0.12 * (attrs.investigacao - 1),
    senseRadius: 1.5 + 1.1 * attrs.investigacao,
    repairMult: Math.max(0.35, 1 - 0.08 * (attrs.tecnica - 1)),
    camDrainMult: Math.max(0.4, 1 - 0.06 * (attrs.tecnica - 1)),
    light: lamp?.light || 3.5,
    quiet: feet?.quiet || 0,
    tablet: !!ITEMS[equipment.acessorio]?.tablet,
  };
}
