import {
  decodeText,
  parseCsv,
  parseDate,
  parseDateRange,
  parseTime,
  pickColumn,
} from '../lib/csv.mjs';
import { geocode } from '../lib/geocode.mjs';
import { blockedHostList, cachedFetch, cachedJson } from '../lib/httpcache.mjs';
import { guessCategory, jstDateTime, validate } from '../lib/normalize.mjs';

export const id = 'opendata';
export const label = '自治体オープンデータ';
export const url = 'https://www.data.go.jp/';

/**
 * 自治体のオープンデータカタログ（CKAN）から「イベント一覧」CSVを集める。
 *
 * 国の推奨データセットに「イベント一覧」が含まれているおかげで、多くの自治体が
 * ほぼ同じ列構成のCSVを出している。とはいえ完全には揃っていないので、
 * 列名は pickColumn で表記ゆれを吸収しながら拾う。
 *
 * 無料・申請不要・商用利用可（各自治体のライセンスは概ね CC BY）。
 * ただし相手は自治体のウェブサーバーなので、lib/httpcache.mjs 経由で
 * ホストごとに間隔を空け、一度落としたCSVはキャッシュから読む。
 */
const CATALOGS = [
  { id: 'tokyo', label: '東京都オープンデータカタログ', base: 'https://catalog.data.metro.tokyo.lg.jp' },
  { id: 'bodik', label: 'BODIK ODCS', base: 'https://data.bodik.jp' },
  { id: 'yokohama', label: '横浜市オープンデータ', base: 'https://data.city.yokohama.lg.jp' },
  { id: 'jig', label: 'オープンデータプラットフォーム', base: 'https://ckan.odp.jig.jp' },
];

/** カタログ1つあたり何件のデータセットを見に行くか。 */
const DATASETS_PER_CATALOG = 60;
/**
 * 1データセットから読むCSVの本数。
 * 年度別のCSVが何十本もぶら下がっていることがあり、全部落とすと相手に迷惑なので、
 * 新しいものから数本だけにする。
 */
const RESOURCES_PER_DATASET = 2;
/** 住所しかない行をジオコーディングする上限。 */
const MAX_GEOCODE = 250;
/**
 * これより長い「イベント」は、実際には年度通期の定例行事や募集期間。
 * その日に行けるものではないので落とす。
 */
const MAX_SPAN_DAYS = 45;
/** この日数を超えたら、地図では拡大時だけ見えるところまで優先度を下げる。 */
const LONG_SPAN_DAYS = 10;

/** 開催情報ではなく「お知らせ」の類。地図に出しても仕方がないので除く。 */
const NOT_AN_EVENT =
  /受講生募集|参加者募集|委員募集|会員募集|職員募集|寄付|ふるさと納税|アンケート|パブリックコメント|意見募集|入札|公売|相談日|休館|臨時休/;

/**
 * 列名の候補。推奨データセット準拠のCSVを先頭に置きつつ、
 * それに乗っていない自治体（港区の「ところ」「ページタイトル」など）も拾えるようにしている。
 */
const COLUMNS = {
  title: ['イベント名', 'イベント名称', 'ページタイトル', '名称', '行事名', 'タイトル', '件名'],
  startDate: ['開始日', '開催開始日', 'イベント開始日', '開催日時', '開催日', '実施日', '日付'],
  endDate: ['終了日', '開催終了日', 'イベント終了日'],
  startTime: ['開始時間', '開始時刻'],
  endTime: ['終了時間', '終了時刻'],
  description: ['説明', '概要', 'イベント内容', '内容'],
  eventType: ['イベント種類', '分類', 'タグ', 'キーワード'],
  venue: ['場所名称', '会場名1', '会場', '開催場所', 'ところ', '施設名', '場所'],
  address: ['所在地_連結表記', '住所1', '住所', '所在地', '会場住所'],
  lat: ['緯度情報1', '緯度'],
  lon: ['経度情報1', '経度'],
  url: ['コンテンツURL', 'ページURL', 'URL', '関連URL', '参考URL', 'ホームページ'],
  price: ['料金(詳細)', '料金(基本)', '料金', '費用', '参加費', '入場料'],
  organizer: ['主催者', '主催', '連絡先名称', '問い合わせ先1', '担当課'],
};

/**
 * 部分一致で誤爆しやすい列を弾く。
 * 「掲載開始日」は記事の掲載期間、「所在地_全国地方公共団体コード」は数字コード、
 * 「申込URL」は申込フォームで公式サイトではない。
 */
const EXCLUDE = {
  startDate: /掲載|申込|受付|募集/,
  endDate: /掲載|申込|受付|募集/,
  startTime: /掲載|申込|受付/,
  endTime: /掲載|申込|受付/,
  address: /コード|ID|番号|都道府県$|市区町村$/,
  url: /申込|画像|Web開催/,
  organizer: /電話|番号|内線/,
  venue: /コード|ID|集合/,
};

export async function collect({ rangeStart, rangeEnd }) {
  const resources = [];

  for (const catalog of CATALOGS) {
    try {
      const found = await searchEventCsvs(catalog);
      console.log(`  ${catalog.label}: CSV ${found.length}本`);
      resources.push(...found);
    } catch (err) {
      console.warn(`  ${catalog.label}: 検索に失敗 (${err.message})`);
    }
  }

  const rows = [];
  let cached = 0;
  for (const resource of resources) {
    const { events, fromCache } = await readCsvResource(resource, rangeStart, rangeEnd);
    if (fromCache) cached += 1;
    rows.push(...events);
  }

  console.log(`  CSV ${resources.length}本を読み込み（うちキャッシュ ${cached}本）`);
  console.log(`  期間内のイベント: ${rows.length}件（座標の補完前）`);

  const blocked = blockedHostList();
  if (blocked.length > 0) {
    console.warn(`  アクセスを見送ったホスト: ${blocked.join(', ')}`);
  }

  const located = await attachCoordinates(rows);
  return validate(located, id);
}

/** CKAN の package_search で「イベント」を含むデータセットのCSVを列挙する。 */
async function searchEventCsvs(catalog) {
  const params = new URLSearchParams({ q: 'イベント', rows: String(DATASETS_PER_CATALOG) });
  const json = await cachedJson(`${catalog.base}/api/3/action/package_search?${params}`, {
    ttlMs: 6 * 60 * 60 * 1000,
  });
  if (!json) throw new Error('レスポンスを取得できませんでした');

  const out = [];
  for (const pkg of json.result?.results ?? []) {
    // 「イベント一覧」など、催し物の一覧らしいものだけに絞る
    if (!/イベント|催し|行事|祭|フェス/.test(pkg.title ?? '')) continue;
    const org = pkg.organization?.title ?? catalog.label;

    const csvs = (pkg.resources ?? [])
      .filter((r) => {
        const fmt = String(r.format ?? '').toUpperCase();
        return (fmt.includes('CSV') || /\.csv(\?|$)/i.test(r.url ?? '')) && r.url;
      })
      // 年度別ファイルが並ぶので、新しいものを優先する
      .sort((a, b) => String(b.last_modified ?? b.created ?? '').localeCompare(String(a.last_modified ?? a.created ?? '')))
      .slice(0, RESOURCES_PER_DATASET);

    for (const r of csvs) out.push({ url: r.url, org, catalog: catalog.label, dataset: pkg.title });
  }

  const seen = new Set();
  return out.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
}

async function readCsvResource(resource, rangeStart, rangeEnd) {
  const res = await cachedFetch(resource.url);
  if (!res.ok || !res.buffer) return { events: [], fromCache: res.fromCache };

  const rows = parseCsv(decodeText(res.buffer));
  if (rows.length < 2) return { events: [], fromCache: res.fromCache };

  const headers = rows[0];
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, cands]) => [
      key,
      pickColumn(headers, cands, { exclude: EXCLUDE[key] }),
    ]),
  );
  // イベント名と開始日が取れないCSVは、そもそもイベント一覧ではない
  if (col.title < 0 || col.startDate < 0) return { events: [], fromCache: res.fromCache };

  const get = (row, key) => (col[key] >= 0 ? String(row[col[key]] ?? '').trim() : '');
  const out = [];

  for (const [index, row] of rows.slice(1).entries()) {
    const title = get(row, 'title');
    // 「2026年5月15日から2026年7月17日」のように、1つのセルに期間が入っていることがある
    const [rangeFrom, rangeTo] = parseDateRange(get(row, 'startDate'));
    const startDate = rangeFrom;
    if (!title || !startDate) continue;
    if (NOT_AN_EVENT.test(title)) continue;

    const endDate = parseDate(get(row, 'endDate')) ?? rangeTo ?? startDate;
    if (endDate < startDate) continue;

    // 期間が今日〜1ヶ月先と重なるものだけ残す
    if (endDate < rangeStart || startDate > rangeEnd) continue;

    // 年度通期の定例行事（「第3水曜日」など）は、その日のイベントとしては使えない
    const span = daysBetween(startDate, endDate);
    if (span > MAX_SPAN_DAYS) continue;

    const startTime = parseTime(get(row, 'startTime'));
    const endTime = parseTime(get(row, 'endTime'));
    const description = get(row, 'description');
    const link = get(row, 'url');

    out.push({
      id: `opendata:${hash(`${resource.url}|${index}|${title}|${startDate}`)}`,
      title,
      description: description ? description.slice(0, 500) : undefined,
      category: guessCategory(`${title} ${get(row, 'eventType')} ${description}`),
      startAt: jstDateTime(startDate, startTime),
      endAt: endTime
        ? jstDateTime(endDate, endTime)
        : endDate !== startDate
          ? jstDateTime(endDate, '23:59')
          : undefined,
      allDay: !startTime,
      venue: get(row, 'venue') || undefined,
      address: get(row, 'address') || undefined,
      lat: toCoord(get(row, 'lat')),
      lon: toCoord(get(row, 'lon')),
      url: /^https?:\/\//.test(link) ? link : undefined,
      price: get(row, 'price') || undefined,
      organizer: get(row, 'organizer') || resource.org || undefined,
      scale: scaleFor(title, span),
      source: id,
      sourceLabel: `${resource.org}（${resource.catalog}）`,
    });
  }

  return { events: out, fromCache: res.fromCache };
}

/** CSVに緯度経度が無い行は、住所（無ければ会場名）から補う。 */
async function attachCoordinates(rows) {
  const out = [];
  let budget = MAX_GEOCODE;
  let noQuery = 0;

  for (const row of rows) {
    if (Number.isFinite(row.lat) && Number.isFinite(row.lon)) {
      out.push(row);
      continue;
    }
    const query = row.address || row.venue;
    if (!query) {
      noQuery += 1;
      continue;
    }
    if (budget <= 0) continue;

    const hit = await geocode(query);
    budget -= 1;
    if (hit) out.push({ ...row, lat: hit.lat, lon: hit.lon });
  }

  const dropped = rows.length - out.length;
  if (dropped > 0) {
    console.log(`  座標を特定できなかった ${dropped}件 を除外しました（うち手がかり無し ${noQuery}件）`);
  }
  return out;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function toCoord(value) {
  const n = Number(String(value).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : NaN;
}

/**
 * 自治体のイベントは基本的に小規模なので低めに置き、
 * 祭り・花火など広域から人が来るものだけ少し持ち上げる。
 * 長期開催のものは、地図を引いたときに居座らないよう下げる。
 */
function scaleFor(title, span) {
  let base = 18;
  if (/花火/.test(title)) base = 72;
  else if (/祭り|まつり|フェスティバル|フェス|フェア/.test(title)) base = 48;
  else if (/マラソン|コンサート|ライブ|大会/.test(title)) base = 32;
  else if (/展|市$|マルシェ/.test(title)) base = 24;

  return span > LONG_SPAN_DAYS ? Math.min(base, 12) : base;
}

/** 安定したIDを作るための短いハッシュ。 */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
