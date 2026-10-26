// Local development server: serves the static files and runs /api/* the same way Vercel does.
// Usage: put GEMINI_API_KEY in .env.local, then `npm run dev` → http://localhost:3000
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
if (existsSync(join(root, '.env.local'))) {
  for (const line of readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PORT = Number(process.env.PORT) || 3000;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    const route = url.pathname.match(/^\/api\/(\w+)$/);
    if (route) {
      const mod = await import(`./api/${route[1]}.js`);
      const handler = mod[req.method];
      if (!handler) { res.writeHead(405).end(); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const path = normalize(join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(data);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ERR_MODULE_NOT_FOUND') { res.writeHead(404).end('Not found'); return; }
    console.error(e);
    res.writeHead(500).end(String(e));
  }
}).listen(PORT, () => {
  console.log(`MeetMate dev server → http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) console.log('⚠ GEMINI_API_KEY가 없습니다. .env.local 파일을 확인하세요 (AI 기능 대신 규칙 기반 정리로 동작).');
});
