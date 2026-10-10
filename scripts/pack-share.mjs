#!/usr/bin/env node
/**
 * ビルド結果を「URLを知っている人だけが開ける」形に詰める。
 *
 *   npm run share          # ビルドして share/ に詰める（URLは前回のまま）
 *   npm run share -- --new # 合言葉を作り直す（前のURLは死ぬ）
 *
 * やっていることは2つだけ。
 *  1. アプリ本体を推測できない1階層（合言葉）の下に置く
 *  2. 検索避けと、共有URLが外に漏れないようにするヘッダを添える
 *
 * 合言葉は data/.share-token に残すので、作り直さなければ
 * 何度デプロイしてもURLは変わらない（配った人が使い続けられる）。
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { headersFileText, vercelConfigText } from './lib/share-headers.mjs';

const DIST = new URL('../dist/', import.meta.url);
const OUT = new URL('../share/', import.meta.url);
const TOKEN_FILE = new URL('../data/.share-token', import.meta.url);

/**
 * 合言葉に使う32文字。l / o / 0 / 1 は見間違えるので入れていない。
 * 26文字で約130ビットあり、総当たりで当てられる長さではない。
 */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const TOKEN_LENGTH = 26;
const TOKEN_PATTERN = /^[a-z2-9]{8,64}$/;

function newToken() {
  // 32 は 256 を割り切るので、乱数バイトをそのまま剰余しても偏らない
  return Array.from(randomBytes(TOKEN_LENGTH), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * 使う合言葉を決める。優先順は 環境変数 → 保存済み → 新規作成。
 * --new が付いていれば、保存済みを無視して作り直す。
 */
async function resolveToken({ rotate }) {
  const fromEnv = process.env.SHARE_TOKEN?.trim();
  if (fromEnv) {
    if (!TOKEN_PATTERN.test(fromEnv)) {
      throw new Error(`SHARE_TOKEN は英小文字と2〜9の8〜64文字にしてください: ${fromEnv}`);
    }
    return { token: fromEnv, created: true };
  }

  if (!rotate && existsSync(TOKEN_FILE)) {
    const saved = (await readFile(TOKEN_FILE, 'utf8')).trim();
    if (TOKEN_PATTERN.test(saved)) return { token: saved, created: false };
    console.warn('data/.share-token の中身が読めなかったので作り直します');
  }

  return { token: newToken(), created: true };
}

async function main() {
  const rotate = process.argv.includes('--new');

  if (!existsSync(new URL('index.html', DIST))) {
    throw new Error('dist/ が見つかりません。先に npm run build を実行してください');
  }

  const { token, created } = await resolveToken({ rotate });
  if (created) {
    await mkdir(new URL('../data/', TOKEN_FILE), { recursive: true });
    await writeFile(TOKEN_FILE, `${token}\n`, 'utf8');
  }

  // 前回の合言葉のフォルダが残っていると古いURLも生き続けてしまうので、毎回作り直す
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  await cp(DIST, new URL(`${token}/`, OUT), { recursive: true });
  // ヘッダの付け方はホスティングごとに違うので、同じ定義から両方書き出す
  await writeFile(new URL('_headers', OUT), headersFileText(), 'utf8');
  await writeFile(new URL('vercel.json', OUT), vercelConfigText(), 'utf8');
  // ヘッダの X-Robots-Tag と二重にしておく。robots.txt しか見ないbotもいる
  await writeFile(new URL('robots.txt', OUT), 'User-agent: *\nDisallow: /\n', 'utf8');

  console.log('share/ に詰めました。中身はこの4つです:');
  console.log(`  share/${token}/     アプリ本体（ここがURLになる）`);
  console.log('  share/_headers      Cloudflare Pages / Netlify 用のヘッダ');
  console.log('  share/vercel.json   Vercel 用のヘッダ（_headers は読まれない）');
  console.log('  share/robots.txt    検索避け（bot向けの念押し）');
  console.log('\nこの share/ ごとデプロイして、配るURLは末尾のスラッシュまで含めた形にしてください:');
  console.log(`  https://<デプロイ先のドメイン>/${token}/`);
  if (rotate) console.log('\n合言葉を作り直したので、前のURLを渡した人は開けなくなります。');
  console.log('\n手元で確認する: npm run share:preview');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
