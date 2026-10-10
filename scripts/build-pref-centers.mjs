/**
 * 都道府県の「地図上でその県に見える位置」を求めて src/pref-centers.ts に書き出す。
 *
 * 引いた地図の数字丸をここに置く。以前は「県内イベントの重心にいちばん近いイベント」に
 * 置いていたが、イベントが県庁所在地や県境に偏っていると丸が隣の県の上に乗って見えた。
 *
 * 位置は単純な重心ではなく、**いちばん大きい島の中で、境界からいちばん遠い点**
 * （pole of inaccessibility）。重心だと湾や半島で県の外に出ることがあり、
 * 島まで含めると東京都・鹿児島県・沖縄県が海の上になる。
 *
 * 一度作れば変わらないので、結果の表はコミットしておく。作り直すときだけ実行する:
 *   node scripts/build-pref-centers.mjs
 */
import { writeFile } from 'node:fs/promises';

const SOURCE = 'https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson';
const OUT = new URL('../src/pref-centers.ts', import.meta.url);

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE}: ${res.status}`);
const geo = await res.json();

const rows = [];
for (const f of geo.features) {
  const name = f.properties.nam_ja;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const main = polys.reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
  const [lon, lat, deg] = poleOfInaccessibility(main);
  // 緯度1度 ≒ 111.32km。経度は計算の中で cos(緯度) を掛けて縮めてあるので同じ換算でよい
  rows.push({ id: f.properties.id, name, lat, lon, km: deg * 111.32 });
}
rows.sort((a, b) => a.id - b.id);

const body = rows
  .map(
    (r) =>
      `  '${r.name}': { lat: ${r.lat.toFixed(4)}, lon: ${r.lon.toFixed(4)}, km: ${r.km.toFixed(1)} },`,
  )
  .join('\n');
await writeFile(
  OUT,
  `// scripts/build-pref-centers.mjs が生成する。直接編集しないこと
import type { LatLon } from './geo';

export interface PrefCenter extends LatLon {
  /** この点から県境までのいちばん近い距離（km）。丸をこの半径に収めれば県からはみ出さない。 */
  km: number;
}

/** 地図上でその県に見える位置（いちばん大きい島の、境界からいちばん遠い点）。 */
export const PREF_CENTERS: Record<string, PrefCenter> = {
${body}
};
`,
);
console.log(`${rows.length} prefectures -> ${OUT.pathname}`);

// ---- 計算 ----

function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(s / 2);
}

/** polylabel と同じ考え方。経度は cos(緯度) で縮めて、距離を平面で測る。 */
function poleOfInaccessibility(polygon) {
  const outer = polygon[0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const rings = polygon.map((r) => r.map(([x, y]) => [x * k, y]));
  const [x0, x1] = [minX * k, maxX * k];

  const size = Math.min(x1 - x0, maxY - minY);
  let h = size / 2;
  const queue = [];
  for (let x = x0; x < x1; x += size) {
    for (let y = minY; y < maxY; y += size) queue.push(cell(x + h, y + h, h, rings));
  }
  let best = cell((x0 + x1) / 2, (minY + maxY) / 2, 0, rings);
  const precision = 0.002;

  while (queue.length) {
    queue.sort((a, b) => b.max - a.max);
    const c = queue.shift();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    h = c.h / 2;
    queue.push(cell(c.x - h, c.y - h, h, rings), cell(c.x + h, c.y - h, h, rings));
    queue.push(cell(c.x - h, c.y + h, h, rings), cell(c.x + h, c.y + h, h, rings));
  }
  return [best.x / k, best.y, best.d];
}

function cell(x, y, h, rings) {
  const d = signedDistance(x, y, rings);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}

function signedDistance(px, py, rings) {
  let inside = false;
  let min = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[j];
      if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
      min = Math.min(min, segDist2(px, py, ax, ay, bx, by));
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(min);
}

function segDist2(px, py, ax, ay, bx, by) {
  let dx = bx - ax;
  let dy = by - ay;
  let x = ax;
  let y = ay;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = bx; y = by; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}
