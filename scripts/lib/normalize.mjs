/**
 * 各データソースの出力を EventItem 形式（src/types.ts）に揃えるためのヘルパー。
 * ここを通してから公開JSONに書き出すので、UI側は出所を意識しなくてよい。
 */

const CATEGORY_RULES = [
  [/フード|グルメ|食|ラーメン|カレー|肉|寿司|餃子|ビール|ワイン|日本酒|クラフト|スイーツ|パン|コーヒー|オクトーバーフェスト/, 'food'],
  [/フェス(?!ティバル的)|ライブ|音楽|コンサート|ロック|ジャズ|DJ|フェスティバル/, 'music'],
  [/祭|花火|山車|神輿|盆踊り|灯籠|イルミネーション/, 'festival'],
  [/展|美術|アート|映画|写真|工芸|ミュージアム|個展/, 'art'],
  [/マラソン|ラン|サッカー|野球|スポーツ|大会|駅伝|サイクリング/, 'sports'],
  [/マルシェ|市$|朝市|フリーマーケット|物産|蚤の市|ハンドメイド/, 'market'],
  [/勉強会|LT|ハッカソン|もくもく|カンファレンス|ミートアップ|セミナー|ワークショップ/, 'tech'],
];

/** タイトルなどからカテゴリを推定する。確実な情報が取れるソースでは使わない。 */
export function guessCategory(text) {
  const s = String(text ?? '');
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(s)) return cat;
  }
  return 'other';
}

export function clampScale(n) {
  if (!Number.isFinite(n)) return 20;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 参加者数の規模から表示優先度スコアを作る。
 * 10人規模=10前後、1000人規模=60前後、5万人規模=90前後になるよう対数で圧縮する。
 */
export function scaleFromAttendance(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return 12;
  return clampScale(Math.log10(n) * 22 + 4);
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 日本時間での 'YYYY-MM-DD'。 */
export function todayKey() {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 今日から n 日後の 'YYYY-MM-DD'。サンプルデータを常に「今」に合わせるために使う。 */
export function dayKeyFromOffset(n) {
  return new Date(Date.parse(`${todayKey()}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 今日から days 日分の日付キー。 */
export function dayKeyRange(days) {
  return Array.from({ length: days }, (_, i) => dayKeyFromOffset(i));
}

/** ISO8601 に日本時間のオフセットを付けて返す。 */
export function toJstIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** 'YYYY-MM-DD' + 'HH:MM' から JST の ISO 文字列を作る。 */
export function jstDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const time = timeStr && /^\d{1,2}:\d{2}$/.test(timeStr) ? timeStr.padStart(5, '0') : '00:00';
  const iso = `${dateStr}T${time}:00+09:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const REQUIRED = ['id', 'title', 'startAt', 'lat', 'lon'];

/** 必須項目が欠けている行を落とす。壊れたデータで地図が崩れるのを防ぐ最後の関門。 */
export function validate(events, sourceId) {
  const ok = [];
  let dropped = 0;
  for (const ev of events) {
    const missing = REQUIRED.filter((k) => ev[k] === undefined || ev[k] === null || ev[k] === '');
    if (missing.length > 0 || !Number.isFinite(ev.lat) || !Number.isFinite(ev.lon)) {
      dropped += 1;
      continue;
    }
    ok.push({ ...ev, scale: clampScale(ev.scale ?? 20), source: ev.source ?? sourceId });
  }
  if (dropped > 0) console.warn(`  ${sourceId}: 不完全な ${dropped} 件を除外しました`);
  return ok;
}
