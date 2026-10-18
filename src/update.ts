/**
 * 「更新」ボタン。
 *
 * GitHub Pages は index.html を10分ほどキャッシュさせるので、デプロイしても
 * スマホではしばらく古い画面のまま、ということが起きる。ホーム画面に置いたPWAには
 * 再読み込みの手段も無い。そこで、クエリを付けた URL で開き直してキャッシュを素通りさせる。
 * イベントデータ（events.bin / events.json）は毎回 no-cache で取っているので、これで両方新しくなる。
 */

const RELOAD_PARAM = 'r';

/** いま動いている画面の JS ファイル名（ビルドごとにハッシュが変わる）。 */
function currentBuild(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script ? new URL(script.src, location.href).pathname.split('/').pop() ?? null : null;
}

/** サーバー上の最新 index.html が読む JS ファイル名。 */
async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`./index.html?${RELOAD_PARAM}=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const m = (await res.text()).match(/<script[^>]+type="module"[^>]+src="([^"]+)"/);
    return m ? m[1].split('/').pop() ?? null : null;
  } catch {
    return null;
  }
}

export function setupUpdateButton(button: HTMLButtonElement): void {
  // 開き直したときに付けたクエリは、共有やブックマークに残らないよう消しておく
  const url = new URL(location.href);
  if (url.searchParams.has(RELOAD_PARAM)) {
    url.searchParams.delete(RELOAD_PARAM);
    history.replaceState(history.state, '', url);
  }

  button.addEventListener('click', () => {
    button.classList.add('is-spinning');
    const next = new URL(location.href);
    next.searchParams.set(RELOAD_PARAM, String(Date.now()));
    location.replace(next);
  });

  // 新しい版が出ていたら、ボタンに点を付けて知らせる。開発サーバーでは比べる意味が無い
  if (import.meta.env.DEV) return;
  const check = async (): Promise<void> => {
    const now = currentBuild();
    const latest = await latestBuild();
    button.classList.toggle('has-update', !!now && !!latest && now !== latest);
  };
  void check();
  // アプリに戻ってきたとき（スマホで別アプリから切り替えたとき）にも確かめる
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}
