#!/usr/bin/env node
/**
 * ビルド結果の dist/data/events.json を暗号化して events.bin に置き換える。
 *
 *   $env:SITE_PASSWORD = "..."; npm run seal
 *
 * GitHub Pages はサーバー側で認証を掛けられないので、データそのものを
 * パスワードで暗号化して置き、ブラウザ（src/sealed.ts）で復号する。
 * URL に合言葉を入れる方式と違い、URL が履歴・転送・Referer で漏れても中身は読めない。
 *
 * 形式（src/sealed.ts と揃えること）:
 *   "FES1"(4) | PBKDF2反復回数 uint32BE(4) | salt(16) | iv(12) | AES-256-GCM(gzip(JSON))
 */
import { gzipSync } from 'node:zlib';
import { webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';

const SRC = new URL('../dist/data/events.json', import.meta.url);
const OUT = new URL('../dist/data/events.bin', import.meta.url);

const MAGIC = 'FES1';
const ITERATIONS = 600_000;
/**
 * salt は固定にしている。デプロイのたびに変わると、端末に覚えさせた鍵が
 * 毎日使えなくなり、毎朝パスワードを入れ直すことになるため。
 * このアプリ専用の値なので、他サイト向けの事前計算表は流用できない。
 */
const SALT = new TextEncoder().encode('chikafes:sealed:v1').slice(0, 16);

async function main() {
  const password = process.env.SITE_PASSWORD ?? '';
  if (password.length < 8) {
    throw new Error('SITE_PASSWORD に8文字以上のパスワードを入れてください');
  }
  if (!existsSync(SRC)) {
    throw new Error('dist/data/events.json が見つかりません。先に npm run collect と npm run build を実行してください');
  }

  const { subtle } = webcrypto;
  const baseKey = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations: ITERATIONS },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  // 暗号文は圧縮が効かず、配信時の gzip も無意味になるので、暗号化の前に縮めておく
  const plain = gzipSync(await readFile(SRC), { level: 9 });
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));

  const head = new Uint8Array(4 + 4 + SALT.length + iv.length);
  head.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(head.buffer).setUint32(4, ITERATIONS);
  head.set(SALT, 8);
  head.set(iv, 8 + SALT.length);

  await writeFile(OUT, Buffer.concat([head, cipher]));
  // 平文を残すと暗号化した意味が無い
  await rm(SRC);

  console.log(`dist/data/events.bin に暗号化しました（${Math.round((head.length + cipher.length) / 1024)}KB）`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
