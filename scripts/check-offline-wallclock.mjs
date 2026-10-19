// Opt-in real wall-clock acceptance. Own servers/databases only; no mocked time,
// browser heartbeats or direct database edits. Default wait: sixteen minutes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY to a freshly built test binary.');
const waitMs = Number(process.env.PIXELPET_WALL_WAIT_MS ?? 16 * 60000);
assert(Number.isSafeInteger(waitMs) && waitMs >= 16 * 60000 && waitMs <= 60 * 60000,
  'PIXELPET_WALL_WAIT_MS must be 16–60 real minutes (milliseconds); this is not a fast test.');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-offline-wallclock-'));
const cases = [], results = [], requests = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} != ${expected}`);

async function port() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
  });
}
async function api(c, path, body, headers = {}) {
  const response = await fetch(c.base + '/api/' + path, {
    method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text(); assert(response.ok, `${c.label} ${path}: ${response.status} ${text}`);
  const reply = JSON.parse(text); requests.push({ label: c.label, path, method: body === undefined ? 'GET' : 'POST', at: Date.now() });
  return reply;
}
async function start(c) {
  assert(!c.child, 'Do not replace a running server'); const p = await port(); c.base = `http://127.0.0.1:${p}`;
  c.ports.push(p); c.starts++; let error;
  const child = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${p}`, PIXELPET_DB: c.db, PIXELPET_WEB: join(root, 'web/dist') }, stdio: ['ignore', 'pipe', 'pipe'] });
  c.child = child; child.once('error', e => { error = e; });
  child.stdout.on('data', b => { c.log += b; }); child.stderr.on('data', b => { c.log += b; });
  // TCP readiness does not read state, advance time, or register presence.
  for (let i = 0; i < 100; i++) {
    if (error) throw error; assert.equal(child.exitCode, null, c.log);
    const connected = await new Promise(resolve => { const s = net.connect(p, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => { s.destroy(); resolve(false); }); });
    if (connected) return;
    await wait(100);
  }
  throw new Error(`Startup timeout: ${c.label}\n${c.log}`);
}
async function stop(c) {
  const child = c.child; if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited;
  }
  c.child = null;
}
function snapshot(state) {
  const g = state.growth;
  return { needs: state.needs, stage: g.stage, form: g.form, points: g.points, rest: g.care.rest, trackedHours: g.trackedHours, sleeping: state.sleeping };
}
function verifySettlement(c, reply) {
  const before = c.baseline.state, after = reply.state, rules = c.baseline.careRules;
  const hours = (after.lastTick - before.lastTick) / 3600000;
  assert(hours >= waitMs / 3600000 && hours < rules.maxOfflineHours, `${c.label}: unexpected elapsed/capped time ${hours}`);
  assert.equal(after.sleeping, c.sleeping); assert.equal(after.growth.stage, c.stage);
  const rates = rules[c.sleeping ? 'sleeping' : 'awake'];
  for (const key of ['hunger', 'mood', 'clean', 'energy']) {
    // This acceptance deliberately starts away from need bounds; don't quietly
    // use an unclamped oracle if a suspended test machine makes the gap huge.
    const expected = before.needs[key] + rates[key] * hours;
    assert(expected > 0 && expected < 100, `${c.label}: fixture left linear range`);
    near(after.needs[key], expected, `${c.label} ${key}`);
  }
  const wellbeing = hours * Object.keys(rates).reduce((sum, key) => sum + (before.needs[key] + after.needs[key]) / 2, 0) / 400;
  const rest = c.sleeping ? (after.needs.energy - before.needs.energy) / rules.growth.restEnergyPerHabit : 0;
  near(after.growth.trackedHours - before.growth.trackedHours, hours, `${c.label} tracked time`);
  near(after.growth.wellbeing - before.growth.wellbeing, wellbeing, `${c.label} comfort integral`);
  near(after.growth.care.rest - before.growth.care.rest, rest, `${c.label} rest habit`);
  near(after.growth.points, Math.min(72, before.growth.points + hours * rules.growth.basePerHour + wellbeing * rules.growth.comfortPerHour + rest * rules.growth.restPointsPerHabit), `${c.label} growth`);
  assert.equal(after.growth.form, before.growth.form);
  assert.deepEqual(after.growth.formRecord, before.growth.formRecord);
  for (const key of ['nutrition', 'play', 'clean', 'lastFeed', 'lastPlay', 'lastClean']) assert.equal(after.growth.care[key], before.growth.care[key]);
  for (const key of ['careCount', 'economy', 'companion', 'pond', 'park', 'game']) assert.deepEqual(after[key], before[key], `${c.label} ${key} gained offline rewards/actions`);
  return { hours, needs: after.needs, growth: after.growth.points - before.growth.points, rest };
}
try {
  for (const stage of ['baby', 'growing', 'adult']) for (const sleeping of [false, true]) {
    const c = { label: `${stage}-${sleeping ? 'sleep' : 'awake'}`, stage, sleeping, db: join(dir, `${stage}-${sleeping}.db`), ports: [], starts: 0, log: '' }; cases.push(c);
    await start(c); const now = Date.now(), age = { baby: 1, growing: 30, adult: 80 }[stage] * 3600000;
    await api(c, 'import', { schema: 1, revision: 1, species: 2, name: '真实离开验收', createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping,
      needs: { hunger: 60, mood: 80, clean: 65, energy: 40 }, careCount: 0, logs: [] });
    c.baseline = await api(c, 'visit', {}); assert.equal(c.baseline.state.growth.stage, stage); assert(!c.baseline.returnRecap && !c.baseline.recapPending);
    await stop(c); c.stoppedAt = Date.now(); console.log('STOPPED', c.label, c.stoppedAt, c.db);
  }
  const started = performance.now(), wallStarted = Date.now(), callsBeforeWait = requests.length;
  console.log(JSON.stringify({ phase: 'real-offline-wait', waitMs, startedAt: new Date(wallStarted).toISOString(), artifacts: dir, serversRunning: 0 }));
  await writeFile(join(dir, 'waiting.json'), JSON.stringify({ waitMs, wallStarted, cases: cases.map(c => ({ label: c.label, db: c.db, stoppedAt: c.stoppedAt, baseline: c.baseline, ports: c.ports })) }, null, 2));
  await wait(waitMs);
  const elapsed = performance.now() - started, wallElapsed = Date.now() - wallStarted;
  assert(elapsed >= waitMs - 1, `Monotonic wait too short: ${elapsed}`);
  assert(Math.abs(wallElapsed - elapsed) < 5000, `Clock changed during acceptance: wall=${wallElapsed}, monotonic=${elapsed}`);
  assert.equal(requests.length, callsBeforeWait, 'No heartbeats/reads during absence');
  for (const c of cases) {
    await start(c); const passive = await api(c, 'state');
    const settlement = verifySettlement(c, passive); assert(!passive.returnRecap && !passive.recapPending, 'Passive GET must not register a return');
    assert.equal(passive.saveGeneration, c.baseline.saveGeneration);
    const visit = await api(c, 'visit', {}), recap = structuredClone(visit.returnRecap);
    verifySettlement(c, visit); assert(recap && visit.recapPending && !visit.recapClaimed);
    assert.equal(recap.from, c.baseline.serverTime); assert.equal(recap.to, visit.serverTime);
    assert.deepEqual(recap.before, snapshot(c.baseline.state)); assert.deepEqual(recap.after, snapshot(visit.state));
    if (c.sleeping) {
      const denied = await api(c, 'recap/read', { id: recap.id }); assert(denied.recapPending && !denied.recapClaimed);
      const wake = { kind: 'sleep', requestId: `wall-wake-${c.label}` };
      const headers = { 'X-PixelPet-Generation': visit.saveGeneration, 'X-PixelPet-Sleep-If': 'sleeping' };
      const woke = await api(c, 'action', wake, headers); assert.equal(woke.state.sleeping, false); assert.deepEqual(woke.returnRecap, recap);
      const duplicate = await api(c, 'action', wake, headers); assert.equal(duplicate.state.sleeping, false); assert(!duplicate.returnRecap && !duplicate.recapPending && !duplicate.recapClaimed, 'Cached wake must not replay a recap notification');
      const stillSaved = await api(c, 'state'); assert(stillSaved.recapPending); assert.deepEqual(stillSaved.returnRecap, recap);
    }
    const read = await api(c, 'recap/read', { id: recap.id }); assert(read.recapClaimed && !read.recapPending); assert.deepEqual(read.returnRecap, recap);
    const duplicate = await api(c, 'recap/read', { id: recap.id }); assert(!duplicate.recapClaimed && !duplicate.recapPending); assert.deepEqual(duplicate.returnRecap, recap);
    await stop(c); await start(c); const persisted = await api(c, 'visit', {});
    assert(!persisted.recapPending && !persisted.recapClaimed); assert.deepEqual(persisted.returnRecap, recap);
    assert.equal(persisted.state.sleeping, false); assert.equal(persisted.saveGeneration, c.baseline.saveGeneration);
    assert.equal(persisted.state.careCount, c.baseline.state.careCount); assert.deepEqual(persisted.state.economy, c.baseline.state.economy);
    results.push({ label: c.label, starts: c.starts, ports: c.ports, baseline: c.baseline, passive, visit, recap, settlement, persisted });
    await stop(c); console.log('PASS', c.label, JSON.stringify(settlement));
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ waitMs, elapsed, wallElapsed, cases: results, requests }, null, 2));
  console.log(JSON.stringify({ groups: results.length, elapsed, wallElapsed, artifacts: dir, serversRunning: 0 }));
} finally {
  await Promise.all(cases.map(stop));
  await Promise.all(cases.map(c => writeFile(join(dir, `${c.label}.log`), c.log)));
  await writeFile(join(dir, 'requests.json'), JSON.stringify(requests, null, 2));
}
