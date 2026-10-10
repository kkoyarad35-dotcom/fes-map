import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CACHE_DIR = new URL('../../data/.cache/', import.meta.url);
const UA = 'fes-map/0.1 (personal event map)';

/** 同じホストへの最短リクエスト間隔。相手は自治体のサーバーなので余裕を持たせる。 */
const HOST_INTERVAL_MS = 700;
/** 既定のキャッシュ有効期間。自治体CSVが日に何度も変わることはない。 */
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

const lastRequestAt = new Map();
/** 403/429 を返したホストは、その実行中はもう叩かない。 */
const blockedHosts = new Set();

/**
 * 接続自体ができない（タイムアウト・DNS失敗など）が続いたら、そのホストは諦める。
 * 海外のサーバー（GitHub Actions）からだと国内サイトに繋がらないことがあり、
 * 1件ごとに接続タイムアウト（約10秒）を待つと、それだけで数十分を空費する。
 */
const MAX_NETWORK_FAILURES = 3;
const networkFailures = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function keyFor(url) {
  return createHash('sha1').update(url).digest('hex').slice(0, 20);
}

/** ホストごとに順番待ちさせて、同時に叩かないようにする。 */
async function waitForHost(host, minIntervalMs) {
  const prev = lastRequestAt.get(host) ?? 0;
  const wait = prev + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

export function isHostBlocked(url) {
  try {
    return blockedHosts.has(new URL(url).host);
  } catch {
    return false;
  }
}

export function blockedHostList() {
  return [...blockedHosts];
}

/**
 * ディスクキャッシュ付きの fetch。
 *
 * 一度落としたCSVは data/.cache/ に置いて、次の実行では再取得しない。
 * 収集スクリプトを何度も回しても相手のサーバーに負荷をかけないための仕組みで、
 * これが無いと数百本のCSVを毎回落とすことになる（実際に一度 403 を食らった）。
 *
 * @returns {Promise<{ok:boolean, status:number, buffer:ArrayBuffer|null, fromCache:boolean}>}
 */
export async function cachedFetch(
  url,
  {
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = 30000,
    // robots.txt が Crawl-delay を指定しているサイトでは、それに合わせて延ばす
    minIntervalMs = HOST_INTERVAL_MS,
    userAgent = UA,
  } = {},
) {
  await mkdir(CACHE_DIR, { recursive: true });

  const key = keyFor(url);
  const dataPath = new URL(`${key}.bin`, CACHE_DIR);
  const metaPath = new URL(`${key}.json`, CACHE_DIR);

  if (existsSync(metaPath) && existsSync(dataPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      if (Date.now() - meta.fetchedAt < ttlMs) {
        const buf = await readFile(dataPath);
        return {
          ok: meta.status >= 200 && meta.status < 300,
          status: meta.status,
          buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          fromCache: true,
        };
      }
    } catch {
      // キャッシュが壊れていたら取り直す
    }
  }

  let host;
  try {
    host = new URL(url).host;
  } catch {
    return { ok: false, status: 0, buffer: null, fromCache: false };
  }
  if (blockedHosts.has(host)) return { ok: false, status: 429, buffer: null, fromCache: false };

  await waitForHost(host, minIntervalMs);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent, Accept: '*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 403 || res.status === 429 || res.status === 503) {
      // 叩きすぎのサインなので、このホストへの以降のアクセスはやめる
      blockedHosts.add(host);
      console.warn(`  ${host}: HTTP ${res.status} のため、この実行では以降アクセスしません`);
      return { ok: false, status: res.status, buffer: null, fromCache: false };
    }

    networkFailures.delete(host);
    const buffer = await res.arrayBuffer();
    if (res.ok) {
      await writeFile(dataPath, Buffer.from(buffer));
      await writeFile(
        metaPath,
        JSON.stringify({ url, status: res.status, fetchedAt: Date.now() }),
        'utf8',
      );
    }
    return { ok: res.ok, status: res.status, buffer, fromCache: false };
  } catch (err) {
    // 黙って握りつぶすと「0件」としか見えず原因が追えないので、理由を出す
    const reason = err?.cause?.code ?? err?.name ?? 'unknown';
    const count = (networkFailures.get(host) ?? 0) + 1;
    networkFailures.set(host, count);
    console.warn(`  ${host}: 接続できませんでした (${reason})`);
    if (count >= MAX_NETWORK_FAILURES) {
      blockedHosts.add(host);
      console.warn(`  ${host}: ${count}回続けて接続できないため、この実行では以降アクセスしません`);
    }
    return { ok: false, status: 0, buffer: null, fromCache: false };
  }
}

/** JSON API 用の薄いラッパ。 */
export async function cachedJson(url, opts) {
  const res = await cachedFetch(url, opts);
  if (!res.ok || !res.buffer) return null;
  try {
    return JSON.parse(new TextDecoder('utf-8').decode(res.buffer));
  } catch {
    return null;
  }
}
