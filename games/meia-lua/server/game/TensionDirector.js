// Direciona o RITMO do terror — quando e que CATEGORIA de evento pode
// acontecer — sem saber nada sobre como o jogo funciona por dentro. Quem
// efetivamente executa cada evento continua sendo o Match (ver
// runRandomEvent em Match.js): esse desacoplamento é de propósito, pra não
// duplicar nada do que já existe (portas, animatrônicos, área, etc.) e pra
// dar pra entender/ajustar o "sobe e desce" da tensão isolado do resto.
//
// Ciclo de fases (pedido explicitamente): calma → estranheza → tensão →
// (às vezes) falsa segurança → tensão extrema → evento real → calma de
// novo. A tensão em si é um número 0-100 que sobe sozinho com o tempo e
// mais rápido perto de perigo/escuro/sozinho, e as fases mudam de acordo
// com ela — não é só um timer, cada partida "respira" diferente.

const CATEGORY_BY_PHASE = {
  calma: ['ambient'],
  estranheza: ['ambient', 'falso'],
  tensao: ['ambient', 'falso', 'presenca'],
  falsaSeguranca: ['ambient'],
  tensaoExtrema: ['ambient', 'falso', 'presenca', 'real'],
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

export class TensionDirector {
  constructor() {
    this.phase = 'calma';
    this.tension = 8;
    this.timeInPhase = 0;
    this.matchTime = 0;
    this.recoveryUntil = 0; // enquanto > matchTime, só 'ambient' e 'sempre' passam
    this.exposure = new Map(); // tipo do evento -> quantas vezes já rodou nessa partida
  }

  // Chamado todo tick do Match (ver Match.tick()). `signals` é só leitura
  // do estado do jogo que o Match já calcula de qualquer forma — o
  // director nunca mexe em nada do mundo, só decide ritmo.
  update(dt, signals) {
    this.matchTime += dt;
    this.timeInPhase += dt;

    let delta = 0.55; // deriva natural pra cima — a tensão nunca fica parada de vez
    if (signals.darkness) delta += 0.9;
    if (signals.nearDanger) delta += 1.1;
    if (signals.alone) delta += 0.35;
    if (signals.togetherCalm) delta -= 0.4; // grupo junto e tudo calmo: um respiro
    if (this.phase === 'falsaSeguranca') delta -= 1.6; // a "isca" de segurança precisa parecer real
    this.tension = clamp(this.tension + delta * dt, 0, 100);

    this._advance();
  }

  _advance() {
    const t = this.tension;
    switch (this.phase) {
      case 'calma':
        if (t > 22) this._enter('estranheza');
        break;
      case 'estranheza':
        if (t > 42) this._enter('tensao');
        else if (t < 10) this._enter('calma');
        break;
      case 'tensao':
        if (t > 68) this._enter(Math.random() < 0.35 ? 'falsaSeguranca' : 'tensaoExtrema');
        break;
      case 'falsaSeguranca':
        // Dura um tempo fixo curto (não depende só da tensão, que está
        // caindo de propósito nessa fase) — depois volta a subir com tudo.
        if (this.timeInPhase > this._falsaDur) this._enter('tensaoExtrema');
        break;
      case 'tensaoExtrema':
        // Fica aqui até um evento 'real' de fato rolar (ver
        // notifyEventRan) — enquanto isso a tensão real satura no teto,
        // então o jogo mantém pressão sem crescer pra sempre.
        break;
    }
  }

  _enter(phase) {
    this.phase = phase;
    this.timeInPhase = 0;
    if (phase === 'falsaSeguranca') this._falsaDur = rnd(6, 12);
  }

  // Primeiros segundos de partida: só o mais discreto possível, pra dar
  // tempo do jogador pensar "foi só o jogo" antes de qualquer coisa maior
  // (pedido #13 — primeira impressão).
  get earlyGame() {
    return this.matchTime < 45;
  }

  allowedCategories() {
    if (this.earlyGame) return ['ambient'];
    if (this.matchTime < this.recoveryUntil) return ['ambient'];
    return CATEGORY_BY_PHASE[this.phase] || ['ambient'];
  }

  // Peso adaptativo: cada vez que um tipo específico já rodou nessa
  // partida, ele fica proporcionalmente mais raro (nunca impossível) —
  // isso impede o jogador de "decorar" os sinais (pedido #9).
  exposureFactor(type) {
    const n = this.exposure.get(type) || 0;
    return 1 / (1 + n * 0.55);
  }

  // Chamado pelo Match logo depois de executar o evento sorteado.
  notifyEventRan(type, category) {
    this.exposure.set(type, (this.exposure.get(type) || 0) + 1);
    if (category === 'real') {
      // Depois de um susto de verdade, período de recuperação: a tensão
      // desaba e some por um tempo, só ambiente por enquanto — o silêncio
      // depois do susto é tão importante quanto o susto (pedido #12).
      this.tension = 10;
      this._enter('calma');
      this.recoveryUntil = this.matchTime + rnd(22, 38);
    }
  }

  // ------------------------------------------------------------------
  // Extensões do sistema integrado (ver server/game/README-terror.md):
  // a tensão passou a influenciar mais coisa além de "que categoria pode
  // sortear" — frequência de flicker, chance de um animatrônico entrar em
  // OBSERVE (ver Animatronic.js), densidade de ambientação. Tudo aqui é
  // só LEITURA de `this.tension`/`this.phase`, nada novo pra manter em
  // sincronia — o resto do sistema (Match, Animatronic, EventChains) lê
  // esses getters em vez de reimplementar a curva de tensão em cada lugar
  // (pedido #25: "a tensão deve influenciar frequência, comportamento dos
  // animatrônicos, iluminação, áudio... o jogador deve perceber a escalada
  // sem saber que existe uma variável chamada tensão").
  get intensity01() { return this.tension / 100; }

  // Multiplica a chance de flicker/falha de luz — quase nada na calma,
  // bem mais frequente perto da tensão extrema (pedido #23, mas sem
  // exagerar: ver o teto de 2.2x, "se toda luz piscar sempre, deixa de
  // ser assustador").
  flickerBias() { return 0.6 + Math.min(1.6, this.intensity01 * 1.8); }

  // Chance de um animatrônico "só observar" em vez de rondar normal —
  // pouca coisa na calma, mais comum em tensão/tensão extrema — mas nunca
  // trivial demais mesmo no pico, porque "presença sem ataque" perde a
  // graça se virar rotina.
  observeBias() {
    if (this.earlyGame) return 0;
    if (this.matchTime < this.recoveryUntil) return 0;
    return Math.min(0.85, this.intensity01 * 1.1);
  }
}
