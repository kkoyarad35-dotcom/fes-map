import { geocode } from '../lib/geocode.mjs';
import { cachedFetch, isHostBlocked } from '../lib/httpcache.mjs';
import { guessCategory, validate } from '../lib/normalize.mjs';

export const id = 'walkerplus';
export const label = 'ウォーカープラス';
export const url = 'https://www.walkerplus.com/event_list/';

/**
 * ウォーカープラスのイベント一覧から、埋め込まれている schema.org/Event の
 * JSON-LD を読む。HTMLの構造に依存しないので、見た目が変わっても壊れにくい。
 *
 * 取得の作法（2026-09-04 時点の https://www.walkerplus.com/robots.txt を確認済み）:
 * - `/event_list/` は Disallow に入っていない（禁止は /release* と /press* 等）
 * - robots.txt に `User-agent: ClaudeBot` / `Crawl-delay: 3` の指定があるため、
 *   3秒以上の間隔を厳守する
 * - 一度読んだページは data/.cache/ に置き、再実行では取りに行かない
 *
 * ただし robots.txt は利用規約とは別物で、規約は自動取得を制限していることがある。
 * ここでの利用は「個人が非商用で使う」前提。公開・再配布する場合は規約を確認すること。
 */
const ORIGIN = 'https://www.walkerplus.com';
/** robots.txt の Crawl-delay: 3 に合わせる。 */
const CRAWL_DELAY_MS = 3200;
const UA = 'fes-map/0.1 (personal, non-commercial event map; respects robots.txt)';

/** 都道府県ごとに読む「全ジャンル」一覧のページ数。1ページ10件。 */
const PAGES_PER_PREFECTURE = Number(process.env.WP_PAGES ?? 6);
/** 加えて読む「グルメ・フードフェス」一覧のページ数。食フェスを厚めに拾うため。 */
const FOOD_PAGES_PER_PREFECTURE = Number(process.env.WP_FOOD_PAGES ?? 3);

/**
 * 重点的に深掘りする都道府県。掲載総数に届くまでページを送る。
 * 全国を一律に深掘りすると数千リクエストになるので、必要なところだけ厚くする。
 */
const FOCUS_PAGES = {
  ar0313: Number(process.env.WP_TOKYO_PAGES ?? 130), // 東京都（サイト掲載 約1,200件）
  ar0420: Number(process.env.WP_NAGANO_PAGES ?? 40), // 長野県（同 約150件）
};
/** グルメ・フードフェスのジャンルコード。 */
const GENRE_FOOD = 'eg0117';

async function getHtml(path) {
  const res = await cachedFetch(`${ORIGIN}${path}`, {
    minIntervalMs: CRAWL_DELAY_MS,
    userAgent: UA,
    ttlMs: 12 * 60 * 60 * 1000,
  });
  if (!res.ok || !res.buffer) return null;
  return new TextDecoder('utf-8').decode(res.buffer);
}

/** ページに埋め込まれた JSON-LD から Event ノードだけを取り出す。 */
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

/**
 * 都道府県コード（ar0313 など）を、地方ページのリンクから拾う。
 * 47件をハードコードするより、サイト側の変更に強い。
 */
async function discoverPrefectures() {
  const top = await getHtml('/event_list/');
  if (!top) return [];

  const collect = (html) => [...html.matchAll(/\/event_list\/(ar\d{4})\//g)].map((m) => m[1]);

  /**
   * 地方コードは下2桁が 00（ar0300=関東 など）。都道府県は ar0313=東京都 のようになる。
   * トップページには地方だけでなく主要な都道府県も直リンクされているので、
   * 「トップに出ていたかどうか」で地方を判定すると東京・大阪・北海道を取りこぼす。
   */
  const isRegion = (code) => /00$/.test(code);

  const all = new Set(collect(top));
  for (const region of [...all].filter(isRegion)) {
    const html = await getHtml(`/event_list/${region}/`);
    if (!html) continue;
    for (const code of collect(html)) all.add(code);
  }

  return [...all].filter((code) => !isRegion(code));
}

/** 1つの一覧（都道府県 × ジャンル）をページ送りしながら読む。 */
async function crawlList(prefecture, genre, maxPages) {
  const base = genre ? `/event_list/${prefecture}/${genre}` : `/event_list/${prefecture}`;
  const events = [];

  let limit = maxPages;

  for (let page = 1; page <= limit; page += 1) {
    if (isHostBlocked(ORIGIN)) break;
    const path = page === 1 ? `${base}/` : `${base}/${page}.html`;
    const html = await getHtml(path);
    if (!html) break;

    // 1ページ目に出ている掲載総数から、実際に必要なページ数を割り出す。
    // 無駄に空ページを叩かないための調整。
    if (page === 1) {
      const total = html.match(/([\d,]+)\s*件/);
      if (total) {
        const needed = Math.ceil(Number(total[1].replace(/,/g, '')) / 10);
        limit = Math.min(maxPages, Math.max(needed, 1));
      }
    }

    const found = jsonLdEvents(html);
    if (found.length === 0) break; // これ以上ページが無い
    events.push(...found.map((e) => ({ node: e, genre })));
  }

  return events;
}

export async function collect({ rangeStart, rangeEnd }) {
  const prefectures = await discoverPrefectures();
  console.log(`  都道府県コード ${prefectures.length}件を検出`);
  if (prefectures.length === 0) return [];

  const raw = [];
  for (const [i, pref] of prefectures.entries()) {
    if (isHostBlocked(ORIGIN)) {
      console.warn('  アクセスを止められたため、残りの都道府県は見送ります');
      break;
    }
    const pages = FOCUS_PAGES[pref] ?? PAGES_PER_PREFECTURE;
    const foodPages = FOCUS_PAGES[pref]
      ? Math.max(FOOD_PAGES_PER_PREFECTURE, 20)
      : FOOD_PAGES_PER_PREFECTURE;

    raw.push(...(await crawlList(pref, null, pages)));
    if (foodPages > 0) raw.push(...(await crawlList(pref, GENRE_FOOD, foodPages)));
    if ((i + 1) % 10 === 0) {
      console.log(`  ${i + 1}/${prefectures.length}都道府県  累計 ${raw.length}件`);
    }
  }

  console.log(`  取得: ${raw.length}件（期間で絞る前）`);

  // 同じイベントが全ジャンル一覧とグルメ一覧の両方に出るので、先に重ねておく
  const byKey = new Map();
  for (const { node, genre } of raw) {
    const key = `${node.name}|${node.startDate ?? ''}`;
    const prev = byKey.get(key);
    // グルメ一覧に出ていたという情報は、カテゴリ判定で使うので残す
    if (prev) prev.isFood = prev.isFood || genre === GENRE_FOOD;
    else byKey.set(key, { node, isFood: genre === GENRE_FOOD });
  }

  const inWindow = [...byKey.values()].filter(({ node }) => {
    const start = normalizeDate(node.startDate);
    if (!start) return false;
    const end = normalizeDate(node.endDate) ?? start;
    return !(end < rangeStart || start > rangeEnd);
  });
  console.log(`  期間内: ${inWindow.length}件`);

  const located = await attachCoordinates(inWindow);
  return validate(located, id);
}

function normalizeDate(value) {
  const s = String(value ?? '').trim();
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/**
 * JSON-LD の住所は都道府県と市区町村までしか無い。
 * まず会場名を足して引き、駄目なら市区町村の代表点に落とす。
 * 後者は「だいたいこの辺」でしかないので approx を立てて、UIで断りを出す。
 */
async function attachCoordinates(items) {
  const out = [];
  let exact = 0;
  let approx = 0;

  for (const { node, isFood } of items) {
    const place = node.location ?? {};
    const region = place.address?.addressRegion ?? '';
    const locality = place.address?.addressLocality ?? '';
    const venue = place.name ?? '';
    if (!region && !locality) continue;

    let hit = null;
    let isApprox = false;

    if (venue) {
      hit = await geocode(`${region}${locality}${venue}`);
    }
    if (!hit) {
      hit = await geocode(`${region}${locality}`);
      isApprox = true;
    }
    if (!hit) continue;

    if (isApprox) approx += 1;
    else exact += 1;

    const start = normalizeDate(node.startDate);
    const end = normalizeDate(node.endDate) ?? start;
    const span = Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000,
    );

    out.push({
      id: `walkerplus:${hash(`${node.name}|${start}|${venue}`)}`,
      title: node.name,
      description: node.description ? String(node.description).slice(0, 500) : undefined,
      category: isFood ? 'food' : guessCategory(`${node.name} ${node.description ?? ''}`),
      startAt: `${start}T00:00:00+09:00`,
      endAt: end !== start ? `${end}T23:59:00+09:00` : undefined,
      allDay: true, // JSON-LD に時刻が無いので、開催時間は公式サイト側を見てもらう
      venue: venue || undefined,
      address: `${region}${locality}` || undefined,
      lat: hit.lat,
      lon: hit.lon,
      approx: isApprox,
      url: typeof node.url === 'string' && /^https?:/.test(node.url) ? node.url : undefined,
      imageUrl: typeof node.image === 'string' ? node.image : undefined,
      scale: scaleFor(node.name, span, isFood),
      source: id,
      sourceLabel: label,
    });
  }

  console.log(`  座標: 会場名まで一致 ${exact}件 / 市区町村どまり ${approx}件`);
  return out;
}

/**
 * 長期開催の展示より、数日間の祭り・フェスを地図で目立たせたい。
 * 会期が短いほど「その日そこでやっている催し」としての価値が高い。
 */
function scaleFor(title, span, isFood) {
  let base = 40;
  if (/花火/.test(title)) base = 82;
  else if (/祭|フェスティバル|フェス/.test(title)) base = 66;
  else if (isFood) base = 62;
  else if (/マラソン|ライブ|コンサート/.test(title)) base = 50;
  else if (/展$|展示|美術/.test(title)) base = 30;

  if (span > 60) return Math.min(base, 14); // 通年に近い常設展示
  if (span > 21) return Math.min(base, 26);
  return base;
}

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
