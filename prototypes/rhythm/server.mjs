// Opt-in, loopback-only lab. No SQLite, game APIs, saves, or resource code.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createSession, command } from './protocol.mjs';
import { openStore } from './store.mjs';
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
// Keep cues, response anchors and idle expiration on the same elapsed clock.
// Host wall-clock corrections must not retime a live cue or expire a session.
const serverNow = () => performance.timeOrigin + performance.now();
let sessions = new Map(), store = null, ready = false, storeFailed = false;
let requestCount = 0, mutations = Promise.resolve();
const mutate = async input => {
  if (!ready || storeFailed) return { status: 503, body: { code: 'lab_store_unavailable',
    error: '实验记录尚未就绪或写入未确认，请重启实验服务后手动核对；不要重发旧输入。' } };
  const now = serverNow(), next = new Map(sessions);
  for (const [id, value] of next) if (now - value.touched > 10 * 60000) next.delete(id);
  let changed = next.size !== sessions.size;
  const finish = async (status, body) => {
    if (changed) {
      try { await store?.save(next); }
      catch (error) { storeFailed = true; throw error; }
      sessions = next;
    }
    return { status, body: status === 200
      ? { ...body, serverTime: serverNow(), simulation: { up, down, jitter } } : body };
  };
  let state, lastRequest = 0, lease;
  if (input.kind === 'create') {
    if (next.size >= 32) return finish(429, { error: 'Lab session limit. Wait for idle sessions to expire.' });
    state = createSession(randomUUID()); lease = randomUUID();
  } else {
    const stored = next.get(input.id);
    if (!stored) return finish(410, { code: 'session_expired', error: '原型会话已失效；可明确新建暂停练习，不恢复旧拍。' });
    if (input.kind === 'recover') {
      // Recovery never replays input; it pauses and replaces page credentials.
      state = command(stored.state, { kind: 'pause' }, now); lease = randomUUID();
    } else {
      if (input.lease !== stored.lease) return finish(409, { code: 'lease_replaced', error: '本页已被另一页面的核对取代，请手动核对暂停。' });
      if (!Number.isSafeInteger(input.requestId) || input.requestId <= stored.lastRequest) {
        return finish(409, { error: '旧请求已被后续操作取代。' });
      }
      lastRequest = input.requestId; lease = stored.lease;
      try { state = command(stored.state, input, now); }
      catch (error) { return finish(409, { error: error.message }); }
    }
  }
  next.set(state.id, { state, touched: now, lastRequest, lease }); changed = true;
  return finish(200, { state, lease });
};
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
    // Serialize only mutations, after upstream delay and before downstream
    // delay. A later pause can still overtake an upstream-delayed old input.
    const pending = mutations.then(() => mutate(input));
    mutations = pending.catch(() => {});
    const reply = await pending;
    await wait(down + (index % 2 ? 0 : jitter));
    send(reply.status, reply.body);
  } catch { if (!res.headersSent) send(storeFailed ? 503 : 500, {
    ...(storeFailed ? { code: 'lab_store_unavailable' } : {}),
    error: storeFailed ? '实验记录写入未确认，请重启实验服务后手动核对；不要重发旧输入。' : '原型连接中断，请手动重新核对。',
  }); else res.end(); }
});
server.requestTimeout = 10000;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  store = await openStore(process.env.PIXELPET_RHYTHM_STORE, port);
  // A restart grants ten new idle minutes. Live cues, clock anchors, leases
  // and request IDs never cross the process boundary.
  const touched = serverNow();
  sessions = new Map((store?.states ?? []).map(state => [state.id,
    { state, touched, lastRequest: 0, lease: randomUUID() }]));
  ready = true;
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`,
    prototype: fileURLToPath(import.meta.url), up, down, jitter, persistent: !!store }));
} catch (error) {
  console.error(`Rhythm lab startup refused: ${error.message}`);
  server.closeAllConnections(); server.close(); process.exitCode = 1;
}
