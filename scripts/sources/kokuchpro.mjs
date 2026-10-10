import { cachedFetch, isHostBlocked } from '../lib/httpcache.mjs';
import { validate } from '../lib/normalize.mjs';

export const id = 'kokuchpro';
export const label = 'こくちーずプロ';
export const url = 'https://www.kokuchpro.com/';

/**
 * こくちーずプロのイベント一覧から schema.org/Event の JSON-LD を読む。
 *
 * ウォーカープラスが載せない「個人・団体が主催する小さな催し」を拾えるのが狙い。
 * しかも JSON-LD に **緯度経度と開始時刻がそのまま入っている** ので、
 * ジオコーディングが要らず、時刻も「終日」ではなく実際の時間を出せる。
 *
 * 取得の作法（2026-09-04 時点の robots.txt を確認済み）:
 * - Disallow は /api/ /entry/ /mypage/ など。一覧の /s/ は対象外
 * - `*` に Crawl-delay の指定は無いが、他のbot向けに2〜30秒を指定しているので
 *   こちらも2秒以上空ける
 * - 一度読んだページは data/.cache/ に置き、再実行では取りに行かない
 *
 * robots.txt は利用規約とは別物。個人が非商用で使う前提のソース。
 */
const ORIGIN = 'https://www.kokuchpro.com';
const CRAWL_DELAY_MS = 2200;
const UA = 'fes-map/0.1 (personal, non-commercial event map; respects robots.txt)';

/** 1日・1ジャンルあたり読むページ数の上限。1ページ約40件。 */
const MAX_PAGES = Number(process.env.KP_PAGES ?? 3);

/**
 * 読むジャンル。ビジネス系（人脈／交流会、営業、経営など）は
 * 「その日その場所でやっているイベント」として地図に出す価値が薄いので外す。
 */
const GENRES = [
  { code: 'g-28', label: '料理／グルメ', category: 'food' },
  { code: 'g-23', label: '音楽／舞台', category: 'music' },
  { code: 'g-24', label: '文化芸能／芸術', category: 'art' },
  { code: 'g-3', label: 'デザイン／アート', category: 'art' },
  { code: 'g-22', label: '展示会／シンポジウム', category: 'art' },
  { code: 'g-25', label: 'スポーツ／格闘技', category: 'sports' },
  { code: 'g-18', label: '趣味／ライフスタイル', category: 'other' },
  { code: 'g-15', label: '社会／コミュニティ', category: 'other' },
  { code: 'g-30', label: '育児／キッズ', category: 'other' },
];

/**
 * ジャンルを絞っても紛れ込む、名刺交換目的の集まり。
 * 地図で「近くでやっているイベント」を探す用途には合わない。
 */
const NOT_AN_EVENT =
  /交流会|カフェ会|名刺交換|ビジネスマッチング|副業|起業|セミナー説明会|婚活|お見合い|参加者募集中/;

async function getHtml(path) {
  const res = await cachedFetch(`${ORIGIN}${path}`, {
    minIntervalMs: CRAWL_DELAY_MS,
    userAgent: UA,
    ttlMs: 12 * 60 * 60 * 1000,
  });
  if (!res.ok || !res.buffer) return null;
  return new TextDecoder('utf-8').decode(res.buffer);
}

function jsonLdEvents(html) {
  const out = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      if (node && node['@type'] === 'Event' && node.name) out.push(node);
    }
  }
  return out;
}

export async function collect({ dayKeys }) {
  const found = new Map();

  for (const day of dayKeys) {
    if (isHostBlocked(ORIGIN)) {
      console.warn('  アクセスを止められたため、残りの日付は見送ります');
      break;
    }
    const ymd = day.replaceAll('-', '');

    for (const genre of GENRES) {
      if (isHostBlocked(ORIGIN)) break;
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        // オフライン開催（et-0）に限る。オンラインは地図に出しても意味がない
        const base = `/s/et-0/${genre.code}/date-${ymd}/`;
        const html = await getHtml(page === 1 ? base : `${base}${page}/`);
        if (!html) break;

        const events = jsonLdEvents(html);
        if (events.length === 0) break;

        for (const node of events) {
          // 日付指定は前後の日のイベントも返してくるので、IDで重ねるだけにして
          // 期間の判定は下の toEventItem 側でまとめて行う
          if (!found.has(node.url)) found.set(node.url, { node, genre });
        }
        if (events.length < 20) break; // 最終ページ
      }
    }
    console.log(`  ${day} まで  累計 ${found.size}件`);
  }

  const rangeStart = dayKeys[0];
  const rangeEnd = dayKeys[dayKeys.length - 1];
  const items = [];

  for (const { node, genre } of found.values()) {
    const item = toEventItem(node, genre, rangeStart, rangeEnd);
    if (item) items.push(item);
  }

  console.log(`  期間内・座標あり: ${items.length}件`);
  return validate(items, id);
}

function toEventItem(node, genre, rangeStart, rangeEnd) {
  const title = String(node.name).trim();
  if (!title || NOT_AN_EVENT.test(title)) return null;

  const start = String(node.startDate ?? '');
  const end = String(node.endDate ?? '');
  const startDay = start.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay)) return null;
  const endDay = /^\d{4}-\d{2}-\d{2}$/.test(end.slice(0, 10)) ? end.slice(0, 10) : startDay;
  if (endDay < rangeStart || startDay > rangeEnd) return null;

  // 座標が入っているので、ジオコーディングせずにそのまま置ける
  const geo = node.location?.geo ?? {};
  const lat = Number(geo.latitude);
  const lon = Number(geo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  // 住所欄に都道府県が二重に入っている行がある（「大阪府大阪府大阪市…」）
  const address = String(node.location?.address ?? '')
    .replace(/^(.{2,4}?[都道府県])\1/, '$1')
    .trim();

  return {
    id: `kokuchpro:${hash(String(node.url ?? title))}`,
    title,
    description: node.description ? String(node.description).slice(0, 300) : undefined,
    category: genre.category,
    startAt: toIso(start),
    endAt: end ? toIso(end) : undefined,
    allDay: false,
    venue: node.location?.name ? String(node.location.name) : undefined,
    address: address || undefined,
    lat,
    lon,
    url: typeof node.url === 'string' ? node.url : undefined,
    imageUrl: typeof node.image === 'string' ? node.image : undefined,
    organizer: node.organizer ? String(node.organizer) : undefined,
    // 個人・小規模主催が中心なので、地図では寄ったときに出る位置づけにする
    scale: 22,
    source: id,
    sourceLabel: `${label}（${genre.label}）`,
  };
}

/** '2026-09-05T14:00:00+0900' 形式をそのまま Date に食わせられる形へ。 */
function toIso(value) {
  const d = new Date(String(value).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
