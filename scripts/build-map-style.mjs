/**
 * 下地の地図スタイルを取ってきて、日本語向けに直して src/map-style.json に書き出す。
 *
 * 元は OpenFreeMap の「Liberty」。OpenStreetMap のベクトルタイルで、
 * Googleマップ／タイムズカーシェアの地図のような色付き（緑の公園・黄色い幹線道路・青い水面）。
 * APIキー不要・無料・利用登録なし。出典表示（OpenFreeMap / OpenMapTiles / OSM）だけが条件。
 *
 * 元のスタイルのまま使わない理由:
 * - 地名が「Tokyo 東京」のようにローマ字＋現地語の2段になる → `name:ja` 優先の1段にする
 * - 都道府県名（label_state）を消す。引いた地図ではこちらの数字丸が県名を出しているので、
 *   OSM の県ラベルが別の位置に出ると「丸と県の位置がずれている」ように見える
 *
 * スタイルはビルドに同梱する（実行時に取りに行かない）。1往復減るのと、
 * 元が変わっても勝手に見た目が変わらないため。作り直すときだけ実行する:
 *   node scripts/build-map-style.mjs
 */
import { writeFile } from 'node:fs/promises';

const SOURCE = 'https://tiles.openfreemap.org/styles/liberty';
const OUT = new URL('../src/map-style.json', import.meta.url);

/** 日本語名 → 無ければ元の名前。 */
const JA_NAME = ['coalesce', ['get', 'name:ja'], ['get', 'name']];
const DROP_LAYERS = new Set(['label_state']);

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE}: ${res.status}`);
const style = await res.json();

style.layers = style.layers.filter((layer) => !DROP_LAYERS.has(layer.id));
for (const layer of style.layers) {
  const field = layer.layout?.['text-field'];
  // 道路番号（ref）はそのまま。名前を出しているものだけ置き換える
  if (field && JSON.stringify(field).includes('"name')) layer.layout['text-field'] = JA_NAME;
}

await writeFile(OUT, `${JSON.stringify(style)}\n`);
console.log(`${style.layers.length} layers -> ${OUT.pathname}`);
