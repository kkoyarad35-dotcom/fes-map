import { assignPrefectures } from './pref';
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
 * イベントは収集スクリプトが書き出した静的JSONから読む。
 * ブラウザから直接APIを叩かないので、CORSもAPIキーの露出も起きない。
 */
export async function loadBundle(): Promise<EventBundle> {
  const url = `${import.meta.env.BASE_URL}data/events.json`;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bundle = (await res.json()) as EventBundle;
    const events = sanitize(bundle.events ?? []);
    // 地図を引いたときの集計に使う都道府県は、ここで一度だけ割り当てる
    assignPrefectures(events);
    return { ...EMPTY_BUNDLE, ...bundle, events };
  } catch (err) {
    console.error('[fes-map] events.json の読み込みに失敗しました', err);
    return EMPTY_BUNDLE;
  }
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
