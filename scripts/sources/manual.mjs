import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { geocode } from '../lib/geocode.mjs';
import { dayKeyFromOffset, guessCategory, jstDateTime, validate } from '../lib/normalize.mjs';

export const id = 'manual';
export const label = '手動登録';

const FILES = [
  // 自分で見つけた実在のイベントを書き足していくファイル
  new URL('../../data/my-events.json', import.meta.url),
  // 動作確認用のサンプル（実在しません）
  new URL('../../data/sample-events.json', import.meta.url),
];

/**
 * 手書きのJSONからイベントを読む。
 *
 * 公式サイトしか情報源が無い食フェスは、現実的にはここに書くのが一番早い。
 * lat/lon を省略すると address から国土地理院APIで自動的に緯度経度を補う。
 *
 * 1件の書き方（data/my-events.json は配列）:
 * {
 *   "title": "○○フードフェス2026",
 *   "category": "food",              // 省略するとタイトルから推定
 *   "date": "2026-09-20",            // 開始日
 *   "endDate": "2026-09-23",         // 複数日開催なら終了日
 *   "startTime": "10:00",            // 省略すると終日扱い
 *   "endTime": "20:00",
 *   "venue": "○○公園 芝生広場",
 *   "address": "東京都渋谷区代々木神園町2-1",
 *   "url": "https://example.com/",
 *   "price": "入場無料（飲食は別途）",
 *   "organizer": "○○実行委員会",
 *   "scale": 70                      // 0-100。大きいほど広域ズームでも表示される
 * }
 */
export async function collect() {
  const out = [];

  for (const file of FILES) {
    if (!existsSync(file)) continue;
    let rows;
    try {
      rows = JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      console.warn(`  manual: ${file.pathname} を読めませんでした (${err.message})`);
      continue;
    }
    if (!Array.isArray(rows)) continue;

    const isSample = file.pathname.endsWith('sample-events.json');
    for (const [i, row] of rows.entries()) {
      const item = await toEventItem(row, i, isSample);
      if (item) out.push(item);
    }
  }

  return validate(out, id);
}

async function toEventItem(row, index, isSample) {
  let lat = Number(row.lat);
  let lon = Number(row.lon);

  if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && row.address) {
    const hit = await geocode(row.address);
    if (!hit) {
      console.warn(`  manual: 座標を特定できませんでした → ${row.title}`);
      return null;
    }
    lat = hit.lat;
    lon = hit.lon;
  }

  // サンプルデータが日付切れにならないよう、dayOffset（今日からの日数）でも書ける
  const date = row.date ?? (row.dayOffset != null ? dayKeyFromOffset(row.dayOffset) : null);
  const endDate =
    row.endDate ?? (row.endDayOffset != null ? dayKeyFromOffset(row.endDayOffset) : null);

  const startAt = jstDateTime(date, row.startTime);
  if (!startAt) {
    console.warn(`  manual: date が不正です → ${row.title}`);
    return null;
  }
  // 終了時刻が無い複数日開催は、最終日いっぱいまでやっている扱いにする
  const endDateStr = endDate ?? date;
  const endAt = row.endTime
    ? jstDateTime(endDateStr, row.endTime)
    : endDate
      ? jstDateTime(endDateStr, '23:59')
      : null;

  const sourceId = isSample ? 'sample' : id;
  return {
    id: row.id ? `${sourceId}:${row.id}` : `${sourceId}:${index}-${date}-${row.title}`,
    title: row.title,
    description: row.description || undefined,
    category: row.category || guessCategory(`${row.title} ${row.description ?? ''}`),
    startAt,
    endAt: endAt ?? undefined,
    allDay: !row.startTime,
    venue: row.venue || undefined,
    address: row.address || undefined,
    lat,
    lon,
    url: row.url || undefined,
    price: row.price || undefined,
    organizer: row.organizer || undefined,
    scale: row.scale ?? 45,
    source: sourceId,
    sourceLabel: isSample ? 'サンプルデータ（実在のイベントではありません）' : label,
  };
}
