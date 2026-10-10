import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const CACHE_PATH = new URL('../../data/.geocode-cache.json', import.meta.url);
const ENDPOINT = 'https://msearch.gsi.go.jp/address-search/AddressSearch';

let cache = null;
let lastCallAt = 0;
/**
 * 国土地理院APIへの最短間隔。公共APIなので余裕を持たせる。
 * キャッシュに当たったときは待たないので、2回目以降の実行は速い。
 */
const MIN_INTERVAL_MS = 350;

async function loadCache() {
  if (cache) return cache;
  if (existsSync(CACHE_PATH)) {
    try {
      cache = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
      return cache;
    } catch {
      // 壊れていたら作り直す
    }
  }
  cache = {};
  return cache;
}

export async function saveGeocodeCache() {
  if (!cache) return;
  await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

/**
 * 住所から緯度経度を引く（国土地理院 住所検索API）。
 * 無料・キー不要だが公共APIなので、キャッシュして呼び出し回数を抑える。
 *
 * @param {string} address
 * @returns {Promise<{lat:number, lon:number} | null>}
 */
export async function geocode(address) {
  const key = address.trim();
  if (!key) return null;

  const c = await loadCache();
  if (key in c) return c[key];

  // 実際にネットワークに出るときだけ間隔を空ける
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();

  try {
    const res = await fetch(`${ENDPOINT}?q=${encodeURIComponent(key)}`, {
      headers: { 'User-Agent': 'fes-map/0.1 (personal event map)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const first = Array.isArray(json) ? json[0] : null;
    const coords = first?.geometry?.coordinates;
    // GeoJSON なので [経度, 緯度] の順で入っている
    const result =
      Array.isArray(coords) && coords.length >= 2
        ? { lat: Number(coords[1]), lon: Number(coords[0]) }
        : null;
    c[key] = result;
    return result;
  } catch (err) {
    console.warn(`  ジオコーディング失敗: ${key} (${err.message})`);
    c[key] = null;
    return null;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
