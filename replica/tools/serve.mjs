// Serves the production build (dist/) plus local-models/ on 127.0.0.1, with no dependencies.
// localhost is a secure context, which WebCodecs (video export) requires.
//   node tools/serve.mjs [--port 4317] [--open]
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const MODELS = join(ROOT, 'local-models');
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1]) || 4317;
const URL = `http://127.0.0.1:${PORT}/`;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.hdr': 'application/octet-stream',
};

// Resolves a URL path inside base, refusing anything that escapes it
function resolveIn(base, path){
  const p = normalize(join(base, decodeURIComponent(path)));
  return p.startsWith(base) ? p : null;
}

const server = createServer(async (req, res) => {
  const path = new globalThis.URL(req.url, URL).pathname;
  const file = path.startsWith('/local-models/')
    ? resolveIn(MODELS, path.slice('/local-models/'.length))
    : resolveIn(DIST, path === '/' ? 'index.html' : path);
  try {
    if (!file || !(await stat(file)).isFile()) throw 0;
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      // hashed build assets never change; everything else is revalidated
      'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
});

server.on('error', err => {
  // already running (e.g. a second launch): just reuse that instance
  if (err.code === 'EADDRINUSE') { if (args.includes('--open')) open(); return; }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mawaru en ${URL}`);
  if (args.includes('--open')) open();
});

// An app-like window in Chrome when available, otherwise the default browser
function open(){
  execFile('open', ['-na', 'Google Chrome', '--args', `--app=${URL}`], err => {
    if (err) execFile('open', [URL]);
  });
}
