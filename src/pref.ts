import type { EventItem } from './types';

/**
 * 住所の先頭に出てくる都道府県名。
 * events.json の address は「東京都渋谷区…」の形で始まるので、前方一致で取れる。
 */
const PREF_NAMES = [
  '北海道',
  '青森県',
  '岩手県',
  '宮城県',
  '秋田県',
  '山形県',
  '福島県',
  '茨城県',
  '栃木県',
  '群馬県',
  '埼玉県',
  '千葉県',
  '東京都',
  '神奈川県',
  '新潟県',
  '富山県',
  '石川県',
  '福井県',
  '山梨県',
  '長野県',
  '岐阜県',
  '静岡県',
  '愛知県',
  '三重県',
  '滋賀県',
  '京都府',
  '大阪府',
  '兵庫県',
  '奈良県',
  '和歌山県',
  '鳥取県',
  '島根県',
  '岡山県',
  '広島県',
  '山口県',
  '徳島県',
  '香川県',
  '愛媛県',
  '高知県',
  '福岡県',
  '佐賀県',
  '長崎県',
  '熊本県',
  '大分県',
  '宮崎県',
  '鹿児島県',
  '沖縄県',
];

/**
 * 都道府県名は3文字（東京都・大阪府・北海道…）か4文字（神奈川県・鹿児島県…）しかない。
 * 47件を前方一致で総当たりすると4,979件で100msかかるので、先頭4文字と3文字を引くだけにする。
 */
const BY_LENGTH = [4, 3].map((len) => ({
  len,
  names: new Set(PREF_NAMES.filter((p) => p.length === len)),
}));

function prefFromAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  for (const { len, names } of BY_LENGTH) {
    const head = address.slice(0, len);
    if (names.has(head)) return head;
  }
  return undefined;
}

/** 都道府県が分からなかったときの名前。 */
const UNKNOWN = 'その他';

/**
 * 全イベントに都道府県名を割り当てる（`ev.pref`）。地図を引いたときの集計単位になる。
 *
 * events.json に都道府県のフィールドは無いので、address の先頭から取る。
 * 取れない行（address が無い / 「日本」しか入っていない。4,979件中76件）は、
 * **いちばん近い「都道府県が分かっているイベント」に合わせる**。
 * こうすると47都道府県の代表点テーブルを持たずに済み、
 * 県境をまたぐ取り違えも実データの密度に任せられる。
 *
 * 起動時に1回だけ呼ぶ。76件 × 4,903件の距離計算でも数ミリ秒で終わる。
 */
export function assignPrefectures(events: EventItem[]): void {
  const known: EventItem[] = [];
  const unknown: EventItem[] = [];

  for (const ev of events) {
    const name = prefFromAddress(ev.address);
    if (name) {
      ev.pref = name;
      known.push(ev);
    } else {
      unknown.push(ev);
    }
  }

  if (known.length === 0) {
    for (const ev of unknown) ev.pref = UNKNOWN;
    return;
  }

  for (const ev of unknown) {
    let best = known[0];
    let bestDistance = Infinity;
    for (const k of known) {
      // 近い順が分かれば十分なので、度のままの二乗距離で比べる
      const d = (k.lat - ev.lat) ** 2 + (k.lon - ev.lon) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = k;
      }
    }
    ev.pref = best.pref ?? UNKNOWN;
  }
}
