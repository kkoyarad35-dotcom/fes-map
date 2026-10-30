/**
 * イベントの大分類。地図上の色分けとフィルタに使う。判定は src/classify.ts。
 * 「休みの日に何をするか」を決めるためのアプリなので、上のほう（グルメ〜アート）には
 * 多くの人が行きたくなる催しだけを入れ、教室・講座や小さな集まりは下に回す。
 *
 * 以前の「レジャー」（600件超）と「エンタメ」は大きすぎるうえ違いが分かりにくかったので、
 * 何をしに行くかで細かく分けた。
 */
export type EventCategory =
  | 'food' // 肉フェス・ラーメン祭り・手ぶらBBQなど、食べ物が主役の催し
  | 'park' // 動物園・水族館・遊園地・牧場・プール
  | 'nature' // 紅葉・花・イルミネーション・夜景
  | 'outdoor' // キャンプ・味覚狩り・釣り・ハイキング・温泉・クルーズ
  | 'experience' // 謎解き・脱出・お化け屋敷・チームラボ・「〇〇すぎる展」
  | 'anime' // アニメ・漫画・ゲーム・キャラクターのイベント、コラボカフェ・コラボ企画、ポップアップ
  | 'stage' // お笑い・落語・演劇・ミュージカル・サーカス・映画祭
  | 'festival' // 神社や町のお祭り・縁日・盆踊り
  | 'fireworks' // 花火大会
  | 'music' // ライブ・コンサート・音楽フェス
  | 'art' // 展覧会・美術館・写真展
  | 'market' // フリマ・蚤の市（マルシェ・朝市は入れない）
  | 'fashion' // 古着市・ファミリーセール・アパレルのポップアップなど、服やおしゃれの買い物
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
  /** 主なカテゴリ。地図のピンの色・絵文字に使う。 */
  category: EventCategory;
  /**
   * 当てはまるカテゴリ全部（先頭が category）。**events.json には入っていない**。
   * 「水族館のアニメコラボ」のように、どちらにも入るものは両方のチップに出す。
   * 読み込み時に src/classify.ts が付ける。
   */
  categories?: EventCategory[];
  /**
   * 「デート」「友達と」などのシーン別おすすめ度。**events.json には入っていない**。
   * 読み込み時に src/scenes.ts がタイトルと説明文から付ける。入っていないシーンには出さない。
   */
  scenes?: Partial<Record<import('./scenes').Scene, number>>;
  /**
   * 屋内で楽しめるか。「雨の日」「晴れの日」の絞り込みに使う。**events.json には入っていない**。
   * 読み込み時に src/classify.ts がカテゴリ・タイトル・会場名から付ける。分からなければ未設定。
   */
  indoor?: boolean;
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

export interface CategoryMeta {
  label: string;
  color: string;
  emoji: string;
  /** チップを長押ししたときに出す説明。「何が入っているか」を例で見せる。 */
  desc: string;
}

export const CATEGORY_META: Record<EventCategory, CategoryMeta> = {
  // 並び順がそのままチップの順。グルメ → レジャー系 → エンタメ系 → 祭り・花火 → …
  food: {
    label: 'グルメ',
    color: '#ef6c3a',
    emoji: '🍜',
    desc: 'フードフェス・肉フェス・ラーメン祭り・手ぶらBBQ・物産展など、食べ物が主役の催し',
  },
  park: {
    label: '動物園・遊園地',
    color: '#16a34a',
    emoji: '🎡',
    desc: '動物園・水族館・遊園地・牧場・プールなど',
  },
  nature: {
    label: '紅葉・花・夜景',
    color: '#65a30d',
    emoji: '🍁',
    desc: '紅葉・花畑・イルミネーション・ライトアップ・夜景など、景色を見に行くもの',
  },
  outdoor: {
    label: 'アウトドア',
    color: '#0d9488',
    emoji: '🏕️',
    desc: 'キャンプ・味覚狩り・釣り・ハイキング・温泉・クルーズ・SLなど、外で体を動かして遊ぶもの',
  },
  experience: {
    label: '謎解き・体験',
    color: '#db2777',
    emoji: '🧩',
    desc: '謎解き・脱出ゲーム・お化け屋敷・チームラボ・プラネタリウム・「〇〇すぎる展」のような体験型の展示',
  },
  anime: {
    label: 'アニメ・キャラ',
    color: '#f472b6',
    emoji: '🧸',
    desc: 'アニメ・漫画・ゲーム・キャラクターのイベントや展示、コラボカフェ、コラボ企画、ポップアップストアなど',
  },
  stage: {
    label: 'お笑い・舞台',
    color: '#be185d',
    emoji: '🎭',
    desc: 'お笑いライブ・落語・演劇・ミュージカル・サーカス・マジックショー・映画祭など',
  },
  festival: {
    label: '祭り',
    color: '#e11d48',
    emoji: '🏮',
    desc: '秋祭り・縁日・盆踊り・ハロウィン・パレードなど',
  },
  fireworks: {
    label: '花火',
    color: '#4f46e5',
    emoji: '🎆',
    desc: '花火大会',
  },
  music: {
    label: '音楽',
    color: '#8b5cf6',
    emoji: '🎵',
    desc: 'ライブ・コンサート・音楽フェス・ジャズ・クラシックなど',
  },
  art: {
    label: 'アート',
    color: '#0ea5e9',
    emoji: '🎨',
    desc: '美術館・博物館の展覧会、写真展、個展など',
  },
  market: {
    label: 'フリマ',
    color: '#d97706',
    emoji: '🧺',
    desc: 'フリーマーケット・蚤の市・骨董市・古着市など（大井競馬場のフリマのように、会場が競馬場やスタジアムでもここ）',
  },
  fashion: {
    label: 'ファッション',
    color: '#c026d3',
    emoji: '👗',
    desc: '古着市・ファミリーセール・アパレルやコスメのポップアップ・きもの市など、服やおしゃれの買い物',
  },
  tech: {
    label: '教室・講座',
    color: '#475569',
    emoji: '📚',
    desc: '料理教室・ヨガ教室・ワークショップ・勉強会など、習いに行くもの',
  },
  other: {
    label: 'その他',
    color: '#64748b',
    emoji: '📍',
    desc: '上のどれにも当てはまらないもの',
  },
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_META) as EventCategory[];
