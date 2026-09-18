// Perfil de cada área do mapa — o elo entre o mapa (shared/map.js) e TUDO
// que precisa "saber" onde o jogador está pra se comportar diferente:
// o áudio ambiente do cliente (ver AREA_AMBIENCE + updateAudio() em
// game.js — antes TODAS as salas indoor tocavam o mesmo loop 'hum' só,
// literalmente o problema descrito no pedido "não use o mesmo loop em
// todas as salas"), e a seleção de eventos do servidor (ver AREA_EVENT_BIAS
// + runRandomEvent() em Match.js — cozinha favorece sons/objetos se
// movendo, sala elétrica favorece falhas de luz, etc).
//
// Compartilhado (client+server) de propósito: um perfil só, sem duplicar
// a mesma decisão em dois arquivos que podem sair de sincronia.

// tags de categoria (mesmas de TensionDirector.js: ambient/falso/presenca/real)
// que ficam MAIS prováveis nessa área — não exclui as outras, só empurra o
// sorteio (ver eventWeightForArea em Match.js).
export const AREA_PROFILE = {
  deposito: { ambience: [['hum', 0.16]], bias: { ambient: 1.3 }, vibe: 'empoeirado, prateleiras', },
  seguranca: { ambience: [['radio', 0.28], ['hum', 0.08]], bias: { presenca: 1.2 }, vibe: 'monitores, rádio' },
  escritorio: { ambience: [['hum', 0.16]], bias: {}, vibe: 'papelada, silêncio' },
  corredor_oeste: { ambience: [['hum', 0.1]], bias: { falso: 1.3, ambient: 1.15 }, vibe: 'corredor longo' },
  porao: { ambience: [['drip', 0.22], ['hum', 0.06]], bias: { presenca: 1.35, ambient: 1.15 }, vibe: 'úmido, tubulações' },
  corredor_norte: { ambience: [['hum', 0.1]], bias: { falso: 1.3, ambient: 1.15 }, vibe: 'corredor' },
  palco: { ambience: [['hum', 0.08]], bias: { real: 1.4, presenca: 1.2 }, vibe: 'cortinas, holofotes apagados' },
  salao: { ambience: [['hum', 0.18]], bias: { falso: 1.2 }, vibe: 'mesas vazias' },
  corredor_leste: { ambience: [['hum', 0.1]], bias: { falso: 1.3, ambient: 1.15 }, vibe: 'corredor' },
  sala_secreta: { ambience: [['radio', 0.15], ['drip', 0.08]], bias: { presenca: 1.5 }, vibe: 'errado, fora de lugar' },
  banheiros: { ambience: [['drip', 0.3]], bias: { ambient: 1.2 }, vibe: 'azulejo, água pingando' },
  cozinha: { ambience: [['kitchen', 0.3], ['hum', 0.08]], bias: { ambient: 1.2, falso: 1.15 }, vibe: 'metal, refrigeração' },
  exterior: { ambience: [], bias: { ambient: 1.1 }, vibe: 'ao ar livre' }, // wind/rain já tratados à parte em updateAudio()

  // ---- Ala de Serviço ----
  sala_maquinas: { ambience: [['engine', 0.4]], bias: { presenca: 1.25, ambient: 1.1 }, vibe: 'motores, calor' },
  corredor_servico: { ambience: [['hum', 0.12]], bias: { falso: 1.2 }, vibe: 'corredor de serviço' },
  manutencao: { ambience: [['hum', 0.16], ['drip', 0.06]], bias: { ambient: 1.25 }, vibe: 'ferramentas, poeira' },
  sala_eletrica: { ambience: [['buzz', 0.32]], bias: { falso: 1.4, ambient: 1.2 }, vibe: 'zumbido elétrico, faíscas' },
  estoque: { ambience: [['hum', 0.16]], bias: { ambient: 1.2 }, vibe: 'caixas empilhadas' },
  area_funcionarios: { ambience: [['hum', 0.18]], bias: {}, vibe: 'mesas, armários' },
  sala_controle: { ambience: [['radio', 0.24]], bias: { presenca: 1.3 }, vibe: 'sem câmera cobrindo — isolada' },
};

// Nomes de loop que o perfil de área pode ligar — usado em game.js pra
// zerar todos os outros antes de aplicar o perfil da área atual (é isso
// que produz o crossfade: setLoop já usa setTargetAtTime com rampa, então
// zerar o loop antigo e subir o novo no mesmo frame já cruza suavemente
// em vez de cortar seco — ver updateAudio() em game.js e o pedido de
// "transições entre áreas" com crossfade/atenuação, não corte brusco).
export const AREA_AMBIENCE_LOOPS = ['hum', 'drip', 'engine', 'buzz', 'radio', 'kitchen'];

export function areaProfile(areaId) {
  return AREA_PROFILE[areaId] || null;
}
