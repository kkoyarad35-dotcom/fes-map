import { sleep } from '../lib/geocode.mjs';
import { scaleFromAttendance, toJstIso, validate } from '../lib/normalize.mjs';

export const id = 'connpass';
export const label = 'connpass';
export const url = 'https://connpass.com/about/api/v2/';

const ENDPOINT = 'https://connpass.com/api/v2/events/';
/** 公式が1秒に1リクエストまでを求めているので、必ず間隔を空ける。 */
const REQUEST_INTERVAL_MS = 1100;

/**
 * connpass のイベントを日付ごとに取得する。
 *
 * APIキーは https://help.connpass.com/api/ から利用申請して取得し、
 * 環境変数 CONNPASS_API_KEY に入れておく（未設定なら黙ってスキップする）。
 *
 * 収録範囲はIT系の勉強会・カンファレンスなので、食フェスは含まれない。
 * 「地図・日付切り替え・詳細表示」を実データで動かすための土台として使う。
 */
export async function collect({ dayKeys }) {
  const apiKey = process.env.CONNPASS_API_KEY;
  if (!apiKey) {
    console.log('  connpass: CONNPASS_API_KEY が未設定のためスキップします');
    return [];
  }

  const events = [];
  for (const day of dayKeys) {
    const ymd = day.replaceAll('-', '');
    const params = new URLSearchParams({ ymd, count: '100', order: '1' });
    try {
      const res = await fetch(`${ENDPOINT}?${params}`, {
        headers: {
          'X-API-Key': apiKey,
          // v2 は User-Agent が無いと弾かれることがある
          'User-Agent': 'fes-map/0.1 (https://github.com/; personal event map)',
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        console.warn(`  connpass: ${day} の取得に失敗 (HTTP ${res.status})`);
        await sleep(REQUEST_INTERVAL_MS);
        continue;
      }
      const json = await res.json();
      const list = json.events ?? json.results ?? [];
      for (const e of list) events.push(toEventItem(e));
    } catch (err) {
      console.warn(`  connpass: ${day} の取得に失敗 (${err.message})`);
    }
    await sleep(REQUEST_INTERVAL_MS);
  }

  return validate(events.filter(Boolean), id);
}

function toEventItem(e) {
  // オンライン開催は座標が無いので、地図アプリの性質上ここで落とす
  const lat = Number(e.lat);
  const lon = Number(e.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const capacity = e.accepted ?? e.limit ?? 0;
  return {
    id: `connpass:${e.id ?? e.event_id}`,
    title: e.title ?? '',
    description: e.catch || e.description?.replace(/<[^>]*>/g, '').slice(0, 400) || undefined,
    category: 'tech',
    startAt: toJstIso(e.started_at ?? e.start_at),
    endAt: toJstIso(e.ended_at ?? e.end_at) ?? undefined,
    venue: e.place || undefined,
    address: e.address || undefined,
    lat,
    lon,
    url: e.event_url || e.url || undefined,
    organizer: e.owner_display_name || e.series?.title || undefined,
    scale: scaleFromAttendance(capacity),
    source: id,
    sourceLabel: label,
  };
}
