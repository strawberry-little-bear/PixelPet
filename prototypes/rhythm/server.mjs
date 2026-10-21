// Opt-in, loopback-only lab. No SQLite, game APIs, saves, or resource code.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSession, command } from './protocol.mjs';
const number = (name, fallback, max) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`Invalid ${name}`);
  return value;
};
const port = number('PIXELPET_RHYTHM_PORT', 0, 65535);
const up = number('PIXELPET_RHYTHM_UP_MS', 0, 2000), down = number('PIXELPET_RHYTHM_DOWN_MS', 0, 2000);
const jitter = number('PIXELPET_RHYTHM_JITTER_MS', 0, 1000);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const files = new Map(await Promise.all([
  ['/', 'index.html', 'text/html; charset=utf-8'], ['/client.mjs', 'client.mjs', 'text/javascript; charset=utf-8'], ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
].map(async ([url, path, type]) => [url, { body: await readFile(new URL(`./public/${path}`, import.meta.url)), type }])));
const sessions = new Map(); let requestCount = 0;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  try {
    if (req.method === 'GET' && files.has(req.url)) {
      const file = files.get(req.url); res.writeHead(200, { 'Content-Type': file.type }); res.end(file.body); return;
    }
    if (req.method !== 'POST' || req.url !== '/lab/command') { send(404, { error: 'Prototype only. No game API.' }); return; }
    if (req.headers.origin !== `http://127.0.0.1:${server.address().port}` || !req.headers['content-type']?.startsWith('application/json')) {
      send(403, { error: 'Same-origin JSON only.' }); return;
    }
    let text = '';
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 4096) { send(413, { error: 'Body too large.' }); return; } }
    let input; try { input = JSON.parse(text); } catch { send(400, { error: 'Invalid JSON.' }); return; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) { send(400, { error: 'Invalid command.' }); return; }
    const index = requestCount++;
    // Deterministic alternating jitter, explicitly a synthetic test condition.
    await wait(up + (index % 2 ? jitter : 0));
    const now = Date.now();
    for (const [id, value] of sessions) if (now - value.touched > 10 * 60000) sessions.delete(id);
    let state, lastRequest = 0, lease;
    if (input.kind === 'create') {
      if (sessions.size >= 32) { send(429, { error: 'Lab session limit. Restart the lab server.' }); return; }
      state = createSession(randomUUID());
      lease = randomUUID();
    } else {
      const stored = sessions.get(input.id);
      if (!stored) { send(410, { code: 'session_expired', error: '原型会话已失效；可明确新建暂停练习，不恢复旧拍。' }); return; }
      if (input.kind === 'recover') {
        // Recover only pauses: never retry an answer/resume/restart. A new
        // page gets a fresh lease so even a high-numbered old request cannot
        // act after recovery. Already accepted observations remain untouched.
        state = command(stored.state, { kind: 'pause' }, now);
        lease = randomUUID();
      } else {
        if (input.lease !== stored.lease) {
          send(409, { code: 'lease_replaced', error: '本页已被另一页面的核对取代，请手动核对暂停。' }); return;
        }
        // A later pause dominates an earlier in-flight resume/answer within
        // this lease, including alternating synthetic upstream jitter.
        if (!Number.isSafeInteger(input.requestId) || input.requestId <= stored.lastRequest) {
          send(409, { error: '旧请求已被后续操作取代。' }); return;
        }
        lastRequest = input.requestId; lease = stored.lease;
        try { state = command(stored.state, input, now); }
        catch (error) { send(409, { error: error.message }); return; }
      }
    }
    sessions.set(state.id, { state, touched: now, lastRequest, lease });
    const reply = { state, lease, serverTime: Date.now(), simulation: { up, down, jitter } };
    await wait(down + (index % 2 ? 0 : jitter));
    send(200, reply);
  } catch { if (!res.headersSent) send(500, { error: '原型连接中断，请手动重新核对。' }); else res.end(); }
});
server.requestTimeout = 10000;
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, prototype: fileURLToPath(import.meta.url), up, down, jitter })));
