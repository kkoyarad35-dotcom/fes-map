#!/usr/bin/env node
/**
 * 各データソースからイベントを集めて public/data/events.json に書き出す。
 *
 *   npm run collect
 *
 * ブラウザからAPIを直接叩かずここで一度JSONに固めることで、
 * CORS の制約とAPIキーの露出をまとめて回避している。
 * 定期更新したい場合は、このスクリプトを1日1回動かせばよい。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { saveGeocodeCache } from './lib/geocode.mjs';
import { dayKeyRange } from './lib/normalize.mjs';

import * as manual from './sources/manual.mjs';
import * as opendata from './sources/opendata.mjs';
import * as walkerplus from './sources/walkerplus.mjs';
import * as kokuchpro from './sources/kokuchpro.mjs';
import * as connpass from './sources/connpass.mjs';

/** アプリ側の HORIZON_DAYS（src/main.ts）と揃えておく。 */
const HORIZON_DAYS = 31;

/**
 * 収集元。ここに追加するだけで新しいソースを組み込める。
 * 各モジュールは { id, label, url?, collect({ dayKeys }) } を公開する。
 */
const SOURCES = [manual, opendata, walkerplus, kokuchpro, connpass];

const OUT = new URL('../public/data/events.json', import.meta.url);

async function main() {
  const dayKeys = dayKeyRange(HORIZON_DAYS);
  const rangeStart = dayKeys[0];
  const rangeEnd = dayKeys[dayKeys.length - 1];

  console.log(`収集期間: ${rangeStart} 〜 ${rangeEnd} (${HORIZON_DAYS}日)`);

  const all = [];
  const summary = [];

  for (const source of SOURCES) {
    console.log(`\n[${source.id}] 収集中…`);
    let events = [];
    try {
      events = await source.collect({ dayKeys, rangeStart, rangeEnd });
    } catch (err) {
      console.error(`  ${source.id}: 収集に失敗しました (${err.message})`);
    }
    console.log(`  ${events.length}件`);
    all.push(...events);
  }

  const deduped = dedupe(all);

  // ソース別の件数は、重複排除の後の数で数える（クレジット表示に使う）
  for (const source of SOURCES) {
    const count = deduped.filter((e) => e.source === source.id).length;
    summary.push({ id: source.id, label: source.label, count, url: source.url });
  }
  const sampleCount = deduped.filter((e) => e.source === 'sample').length;
  if (sampleCount > 0) {
    summary.push({ id: 'sample', label: 'サンプルデータ（実在しません）', count: sampleCount });
  }

  const bundle = {
    generatedAt: new Date().toISOString(),
    rangeStart,
    rangeEnd,
    sources: summary.filter((s) => s.count > 0),
    events: deduped.sort((a, b) => a.startAt.localeCompare(b.startAt)).map(compact),
  };

  await mkdir(new URL('.', OUT), { recursive: true });
  // 整形せずに書く。人が読むファイルではないし、インデントだけで数百KB増える
  await writeFile(OUT, JSON.stringify(bundle), 'utf8');
  await saveGeocodeCache();

  console.log(`\n合計 ${bundle.events.length}件 を書き出しました → public/data/events.json`);
  for (const s of bundle.sources) console.log(`  ${s.label}: ${s.count}件`);
}

/**
 * 同じイベントが複数のソースから来ることがある。
 * ID の完全一致に加えて「同じ日・同じタイトル・500m以内」も同一とみなす。
 */
function dedupe(events) {
  const byId = new Map();
  const fuzzy = new Set();
  const out = [];

  for (const ev of events) {
    if (byId.has(ev.id)) continue;
    byId.set(ev.id, ev);

    const key = `${ev.startAt.slice(0, 10)}|${normalizeTitle(ev.title)}|${ev.lat.toFixed(2)},${ev.lon.toFixed(2)}`;
    if (fuzzy.has(key)) continue;
    fuzzy.add(key);
    out.push(ev);
  }
  const removed = events.length - out.length;
  if (removed > 0) console.log(`\n重複 ${removed}件 を除外しました`);
  return out;
}

/**
 * events.json はスマホが起動のたびに丸ごと読むので、削れるものは削る。
 * 説明文を丸ごと持つと数MBになるが、詳しくは公式サイトを見てもらえばよい。
 */
function compact(ev) {
  const out = {};
  for (const [key, value] of Object.entries(ev)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    out[key] = value;
  }
  // 緯度経度は小数5桁（約1m）あれば十分
  out.lat = Math.round(ev.lat * 1e5) / 1e5;
  out.lon = Math.round(ev.lon * 1e5) / 1e5;
  if (out.description) {
    const text = String(out.description).replace(/\s+/g, ' ').trim();
    out.description = text.length > 180 ? `${text.slice(0, 180)}…` : text;
  }
  return out;
}

function normalizeTitle(title) {
  return String(title)
    .replace(/[\s　]+/g, '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
