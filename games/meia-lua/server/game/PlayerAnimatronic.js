// Controlador de recurso/cooldown/perseguição de um jogador que se tornou,
// em segredo, o animatrônico da partida (ver Match.js, modo 'animatronic').
// Deliberadamente NÃO é uma subclasse de Animatronic (server/ai/Animatronic.js)
// — aquele é uma máquina de estados de IA; isto aqui só guarda
// energia/cooldowns/estado de perseguição de uma entidade controlada por
// INPUT DE JOGADOR, então o modelo de controle é outro. Testável isolado,
// sem precisar de uma Match inteira (ver __testPlayerAnimatronic.mjs).
import { RESOURCE, ABILITIES, CHASE, typePreset, abilityDef } from '../../shared/animatronicMode.js';

let nextBeastId = 900001; // faixa própria, bem acima de qualquer id de Animatronic (ver ai/Animatronic.js, nextId começa em 1) — nunca colide no snapshot.

export class PlayerAnimatronic {
  constructor(type) {
    this.id = nextBeastId++;
    this.type = type;
    this.preset = typePreset(type);
    this.energyMax = this.preset.resourceMax ?? RESOURCE.max;
    this.energy = this.energyMax;
    this.cooldowns = new Map(); // abilityId -> segundos restantes
    this.manifestTimeLeft = 0; // >0 enquanto deve aparecer no snapshot dos humanos
    this.chaseState = 'idle'; // 'idle' | 'active' | 'cooldown'
    this.chaseTimeLeft = 0;
    this.chaseCooldownLeft = 0;
    this.targetId = null; // alvo atual durante uma perseguição
  }

  costFor(abilityId) {
    const def = abilityDef(abilityId);
    if (!def) return Infinity;
    const mult = this.preset.costMult?.[def.category] ?? 1;
    return def.cost * mult;
  }

  cooldownLeft(abilityId) {
    return Math.max(0, this.cooldowns.get(abilityId) || 0);
  }

  canUse(abilityId) {
    const def = abilityDef(abilityId);
    if (!def) return false;
    if (this.cooldownLeft(abilityId) > 0) return false;
    if (this.energy < this.costFor(abilityId)) return false;
    if (abilityId === 'chase' && this.chaseState !== 'idle') return false;
    return true;
  }

  /** Gasta o recurso e inicia o cooldown. Retorna false sem efeito nenhum se não pode. */
  use(abilityId) {
    if (!this.canUse(abilityId)) return false;
    const def = abilityDef(abilityId);
    this.energy = Math.max(0, this.energy - this.costFor(abilityId));
    this.cooldowns.set(abilityId, def.cooldown);
    if (def.manifestFor) this.manifestTimeLeft = Math.max(this.manifestTimeLeft, def.manifestFor);
    if (abilityId === 'chase') this.startChase();
    return true;
  }

  startChase() {
    this.chaseState = 'active';
    this.chaseTimeLeft = CHASE.maxDuration;
    this.manifestTimeLeft = Math.max(this.manifestTimeLeft, CHASE.maxDuration + 1);
  }

  endChase() {
    this.chaseState = 'cooldown';
    this.chaseCooldownLeft = CHASE.cooldownAfter;
    this.chaseTimeLeft = 0;
    this.targetId = null;
  }

  canChase() {
    return this.chaseState === 'idle' && this.energy >= this.costFor('chase') && this.cooldownLeft('chase') <= 0;
  }

  isManifesting() {
    return this.manifestTimeLeft > 0 || this.chaseState === 'active';
  }

  tick(dt) {
    this.energy = Math.min(this.energyMax, this.energy + RESOURCE.regenPerSec * (this.preset.regenMult ?? 1) * dt);
    for (const [id, left] of this.cooldowns) {
      const n = left - dt;
      if (n <= 0) this.cooldowns.delete(id); else this.cooldowns.set(id, n);
    }
    if (this.manifestTimeLeft > 0) this.manifestTimeLeft = Math.max(0, this.manifestTimeLeft - dt);
    if (this.chaseState === 'active') {
      this.chaseTimeLeft -= dt;
      if (this.chaseTimeLeft <= 0) this.endChase();
    } else if (this.chaseState === 'cooldown') {
      this.chaseCooldownLeft -= dt;
      if (this.chaseCooldownLeft <= 0) { this.chaseState = 'idle'; this.chaseCooldownLeft = 0; }
    }
  }

  /** Estado enviado só pro próprio jogador-animatrônico (HUD) — nunca aos humanos. */
  hud() {
    return {
      type: this.type, style: this.preset.style, label: this.preset.label,
      energy: Math.round(this.energy), energyMax: Math.round(this.energyMax),
      cooldowns: Object.fromEntries([...this.cooldowns].map(([k, v]) => [k, Math.round(v * 10) / 10])),
      chaseState: this.chaseState,
      chaseTimeLeft: Math.round(this.chaseTimeLeft * 10) / 10,
      chaseCooldownLeft: Math.round(this.chaseCooldownLeft * 10) / 10,
    };
  }
}
