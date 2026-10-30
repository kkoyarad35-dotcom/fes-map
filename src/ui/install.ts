/**
 * 「ホーム画面に追加」の案内。ブラウザで開いているかぎり、上にアドレスバー・下にツールバーが出て
 * どうしてもウェブページに見える。ホーム画面から開けばアイコン付きの全画面アプリになるので、それを勧める。
 *
 * - Android の Chrome など: beforeinstallprompt が来たら「追加」ボタンでそのまま入れられる
 * - iPhone の Safari: 自動では入れられないので、共有ボタンからの手順を出す
 * - すでにホーム画面から開いている／一度閉じた人には出さない
 */

const DISMISS_KEY = 'nanisuru:install-dismissed';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  // iPad の Safari は Mac を名乗るので、タッチの有無で見分ける
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // 保存できなくても、この画面で閉じられればよい
  }
}

export function setupInstallBanner(): void {
  if (isStandalone() || dismissed()) return;

  const el = document.createElement('div');
  el.className = 'install';
  el.hidden = true;

  const icon = document.createElement('img');
  icon.src = `${import.meta.env.BASE_URL}icons/icon-192.png`;
  icon.alt = '';

  const text = document.createElement('div');
  text.className = 'install__text';
  const strong = document.createElement('strong');
  strong.textContent = 'アプリとして使う';
  const note = document.createElement('span');
  text.append(strong, note);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'install__close';
  close.textContent = '✕';
  close.setAttribute('aria-label', '閉じる');
  close.addEventListener('click', () => {
    el.hidden = true;
    remember();
  });

  el.append(icon, text);
  document.getElementById('app')?.appendChild(el);

  if (isIos()) {
    note.textContent = '共有ボタン（□↑）→「ホーム画面に追加」で、全画面のアプリになります';
    el.append(close);
    window.setTimeout(() => (el.hidden = false), 2500);
    return;
  }

  // Chrome・Edge など。入れられる状態になったときだけ出す
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const prompt = e as InstallPromptEvent;
    note.textContent = 'ホーム画面に置くと、全画面ですぐ開けます';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'install__go';
    go.textContent = '追加';
    go.addEventListener('click', async () => {
      el.hidden = true;
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') remember();
    });
    el.append(go, close);
    el.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    el.hidden = true;
    remember();
  });
}
