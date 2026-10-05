#!/usr/bin/env node
// A static server for trying supersynth in a browser from this checkout:
//
//   npm run build:wasm && npm run build:ts && npm run example:browser   -> http://localhost:8080
//
// It serves the page (this folder, or `root`) and this checkout as an application would see the
// installed packages (`/node_modules/supersynth/…`, `/node_modules/@supersynth/organ-<id>/…`),
// with the two headers supersynth needs in a browser: its engine runs on several threads over
// shared memory, which a page may only use when it is cross-origin isolated.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
};

/** Serve `root` (and the packages) on `port` (0: any free one); resolves to the server. */
export function serve({ root = here, port = 8080, host = '127.0.0.1', isolate = true } = {}) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let file;
    if (url.startsWith('/node_modules/supersynth/')) file = path.join(repo, url.slice('/node_modules/supersynth/'.length));
    else if (url.startsWith('/node_modules/@supersynth/')) file = path.join(repo, 'node_modules', '@supersynth', url.slice('/node_modules/@supersynth/'.length));
    else file = path.join(root, url === '/' ? 'index.html' : url);
    if (!path.resolve(file).startsWith(repo) && !path.resolve(file).startsWith(path.resolve(root))) file = '';
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...(isolate ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {}),
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(path.join(repo, 'wasm', 'supersynth_bg.wasm'))) console.warn('The WebAssembly engine is not built: npm run build:wasm');
  if (!existsSync(path.join(repo, 'dist', 'index.js'))) console.warn('The TypeScript is not built: npm run build:ts');
  const port = Number(process.env.PORT ?? 8080);
  serve({ port }).then(() => console.log(`supersynth in a browser: http://localhost:${port}`));
}
