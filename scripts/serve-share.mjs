#!/usr/bin/env node
/**
 * share/ を、本番と同じヘッダを付けて手元で配るだけのサーバー。
 *
 *   npm run share:preview
 *
 * `npm run dev` はヘッダを付けないので、CSP で地図が壊れていても気づけない。
 * デプロイ前にここで一度開いて、地図とピンが出ることを確かめる用。
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFor } from './lib/share-headers.mjs';

const ROOT = fileURLToPath(new URL('../share/', import.meta.url));
const PORT = Number(process.env.SHARE_PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

/** URLのパスを share/ の中の実ファイルに落とす。外に出る指定は受け付けない。 */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.resolve(ROOT, `.${decoded}`);
  if (target !== ROOT.replace(/[\\/]$/, '') && !target.startsWith(ROOT)) return null;
  // _headers と vercel.json は配信物ではなくホスティング側の設定なので出さない
  if (['_headers', 'vercel.json'].includes(path.basename(target))) return null;
  if (!existsSync(target)) return null;
  if (statSync(target).isDirectory()) {
    const index = path.join(target, 'index.html');
    return existsSync(index) ? index : null;
  }
  return target;
}

const server = createServer((req, res) => {
  const urlPath = (req.url ?? '/').split('?')[0];
  const file = resolveFile(urlPath);
  for (const [name, value] of headersFor(urlPath)) res.setHeader(name, value);

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }

  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const dirs = existsSync(ROOT) ? (await readdir(ROOT, { withFileTypes: true })).filter((d) => d.isDirectory()) : [];
if (dirs.length === 0) {
  console.error('share/ が空です。先に npm run share を実行してください');
  process.exit(1);
}

server.listen(PORT, () => {
  console.log('本番と同じヘッダを付けて配っています。Ctrl+C で止まります。');
  for (const dir of dirs) console.log(`  http://localhost:${PORT}/${dir.name}/`);
});
