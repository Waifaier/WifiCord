// Tabela de saque dos contêineres (sorteio no servidor).
const TABLE = [
  { item: null, w: 22 },               // só dinheiro
  { item: 'bandagem', w: 14 },
  { item: 'bateria', w: 16 },
  { item: 'refrigerante', w: 11 },
  { item: 'chocolate', w: 12 },
  { item: 'sinalizador', w: 4 },
  { item: 'radio_isca', w: 6 },
  { item: 'empty', w: 26 },
];
const TOTAL = TABLE.reduce((s, e) => s + e.w, 0);

export function rollLoot(night) {
  let r = Math.random() * TOTAL;
  let entry = TABLE[0];
  for (const e of TABLE) { if ((r -= e.w) <= 0) { entry = e; break; } }
  if (entry.item === 'empty') return { items: [], money: Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 5) : 0 };
  const money = 4 + Math.floor(Math.random() * (10 + night * 4));
  return { items: entry.item ? [entry.item] : [], money };
}
