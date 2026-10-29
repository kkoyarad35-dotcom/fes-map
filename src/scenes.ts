import type { EventCategory, EventItem } from './types';

/**
 * 「誰と行くか」で選ぶおすすめ。カテゴリ（グルメ・音楽…）とは別の軸。
 *
 * カテゴリから機械的に決めるのではなく、タイトルと説明文の中身で判断する。
 * 1つのイベントが複数のシーンに入ってよい（花火大会はデートにも友達にも家族にも向く）。
 */
export type Scene = 'date' | 'friends' | 'family' | 'solo';

export const SCENE_META: Record<Scene, { label: string; emoji: string; color: string }> = {
  date: { label: 'デート', emoji: '💑', color: '#e11d74' },
  friends: { label: '友達と', emoji: '🙌', color: '#f59e0b' },
  family: { label: '家族・子連れ', emoji: '👨‍👩‍👧', color: '#16a34a' },
  solo: { label: 'ひとりで', emoji: '🚶', color: '#6366f1' },
};

export const ALL_SCENES = Object.keys(SCENE_META) as Scene[];

interface Rule {
  /** 当てはまるとおすすめ度が上がる語。重みつき。 */
  plus: [RegExp, number][];
  /** そのシーンには向かないもの。1つでも当たれば外す。 */
  minus?: RegExp;
}

/** どのシーンにも出さないもの。行って楽しむ催しではない。 */
const NOT_AN_OUTING =
  /説明会|相談会|相談窓口|募集|会議|審議|研修|講習|検定|試験|入札|求人|就職|採用|健診|検診|献血|議会|総会|選挙|登録|申込|受付開始/;

const RULES: Record<Scene, Rule> = {
  date: {
    plus: [
      [/イルミネーション|ライトアップ|夜景|ナイト|夜祭|ランタン|キャンドル|灯り|灯篭|灯籠/, 3],
      [/花火/, 3],
      [/水族館|プラネタリウム|チームラボ|没入|イマーシブ/, 3],
      [/美術館|美術展|アート|展覧会|企画展|特別展|写真展|映画/, 2],
      [/紅葉|もみじ|桜|梅|バラ|ローズ|コスモス|秋桜|ひまわり|花畑|庭園|ガーデン/, 2],
      [/ワイン|オクトーバーフェスト|ビール|スイーツ|チョコ|カフェ|パン|コーヒー|珈琲/, 2],
      [/クルーズ|夜市|マーケット|マルシェ/, 1],
      [/ジャズ|クラシック|コンサート|ミュージカル|演奏会|ライブ/, 2],
      [/謎解き|脱出/, 1],
      [/ハロウィン|クリスマス/, 2],
    ],
    minus: /親子|ファミリー|キッズ|kids|ベビー|baby|0歳|こども|子ども|子供|幼児|乳幼児|赤ちゃん|小学生|中学生|少年少女|シニア|高齢|介護|講座|講演|教室|セミナー|勉強会|フリーマーケット|フリマ|防災|清掃|婚活/i,
  },
  friends: {
    plus: [
      [/フェス|フェスタ|フェスティバル|祭り|まつり|祭/, 2],
      [/ビール|ビア|酒|ワイン|ハイボール|オクトーバーフェスト|呑み|飲み/, 3],
      [/肉|ラーメン|餃子|カレー|グルメ|屋台|食べ歩き|食べ比べ|B級/, 3],
      [/ライブ|音楽|ロック|DJ|野外|コンサート/, 2],
      [/謎解き|脱出|リアル.{0,4}ゲーム|ボードゲーム|お化け屋敷|ホラー/, 3],
      [/花火/, 2],
      [/お笑い|漫才|コント|サーカス/, 2],
      [/スポーツ|観戦|マラソン|ラン|サイクリング|BBQ|バーベキュー|キャンプ/, 1],
      [/コラボ|POP\s?UP|ポップアップ|アニメ|漫画|ゲーム/, 1],
      [/ナイト|夜市/, 1],
    ],
    minus: /親子|キッズ|kids|ベビー|baby|0歳|幼児|乳幼児|赤ちゃん|少年少女|シニア|高齢|介護|講座|講演|セミナー|教室/i,
  },
  family: {
    plus: [
      [/親子|ファミリー|家族|キッズ|こども|子ども|子供|ちびっこ|幼児|小学生/, 4],
      [/動物|水族館|恐竜|昆虫|いきもの|生き物|ふれあい|牧場|サファリ/, 3],
      [/体験|ワークショップ|工作|手作り|実験|サイエンス/, 2],
      [/アンパンマン|ポケモン|すみっコ|プリキュア|トーマス|ドラえもん|サンリオ|キャラクター|ヒーロー|戦隊/, 3],
      [/収穫|芋掘り|いも掘り|狩り|つかみ取り|つかみどり|釣り/, 3],
      [/遊園地|公園|プール|アスレチック|乗り物|電車|鉄道|はたらくくるま|消防/, 2],
      [/祭り|まつり|縁日|花火|運動会|ハロウィン/, 1],
      [/プラネタリウム|科学館|博物館/, 2],
    ],
    minus: /ビアガーデン|酒場|飲み放題|バー\b|BAR|大人|R18|18歳未満|婚活|街コン|ナイトクラブ|ホラー|お化け屋敷|ゾンビ|マラソン|ハーフ|トライアスロン|講演|フォーラム|ジェンダー/,
  },
  solo: {
    plus: [
      [/美術館|美術展|展覧会|企画展|特別展|写真展|個展|原画展|コレクション|名品|博物館|資料館/, 3],
      [/映画|上映|シネマ|プラネタリウム/, 3],
      [/落語|寄席|講談|朗読|クラシック|ジャズ|リサイタル|演奏会|コンサート/, 2],
      [/古本|古書|ブックフェア|本の|読書|文学|蚤の市|骨董|クラフト|ハンドメイド|手仕事/, 2],
      [/朝市|マルシェ|市場|陶器市|植木市/, 1],
      [/ヨガ|散策|ウォーク|ウォーキング|ハイキング|座禅|写経|瞑想/, 2],
      [/講座|講演|トーク|勉強会|もくもく|ミートアップ|セミナー/, 1],
      [/庭園|紅葉|寺|神社|御朱印/, 1],
    ],
    minus: /親子|ファミリー|キッズ|kids|ベビー|baby|0歳|はいはい|よちよち|こども|子ども|幼児|乳幼児|婚活|街コン|カップル|ペア|グループ|団体|チーム対抗/i,
  },
};

/**
 * カテゴリそのものがシーンに向く場合の上乗せ。classify.ts で決めたカテゴリを使う。
 * 語だけで見ていたころは、デートを選ぶとグルメが1件も出なかった
 * （フードフェスは恋人とも友達とも行くのに、「ワイン」「スイーツ」くらいしか拾えていなかった）。
 * 5 = MIN_SCORE なので、そのカテゴリなら（向かない語が無いかぎり）必ず入る。
 */
const CATEGORY_BONUS: Record<Scene, Partial<Record<EventCategory, number>>> = {
  date: { food: 5, nature: 3, fireworks: 5, experience: 3, stage: 2, character: 2, park: 2 },
  friends: { food: 5, experience: 3, fireworks: 3, festival: 2, sports: 3, outdoor: 3, stage: 2 },
  family: { park: 4, outdoor: 2, festival: 1 },
  solo: { art: 3, stage: 1 },
};

/** おすすめ度。0 ならそのシーンには出さない。 */
export function sceneScore(ev: EventItem, scene: Scene): number {
  const text = `${ev.title} ${ev.description ?? ''}`;
  if (NOT_AN_OUTING.test(ev.title)) return 0;
  const rule = RULES[scene];
  // 向かない語はタイトルだけで見る。説明文の「お子様連れもOK」などで外さないため
  if (rule.minus?.test(ev.title)) return 0;

  let score = CATEGORY_BONUS[scene][ev.category] ?? 0;
  for (const [re, w] of rule.plus) {
    // タイトルに出てくる語のほうが、そのイベントの主役である可能性が高い
    if (re.test(ev.title)) score += w * 2;
    else if (re.test(text)) score += w;
  }
  return score;
}

/**
 * タイトルにはっきりした語が1つは無いと、説明文の端に1語あるだけで入ってしまう。
 * 3だと各シーンに全体の3割が入り、おすすめにならなかった。
 */
const MIN_SCORE = 5;

/** 各イベントがどのシーンにおすすめかを、読み込み時に一度だけ求めておく。 */
export function assignScenes(events: EventItem[]): void {
  for (const ev of events) {
    const scores: Partial<Record<Scene, number>> = {};
    for (const scene of ALL_SCENES) {
      const s = sceneScore(ev, scene);
      if (s >= MIN_SCORE) scores[scene] = s;
    }
    ev.scenes = scores;
  }
}
