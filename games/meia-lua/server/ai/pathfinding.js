// A* na grade de tiles (8 direções, sem cortar cantos).
import { MAP_W, MAP_H, TILE, tileAt, doorAtTile } from '../../shared/map.js';

class MinHeap {
  constructor() { this.a = []; }
  push(n, f) {
    const a = this.a; a.push([f, n]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top[1];
  }
  get size() { return this.a.length; }
}

const N = MAP_W * MAP_H;
const gScore = new Float32Array(N);
const came = new Int32Array(N);
const stamp = new Uint32Array(N);
let curStamp = 0;

/**
 * @param doorCost (doorId) => number | Infinity — custo extra para atravessar a porta (Infinity = bloqueada)
 * @returns array de {x,y} (centros dos tiles) ou null
 */
export function findPath(sx, sy, gx, gy, doorCost, maxNodes = 4000) {
  sx = Math.floor(sx); sy = Math.floor(sy); gx = Math.floor(gx); gy = Math.floor(gy);
  if (tileAt(gx, gy) !== TILE.FLOOR) return null;
  if (sx === gx && sy === gy) return [{ x: gx + 0.5, y: gy + 0.5 }];
  curStamp++;
  const start = sy * MAP_W + sx, goal = gy * MAP_W + gx;
  const open = new MinHeap();
  stamp[start] = curStamp; gScore[start] = 0; came[start] = -1;
  open.push(start, 0);
  let expanded = 0;
  const walk = (x, y) => {
    if (tileAt(x, y) !== TILE.FLOOR) return Infinity;
    const d = doorAtTile(x, y);
    return d ? doorCost(d.id) : 0;
  };
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) break;
    if (++expanded > maxNodes) return null;
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        const extra = walk(nx, ny);
        if (extra === Infinity) continue;
        if (dx && dy) {
          // sem cortar cantos e sem diagonais através de portas
          if (walk(cx + dx, cy) !== 0 || walk(cx, cy + dy) !== 0 || extra !== 0) continue;
        }
        const ni = ny * MAP_W + nx;
        const g = gScore[cur] + (dx && dy ? 1.414 : 1) + extra;
        if (stamp[ni] !== curStamp || g < gScore[ni]) {
          stamp[ni] = curStamp; gScore[ni] = g; came[ni] = cur;
          const h = Math.hypot(gx - nx, gy - ny);
          open.push(ni, g + h);
        }
      }
  }
  if (stamp[goal] !== curStamp) return null;
  const path = [];
  for (let c = goal; c !== start && c !== -1; c = came[c]) path.push({ x: (c % MAP_W) + 0.5, y: ((c / MAP_W) | 0) + 0.5 });
  path.reverse();
  return path;
}
