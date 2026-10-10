/**
 * パスワードで暗号化された events.bin を復号する（暗号化は scripts/seal-events.mjs）。
 *
 * 形式: "FES1"(4) | PBKDF2反復回数 uint32BE(4) | salt(16) | iv(12) | AES-256-GCM(gzip(JSON))
 *
 * 一度通ったら、パスワードそのものではなく導出した鍵をこの端末に覚えておく。
 * salt は固定なので、毎日のデプロイで中身が変わっても同じ鍵で開ける。
 */

const MAGIC = 'FES1';
const HEAD_LEN = 4 + 4 + 16 + 12;
const KEY_STORAGE = 'fes-map:sealed-key';

interface Sealed {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  cipher: Uint8Array<ArrayBuffer>;
}

export function parseSealed(buf: ArrayBuffer): Sealed | null {
  if (buf.byteLength <= HEAD_LEN) return null;
  const bytes = new Uint8Array(buf);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) return null;
  return {
    iterations: new DataView(buf).getUint32(4),
    salt: bytes.slice(8, 24),
    iv: bytes.slice(24, 36),
    cipher: bytes.slice(HEAD_LEN),
  };
}

export async function deriveKey(password: string, sealed: Sealed): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sealed.salt, iterations: sealed.iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    true, // 端末に覚えさせるために書き出せるようにする
    ['decrypt'],
  );
}

/** 鍵が違えば AES-GCM の検証で例外になる。 */
export async function openSealed(sealed: Sealed, key: CryptoKey): Promise<unknown> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.cipher);
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

export async function rememberKey(key: CryptoKey): Promise<void> {
  try {
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    localStorage.setItem(KEY_STORAGE, btoa(String.fromCharCode(...raw)));
  } catch {
    // 覚えられなくても、次回また入力すればよい
  }
}

export async function recallKey(): Promise<CryptoKey | null> {
  try {
    const saved = localStorage.getItem(KEY_STORAGE);
    if (!saved) return null;
    const raw = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  } catch {
    return null;
  }
}

export function forgetKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // 何もしない
  }
}

/**
 * パスワード入力画面。正しいパスワードで復号できるまで閉じない。
 * 地図の上に被せるだけなので、裏で地図の読み込みは進んでいてよい。
 */
export function askPassword(sealed: Sealed): Promise<unknown> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'lock';
    root.innerHTML = `
      <form class="lock__card" autocomplete="on">
        <div class="boot__mark" aria-hidden="true">🎪</div>
        <p class="boot__name">ちかフェス</p>
        <label class="lock__label" for="lock-pass">パスワードを入れてください</label>
        <input id="lock-pass" class="lock__input" type="password" name="password"
          autocomplete="current-password" required />
        <p class="lock__error" role="alert" hidden>パスワードが違います</p>
        <button class="lock__button" type="submit">開く</button>
      </form>`;
    document.body.append(root);

    const form = root.querySelector('form')!;
    const input = root.querySelector<HTMLInputElement>('#lock-pass')!;
    const error = root.querySelector<HTMLElement>('.lock__error')!;
    const button = root.querySelector<HTMLButtonElement>('button')!;
    input.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      button.disabled = true;
      button.textContent = '確認中…';
      try {
        const key = await deriveKey(input.value, sealed);
        const data = await openSealed(sealed, key);
        await rememberKey(key);
        root.remove();
        resolve(data);
      } catch {
        error.hidden = false;
        input.select();
      } finally {
        button.disabled = false;
        button.textContent = '開く';
      }
    });
  });
}
