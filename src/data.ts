import { reclassify } from './classify';
import { assignPrefectures } from './pref';
import { askPassword, forgetKey, openSealed, parseSealed, recallKey } from './sealed';
import type { EventBundle, EventItem } from './types';

/**
 * 読み込みが終わるまでの空の中身。
 * 地図をJSONの到着より先に出すために、起動時はこれで組み立てる。
 */
export const EMPTY_BUNDLE: EventBundle = {
  generatedAt: new Date().toISOString(),
  rangeStart: '',
  rangeEnd: '',
  sources: [],
  events: [],
};

/**
 * イベントは収集スクリプトが書き出した静的JSONから読む（公開版は暗号化してある）。
 * ブラウザから直接APIを叩かないので、CORSもAPIキーの露出も起きない。
 */
export async function loadBundle(): Promise<EventBundle> {
  try {
    const bundle = ((await loadSealed()) ?? (await loadPlain())) as EventBundle;
    const events = sanitize(bundle.events ?? []);
    reclassify(events);
    // 地図を引いたときの集計に使う都道府県は、ここで一度だけ割り当てる
    assignPrefectures(events);
    return { ...EMPTY_BUNDLE, ...bundle, events };
  } catch (err) {
    console.error('[fes-map] イベントの読み込みに失敗しました', err);
    return EMPTY_BUNDLE;
  }
}

/**
 * 公開版は暗号化した events.bin だけを置いている（scripts/seal-events.mjs）。
 * 無ければ null を返し、開発中の平文 events.json に回す。
 */
async function loadSealed(): Promise<unknown | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/events.bin`, { cache: 'no-cache' });
  if (!res.ok) return null;
  const sealed = parseSealed(await res.arrayBuffer());
  // 開発サーバーは無いファイルにも index.html を返すので、形式で見分ける
  if (!sealed) return null;

  const saved = await recallKey();
  if (saved) {
    try {
      return await openSealed(sealed, saved);
    } catch {
      // パスワードが変わった。覚えていた鍵は捨てて聞き直す
      forgetKey();
    }
  }
  return askPassword(sealed);
}

async function loadPlain(): Promise<unknown> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/events.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 座標が壊れている行が1件混ざるだけで地図が飛ぶので、入口で弾いておく。 */
function sanitize(events: EventItem[]): EventItem[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (!e || typeof e.lat !== 'number' || typeof e.lon !== 'number') return false;
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) return false;
    if (e.lat < 20 || e.lat > 46 || e.lon < 122 || e.lon > 154) return false; // 日本の範囲外
    if (!e.startAt || !e.title) return false;
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}
