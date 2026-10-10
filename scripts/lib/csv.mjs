/**
 * 自治体が出すCSVは文字コードも列名も揃っていないので、
 * 「とりあえず読めればよい」水準の寛容なパーサを持っておく。
 */

/**
 * UTF-8 で読んで化けていたら Shift_JIS で読み直す。
 * 自治体CSVは今でも Shift_JIS がかなり多い。
 * @param {ArrayBuffer} buffer
 */
export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  // BOM 付き UTF-8 なら迷う余地がない
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // U+FFFD が混じっていたら UTF-8 ではない
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('shift_jis', { fatal: false }).decode(bytes);
  } catch {
    return utf8;
  }
}

/** RFC4180 相当。引用符の中の改行とカンマを正しく扱う。 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);

  return rows;
}

/** 列名の表記ゆれを吸収するための正規化。 */
function normalizeHeader(h) {
  return String(h)
    .replace(/^﻿/, '')
    .replace(/[\s　]/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase();
}

/**
 * 候補の列名リストを優先順に見て、最初に見つかった列の位置を返す。
 * 完全一致 → 部分一致 の順に探す。
 *
 * 部分一致は取りこぼしを減らす代わりに誤爆しやすい。推奨データセットには
 * 「掲載終了日」「所在地_全国地方公共団体コード」のような紛らわしい列があるので、
 * exclude で弾けるようにしてある。
 *
 * @param {string[]} headers
 * @param {string[]} candidates
 * @param {{exclude?: RegExp}} [options]
 */
export function pickColumn(headers, candidates, options = {}) {
  const { exclude } = options;
  const norm = headers.map(normalizeHeader);
  const allowed = (i) => !exclude || !exclude.test(headers[i] ?? '');

  for (const cand of candidates) {
    const target = normalizeHeader(cand);
    const exact = norm.findIndex((h, i) => h === target && allowed(i));
    if (exact >= 0) return exact;
  }
  for (const cand of candidates) {
    const target = normalizeHeader(cand);
    const partial = norm.findIndex((h, i) => h.includes(target) && allowed(i));
    if (partial >= 0) return partial;
  }
  return -1;
}

/** 'YYYY-MM-DD' / 'YYYY/M/D' / 'YYYY年M月D日' などを 'YYYY-MM-DD' に揃える。 */
export function parseDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const m = s.match(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
}

/**
 * 「2026年5月15日から2026年7月17日」のように、1つのセルに開催期間が
 * 書かれている自治体がある（推奨データセットに乗っていないCSVに多い）。
 * 文字列中の日付をすべて拾って [開始, 終了] を返す。終了が無ければ第2要素は null。
 */
export function parseDateRange(value) {
  const s = String(value ?? '');
  const found = [];
  const re = /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) found.push(iso);
  }
  if (found.length === 0) return [null, null];
  const sorted = [...found].sort();
  return [sorted[0], sorted.length > 1 ? sorted[sorted.length - 1] : null];
}

/** '9:30' / '09:30' / '午前9時' などから 'HH:MM' を取り出す。取れなければ null。 */
export function parseTime(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const hm = s.match(/(\d{1,2})\s*[:時]\s*(\d{1,2})?/);
  if (!hm) return null;
  const h = Number(hm[1]);
  const mi = Number(hm[2] ?? 0);
  if (!Number.isFinite(h) || h > 47 || mi > 59) return null;
  // 24時以降の表記（翌日扱い）は当日の23:59に丸めておく
  const hh = h >= 24 ? 23 : h;
  const mm = h >= 24 ? 59 : mi;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
