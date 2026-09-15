// Definições de itens — compartilhado entre servidor (autoridade) e cliente (exibição).
// type: equip | consumable | quest
// persistent: salvo na conta ao final da partida (itens de missão existem só na partida)

export const EQUIP_SLOTS = ['lanterna', 'corpo', 'pes', 'acessorio'];
export const SLOT_NAMES = { lanterna: 'Lanterna', corpo: 'Corpo', pes: 'Pés', acessorio: 'Acessório' };

export const ITEMS = {
  // ---------- Equipamentos ----------
  lanterna_velha: { name: 'Lanterna Velha', type: 'equip', slot: 'lanterna', price: 0, icon: '🔦',
    desc: 'Pisca às vezes. Alcance curto.', light: 4.5 },
  lanterna_tatica: { name: 'Lanterna Tática', type: 'equip', slot: 'lanterna', price: 260, icon: '🔦',
    desc: 'Feixe forte e longo. Atrai mariposas...', light: 7 },
  jaqueta_couro: { name: 'Jaqueta de Couro', type: 'equip', slot: 'corpo', price: 180, icon: '🧥',
    desc: '+1 Resistência, reduz 10% do dano.', bonus: { resistencia: 1 }, armor: 0.10 },
  colete_seguranca: { name: 'Colete de Segurança', type: 'equip', slot: 'corpo', price: 520, icon: '🦺',
    desc: '+2 Resistência, reduz 22% do dano.', bonus: { resistencia: 2 }, armor: 0.22 },
  tenis_gasto: { name: 'Tênis Gasto', type: 'equip', slot: 'pes', price: 120, icon: '👟',
    desc: '+1 Velocidade.', bonus: { velocidade: 1 } },
  tenis_corrida: { name: 'Tênis de Corrida', type: 'equip', slot: 'pes', price: 420, icon: '👟',
    desc: '+2 Velocidade, passos mais silenciosos.', bonus: { velocidade: 2 }, quiet: 0.3 },
  amuleto_sino: { name: 'Amuleto de Sino', type: 'equip', slot: 'acessorio', price: 220, icon: '🔔',
    desc: '+2 Coragem.', bonus: { coragem: 2 } },
  lupa_antiga: { name: 'Lupa Antiga', type: 'equip', slot: 'acessorio', price: 220, icon: '🔍',
    desc: '+2 Investigação.', bonus: { investigacao: 2 } },
  kit_ferramentas: { name: 'Kit de Ferramentas', type: 'equip', slot: 'acessorio', price: 260, icon: '🧰',
    desc: '+2 Técnica.', bonus: { tecnica: 2 } },
  tablet_portatil: { name: 'Tablet Portátil', type: 'equip', slot: 'acessorio', price: 650, icon: '📱',
    desc: 'Acessa as câmeras de qualquer lugar.', tablet: true },

  // ---------- Consumíveis ----------
  bandagem: { name: 'Bandagem', type: 'consumable', price: 40, icon: '🩹', desc: 'Recupera 35 de HP.' },
  bateria: { name: 'Bateria', type: 'consumable', price: 30, icon: '🔋', desc: 'Recarrega a lanterna.' },
  refrigerante: { name: 'Refrigerante Choque', type: 'consumable', price: 25, icon: '🥤', desc: 'Stamina cheia e +20% velocidade por 8s.' },
  chocolate: { name: 'Chocolate', type: 'consumable', price: 20, icon: '🍫', desc: 'Reduz 45 de medo.' },
  sinalizador: { name: 'Sinalizador', type: 'consumable', price: 90, icon: '🧨', desc: 'Atordoa animatrônicos próximos por 5s.' },
  radio_isca: { name: 'Rádio Isca', type: 'consumable', price: 70, icon: '📻', desc: 'Deixa um rádio chiando no chão por 12s. Atrai animatrônicos para longe de você.' },

  // ---------- Itens de missão (somente na partida) ----------
  chave_deposito: { name: 'Chave do Depósito', type: 'quest', icon: '🗝️', desc: 'Abre o depósito.' },
  fusivel: { name: 'Fusível', type: 'quest', icon: '🔌', desc: 'Um fusível cerâmico antigo.' },
  gravador: { name: 'Gravador de Fita', type: 'quest', icon: '📼', desc: 'Há uma fita dentro. Etiqueta: "NÃO TOCAR".' },
  chave_porao: { name: 'Chave do Porão', type: 'quest', icon: '🗝️', desc: 'Pesada e enferrujada.' },
  cartao_funcionario: { name: 'Crachá de Funcionário', type: 'quest', icon: '🪪', desc: 'Nomes riscados. Parte de uma chave magnética.' },
  chave_secreta: { name: 'Chave Magnética', type: 'quest', icon: '💳', desc: 'Abre a sala secreta.' },
  nucleo_memoria: { name: 'Núcleo de Memória', type: 'quest', icon: '💠', desc: 'Pulsa com uma luz azulada. Parece... vivo.' },
};

export const SHOP_ITEMS = Object.entries(ITEMS)
  .filter(([, it]) => it.price > 0)
  .map(([id]) => id);

export function isPersistent(itemId) {
  const it = ITEMS[itemId];
  return !!it && it.type !== 'quest';
}
