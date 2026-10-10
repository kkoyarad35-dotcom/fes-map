/**
 * 共有配信につけるHTTPヘッダの定義。
 *
 * Cloudflare Pages / Netlify に置く `_headers` と、手元の確認サーバー
 * (`npm run share:preview`) の両方がここを読む。
 * 「配るもの」と「手元で確かめるもの」がずれると確認の意味が無いので、
 * 定義はこのファイル1か所だけに置く。
 */

/**
 * 地図の配信元（タイル・フォント・アイコン）。CSPで外部に許すのはここだけ。
 * OpenFreeMap はすべて tiles.openfreemap.org から配る。
 */
const TILE_ORIGIN = 'https://tiles.openfreemap.org';

const SECURITY_HEADERS = [
  // 検索結果に出てしまうと「URLを知っている人だけ」が崩れるので、まずこれ
  ['X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet'],
  // イベントの公式サイトを開いたときに、共有URLを Referer で相手に渡さない
  ['Referrer-Policy', 'no-referrer'],
  ['X-Content-Type-Options', 'nosniff'],
  // 他サイトに iframe で埋め込ませない（枠だけ差し替える見せ方を防ぐ）
  ['X-Frame-Options', 'DENY'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  // 現在地は自分のページだけ。使わない機能は閉じておく
  ['Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()'],
  [
    'Content-Security-Policy',
    [
      "default-src 'none'",
      // ビルド後のJSは同一オリジンの1ファイルだけ。CDNは使っていない
      "script-src 'self'",
      // MapLibre が実行時に style 属性を書くので 'unsafe-inline' が要る
      "style-src 'self' 'unsafe-inline'",
      /*
       * イベントのサムネイルは、収集元（ウォーカープラス・こくちーずプロ等）の
       * 配信ドメインから来る。取り込み先が増えるたびにここを直すのは現実的でないので、
       * 画像だけは https 全体を許す。Referrer-Policy: no-referrer があるので、
       * 画像を取りに行くときに共有URLが相手に渡ることはない。
       */
      `img-src 'self' data: blob: https: ${TILE_ORIGIN}`,
      // MapLibre はラスタタイルを <img> ではなく fetch で取る。
      // img-src だけ許して connect-src を閉じると、地図が真っ白になる。
      `connect-src 'self' ${TILE_ORIGIN}`,
      // MapLibre のワーカーは blob: から起きる
      'worker-src blob:',
      'child-src blob:',
      "font-src 'self'",
      "manifest-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  ],
];

/**
 * パスのパターンごとのヘッダ。上から順に、当たったものを重ねていく。
 * `*` は「任意の文字列」。合言葉が1階層目に入るので、どのパターンも先頭は `/*` になる。
 */
export const SHARE_HEADER_BLOCKS = [
  { path: '/*', headers: SECURITY_HEADERS },
  {
    // ファイル名にハッシュが入っているので、変わったら別のファイルになる
    path: '/*/assets/*',
    headers: [['Cache-Control', 'public, max-age=31536000, immutable']],
  },
  {
    // イベントは毎回作り直すので、キャッシュは持たせるが必ず問い合わせさせる
    path: '/*/data/*',
    headers: [['Cache-Control', 'no-cache']],
  },
];

/**
 * Vercel の `vercel.json` に起こす。
 *
 * **Vercel は `_headers` を読まない**（あれは Cloudflare Pages / Netlify の形式）。
 * これを置かずにデプロイすると、検索避けも Referer 遮断も CSP も全部無効になる。
 *
 * `trailingSlash: true` は必須。ビルドは相対パス（`base: './'`）で出しているので、
 * `/<合言葉>` のままだと `./assets/…` が `/assets/…` に解決されて404になる。
 */
export function vercelConfigText() {
  return `${JSON.stringify(
    {
      $schema: 'https://openapi.vercel.sh/vercel.json',
      trailingSlash: true,
      headers: SHARE_HEADER_BLOCKS.map((block) => ({
        source: toVercelSource(block.path),
        headers: block.headers.map(([key, value]) => ({ key, value })),
      })),
    },
    null,
    2,
  )}\n`;
}

// グロブを Vercel の path-to-regexp に直す。
// 末尾のワイルドカードは「以下すべて」= (.*)、途中のワイルドカードは1階層ぶん = :p0 になる。
function toVercelSource(pattern) {
  const parts = pattern.split('*');
  let named = 0;
  let out = '';
  parts.forEach((part, i) => {
    out += part;
    if (i === parts.length - 1) return;
    // 末尾の * は「以下すべて」、途中の * は「1階層ぶん」
    out += i === parts.length - 2 ? '(.*)' : `:p${named++}`;
  });
  return out;
}

/** Cloudflare Pages / Netlify の `_headers` 形式に起こす。 */
export function headersFileText() {
  const lines = [
    '# npm run share が生成する。直接編集せず scripts/lib/share-headers.mjs を直すこと',
  ];
  for (const block of SHARE_HEADER_BLOCKS) {
    lines.push('', block.path);
    for (const [name, value] of block.headers) lines.push(`  ${name}: ${value}`);
  }
  return `${lines.join('\n')}\n`;
}

/** そのパスに当たるヘッダを、上のブロック順に重ねて返す（確認サーバー用）。 */
export function headersFor(urlPath) {
  const out = new Map();
  for (const block of SHARE_HEADER_BLOCKS) {
    if (!matches(block.path, urlPath)) continue;
    for (const [name, value] of block.headers) out.set(name, value);
  }
  return [...out];
}

function matches(pattern, urlPath) {
  const re = new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );
  return re.test(urlPath);
}
