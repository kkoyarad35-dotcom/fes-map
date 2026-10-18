/**
 * イベントの大分類。地図上の色分けとフィルタに使う。判定は src/classify.ts。
 * 「休みの日に何をするか」を決めるためのアプリなので、上の6つ（グルメ〜アート）には
 * 多くの人が行きたくなる催しだけを入れ、教室・講座や小さな集まりは下に回す。
 */
export type EventCategory =
  | 'food' // 肉フェス・ラーメン祭りなど、食べ物が主役の催し
  | 'entertainment' // 体験型の展示・謎解き・キャラクターもの・舞台
  | 'festival' // 祭り・花火・伝統行事
  | 'leisure' // 動物園・遊園地・味覚狩り・紅葉・スポーツ観戦など、出かけて遊ぶもの
  | 'music' // ライブ・コンサート・音楽フェス
  | 'art' // 展覧会・美術館・写真展
  | 'market' // マルシェ・フリマ・物産展
  | 'tech' // 教室・講座・勉強会（「オカリナ教室」「ピラティス教室」もここ）
  | 'other';

/**
 * 収集元が何であれ、アプリ内ではこの形に正規化して扱う。
 * 新しいデータソースを足すときは、この型に変換するアダプタを書くだけでよい。
 */
export interface EventItem {
  /** `<source>:<元ID>` 形式。重複排除のキーになる。 */
  id: string;
  title: string;
  description?: string;
  category: EventCategory;
  /**
   * 「デート」「友達と」などのシーン別おすすめ度。**events.json には入っていない**。
   * 読み込み時に src/scenes.ts がタイトルと説明文から付ける。入っていないシーンには出さない。
   */
  scenes?: Partial<Record<import('./scenes').Scene, number>>;
  /** 開催開始。ISO8601（JSTオフセット付き）。 */
  startAt: string;
  /** 開催終了。複数日開催のフェスはここが効いてくる。省略時は startAt と同日扱い。 */
  endAt?: string;
  /** 時刻が不明で「その日やっている」ことしか分からないイベント。 */
  allDay?: boolean;
  venue?: string;
  address?: string;
  /**
   * 都道府県名。**events.json には入っていない**。
   * 起動時に address から割り当てる（`src/pref.ts`）。
   * 地図を引いたときの「都道府県ごとに◯件」の集計単位になる。
   */
  pref?: string;
  lat: number;
  lon: number;
  /**
   * 座標が市区町村の代表点どまりで、正確な会場位置ではないことを示す。
   * 距離や地図上の位置を鵜呑みにされないよう、UIで断りを出す。
   */
  approx?: boolean;
  url?: string;
  imageUrl?: string;
  /** 「無料」「前売2,000円」など、原文のまま。 */
  price?: string;
  organizer?: string;
  /**
   * 規模スコア 0-100。ズームを引いたときに表示する/しないの判断に使う。
   * 全国区の大型フェス=90前後、町内の小さな催し=10前後。
   */
  scale: number;
  /** 'connpass' / 'tokyo-opendata' / 'seed' など。出典表示にも使う。 */
  source: string;
  /** 出典の表示名（クレジット表記用）。 */
  sourceLabel?: string;
}

/** public/data/events.json の中身。 */
export interface EventBundle {
  /** 収集を実行した日時（ISO8601）。 */
  generatedAt: string;
  /** このバンドルが対象とする期間。 */
  rangeStart: string;
  rangeEnd: string;
  /** 利用した収集元と件数。UIのクレジット表示に使う。 */
  sources: { id: string; label: string; count: number; url?: string }[];
  events: EventItem[];
}

export const CATEGORY_META: Record<EventCategory, { label: string; color: string; emoji: string }> = {
  // 並び順がそのままチップの順。力を入れたい順に並べている
  food: { label: 'グルメ', color: '#ef6c3a', emoji: '🍜' },
  entertainment: { label: 'エンタメ', color: '#db2777', emoji: '🎭' },
  festival: { label: '祭り・花火', color: '#e11d48', emoji: '🎆' },
  leisure: { label: 'レジャー', color: '#16a34a', emoji: '🎡' },
  music: { label: '音楽', color: '#8b5cf6', emoji: '🎵' },
  art: { label: 'アート', color: '#0ea5e9', emoji: '🎨' },
  market: { label: 'マルシェ', color: '#d97706', emoji: '🧺' },
  tech: { label: '教室・講座', color: '#475569', emoji: '📚' },
  other: { label: 'その他', color: '#64748b', emoji: '📍' },
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_META) as EventCategory[];
