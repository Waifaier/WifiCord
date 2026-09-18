// Script de validação estrutural do mapa — NÃO é parte do jogo, é só uma
// checagem que dá pra rodar de verdade (node server/game/__mapValidate.mjs)
// sem precisar abrir navegador nenhum. Confere: bounds, toda porta grudada
// nas áreas que ela diz cobrir, e alcançabilidade real (BFS pelo grid,
// tratando toda porta como aberta) de cada área a partir de um spawn.
import {
  MAP_W, MAP_H, TILE, grid, areaGrid, AREAS, DOORS, PROPS, OBJECTS, SPAWN_POINTS,
} from '../../shared/map.js';

let ok = true;
function fail(msg) { ok = false; console.error('FALHOU:', msg); }
function pass(msg) { console.log('ok:', msg); }

// 1) bounds
if (grid.length !== MAP_W * MAP_H) fail(`grid.length ${grid.length} != ${MAP_W * MAP_H}`);
else pass(`grid dimensionado certo (${MAP_W}x${MAP_H} = ${grid.length} tiles)`);

for (const a of AREAS) {
  if (a.x1 < 0 || a.y1 < 0 || a.x2 >= MAP_W || a.y2 >= MAP_H || a.x1 > a.x2 || a.y1 > a.y2) {
    fail(`área ${a.id} com bounds inválidos: (${a.x1},${a.y1})-(${a.x2},${a.y2})`);
  }
}
pass('todas as áreas dentro dos limites do mapa');

// 2) toda porta precisa ter pelo menos 1 área vizinha detectada, e se
// disser 'areas: [...]' essas áreas precisam realmente encostar na porta.
for (const d of DOORS) {
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => areaGrid[(d.y + dy) * MAP_W + (d.x + dx)])
    .filter((v) => v >= 0)
    .map((i) => AREAS[i].id);
  if (!neighbors.length) fail(`porta ${d.id} (${d.x},${d.y}) sem nenhuma área vizinha`);
  const claimed = new Set(d.areas || []);
  const found = new Set(neighbors);
  for (const c of claimed) if (!found.has(c)) fail(`porta ${d.id} diz cobrir '${c}' mas não está encostada nela`);
}
pass('todas as portas encostadas em pelo menos uma área, e áreas declaradas batem com a vizinhança real');

// 3) nenhum PROPS/OBJECTS fora dos limites
for (const p of PROPS) if (p.x < 0 || p.y < 0 || p.x >= MAP_W || p.y >= MAP_H) fail(`prop fora do mapa em (${p.x},${p.y})`);
for (const o of OBJECTS) if (o.x < 0 || o.y < 0 || o.x >= MAP_W || o.y >= MAP_H) fail(`objeto ${o.id} fora do mapa em (${o.x},${o.y})`);
pass('props e objetos dentro dos limites');

// 4) nenhum objeto interativo caiu em cima de um tile SOLID (senão fica
// inalcançável) — exceto os próprios 'hide', que são solid por design.
for (const o of OBJECTS) {
  if (o.type === 'hide') continue;
  const t = grid[o.y * MAP_W + o.x];
  if (t === TILE.SOLID) fail(`objeto ${o.id} (${o.x},${o.y}) caiu em cima de um tile SOLID (prop bloqueando) — inalcançável`);
}
pass('nenhum objeto interativo (não-hide) caiu em cima de um tile sólido');

// 5) alcançabilidade — BFS a partir de um spawn, tratando toda porta como
// aberta (é o caso mais permissivo possível; portas 'power'/travadas só
// reduzem alcançabilidade em tempo de jogo, não estruturalmente).
const start = SPAWN_POINTS[0];
const sx = Math.floor(start.x), sy = Math.floor(start.y);
const visited = new Uint8Array(MAP_W * MAP_H);
const stack = [[sx, sy]];
visited[sy * MAP_W + sx] = 1;
while (stack.length) {
  const [x, y] = stack.pop();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
    const idx = ny * MAP_W + nx;
    if (visited[idx]) continue;
    if (grid[idx] !== TILE.FLOOR) continue; // trata toda porta como aberta (grid já é FLOOR onde tem porta)
    visited[idx] = 1;
    stack.push([nx, ny]);
  }
}
for (const a of AREAS) {
  let reached = false;
  for (let y = a.y1; y <= a.y2 && !reached; y++)
    for (let x = a.x1; x <= a.x2 && !reached; x++)
      if (areaGrid[y * MAP_W + x] === AREAS.indexOf(a) && visited[y * MAP_W + x]) reached = true;
  if (!reached) fail(`área '${a.id}' NÃO é alcançável a partir do spawn (mesmo com todas as portas abertas)`);
}
pass('todas as áreas são alcançáveis a partir do spawn (com portas abertas)');

console.log(ok ? '\n✅ mapa estruturalmente OK' : '\n❌ mapa com problemas — ver acima');
process.exit(ok ? 0 : 1);
