// Agendador simples de passos futuros, pro Match poder montar uma
// SEQUÊNCIA de coisas ao longo do tempo em vez de um evento = um efeito
// instantâneo só. É o que permite: falso alarme com "prepara → resolve
// pra nada → só depois vem o silêncio" (pedido #19/#20), e as correntes
// assimétricas entre jogadores tipo "A ouve passos, alguns segundos
// depois B vê um vulto em outro lugar" (pedido #17, o exemplo dado
// literalmente no pedido).
//
// De propósito bem burro: não sabe nada sobre eventos, animatrônicos ou
// jogadores — só guarda "em tal hora do jogo, rode essa função" e chama
// de volta. Quem decide O QUE roda em cada passo é sempre o Match (ou o
// Animatronic, via match.chains), então a lógica de jogo continua toda
// num lugar só, isso aqui é só o relógio.
export class EventChains {
  constructor(match) {
    this.match = match;
    this.pending = []; // [{ at, fn }]
  }

  // Agenda `fn` pra rodar daqui a `delaySeconds` (tempo de partida, não
  // tempo real — se o jogo pausar/acelerar isso acompanha).
  schedule(delaySeconds, fn) {
    this.pending.push({ at: this.match.time + Math.max(0, delaySeconds), fn });
  }

  // Chamado todo tick (ver Match.tick()). Passos cujo alvo já não faz
  // mais sentido (jogador saiu, morreu etc.) são responsabilidade da
  // própria `fn` verificar — o agendador só garante QUANDO chamar, não
  // SE ainda faz sentido chamar.
  update() {
    if (!this.pending.length) return;
    const now = this.match.time;
    const ready = [];
    const rest = [];
    for (const p of this.pending) (p.at <= now ? ready : rest).push(p);
    if (!ready.length) return;
    this.pending = rest;
    for (const p of ready) {
      try { p.fn(); } catch (err) { console.error('[eventchain] passo falhou:', err); }
    }
  }

  get count() { return this.pending.length; }
}
