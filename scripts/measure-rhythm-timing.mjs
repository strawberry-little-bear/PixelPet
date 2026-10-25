// Opt-in measurements of the actual isolated client/protocol in Chrome.
// Synthetic transport and RAF scheduling, not human reaction or physical display latency.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-rhythm-timing-'));
const profiles = [
  { name: 'loopback', up: 0, down: 0 },
  { name: 'symmetric-100', up: 50, down: 50 },
  { name: 'uplink-heavy-300', up: 250, down: 50 },
  { name: 'downlink-heavy-300', up: 50, down: 250 },
  { name: 'alternating-jitter-300', up: 40, down: 60, jitter: 200 },
  { name: 'slow-raf-touch', up: 50, down: 50, frameMs: 200, touch: true },
  { name: 'high-rtt-neutral-pause', up: 400, down: 400, stop: '连接往返较长' },
  { name: 'stalled-raf-neutral-pause', up: 0, down: 0, frameMs: 1100, stop: '页面停顿' },
];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [], errors = [];
let browser;
async function start(profile) {
  const child = spawn(process.execPath, ['prototypes/rhythm/server.mjs'], {
    cwd: root, env: { ...process.env, PIXELPET_RHYTHM_STORE: '', PIXELPET_RHYTHM_PORT: '0',
      PIXELPET_RHYTHM_UP_MS: String(profile.up), PIXELPET_RHYTHM_DOWN_MS: String(profile.down),
      PIXELPET_RHYTHM_JITTER_MS: String(profile.jitter || 0) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  try {
    for (let i = 0; i < 100 && !stdout.includes('\n'); i++) {
      assert.equal(child.exitCode, null, stderr || 'lab exited before startup');
      await delay(50);
    }
    assert(stdout.includes('\n'), `lab startup timeout: ${stderr}`);
    return { child, url: JSON.parse(stdout.split('\n')[0]).url };
  } catch (error) { await stop(child); throw error; }
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit;
}

// Instrument the same fetch/json completion and phase text the actual client uses.
// No client score/time is sent to the server. Only the normal native A/B/C controls act.
function instrument({ frameMs }) {
  const lab = window.labTiming = { commands: [], phases: [], inputs: [], frames: [] };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (url, options) => {
    const input = JSON.parse(options.body), row = { kind: input.kind, sequence: input.sequence, sent: performance.now() };
    lab.commands.push(row);
    const response = await nativeFetch(url, options), json = response.json.bind(response);
    response.json = async () => {
      const reply = await json();
      row.received = performance.now(); row.rtt = row.received - row.sent;
      row.reply = reply; row.ok = response.ok;
      return reply;
    };
    return response;
  };
  let previousPhase = '';
  new MutationObserver(() => {
    const phase = document.getElementById('phase')?.textContent;
    if (phase && phase !== previousPhase) {
      previousPhase = phase;
      const reply = lab.commands.findLast(row => row.reply)?.reply;
      lab.phases.push({ at: performance.now(), text: phase, sequence: reply?.state?.cue?.sequence });
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
  for (const name of ['keydown', 'pointerdown']) document.addEventListener(name, event => {
    lab.inputs.push({ at: performance.now(), type: name, key: event.key || event.target.closest('[data-key]')?.dataset.key });
  }, true);
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = fn => {
    const run = timestamp => { lab.frames.push(performance.now()); fn(timestamp); };
    return frameMs ? setTimeout(() => raf(run), frameMs) : raf(run);
  };
}
const idle = page => page.waitForFunction(() => !document.getElementById('status').textContent.includes('正在核对'), null, { polling: 20 });
async function measure(profile) {
  const { child, url } = await start(profile);
  let context, page;
  const row = { profile, samples: [], requests: [] };
  try {
    context = await browser.newContext(profile.touch
      ? { hasTouch: true, viewport: { width: 390, height: 700 }, reducedMotion: 'reduce' }
      : { viewport: { width: 1000, height: 900 } });
    await context.addInitScript(instrument, { frameMs: profile.frameMs || 0 });
    page = await context.newPage();
    const pageErrors = [], requested = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => requested.push(request.url()));
    await page.goto(url); await idle(page);
    assert.equal(await page.locator('button').count(), 3);
    assert.equal(await page.locator('.screen button,.screen input,.screen a,.screen [role=button]').count(), 0);
    const press = key => profile.touch ? page.locator(`[data-key="${key}"]`).tap() : page.keyboard.press(key);
    await press('B'); await idle(page);
    if (profile.stop) {
      await page.waitForFunction(text => document.getElementById('status').textContent.includes(text), profile.stop, { polling: 20 });
      await idle(page);
      const snapshot = await page.evaluate(() => ({ commands: window.labTiming.commands, status: document.getElementById('status').textContent }));
      row.reason = snapshot.status;
      assert(snapshot.commands.every(command => command.kind !== 'answer'), 'unsafe cue must not send answers');
      assert.equal(snapshot.commands.at(-1).reply.state.observations.length, 0);
      assert.equal(snapshot.commands.at(-1).reply.state.status, 'paused');
      assert.deepEqual(snapshot.commands.map(command => command.kind), ['create', 'resume', 'pause'], 'one protective pause, never a replay');
      const count = await page.evaluate(() => window.labTiming.commands.length);
      await delay(1200);
      assert.equal(await page.evaluate(() => window.labTiming.commands.length), count, 'pause cannot retry or auto resume');
    } else {
      for (let round = 0; round < 3; round++) {
        await page.waitForFunction(() => document.body.classList.contains('active'), null, { polling: 10 });
        // This 200ms is a chosen input schedule, never a human reaction estimate.
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)));
        const cue = await page.evaluate(() => window.labTiming.commands.at(-1).reply.state.cue);
        await press(cue.key);
        await page.waitForFunction(count => document.getElementById('round').textContent === `${count} / 12`, round + 1, { polling: 20 });
        await idle(page);
      }
      await press('C'); await idle(page);
      const trace = await page.evaluate(() => window.labTiming);
      const answers = trace.commands.filter(command => command.kind === 'answer');
      assert.equal(answers.length, 3);
      for (const [index, answer] of answers.entries()) {
        const issued = trace.commands.find(command => command.reply?.state.cue?.sequence === answer.sequence);
        const cue = issued.reply.state.cue;
        const phase = trace.phases.find(phase => phase.sequence === cue.sequence && phase.text.startsWith('现在回应'));
        assert(phase, 'input must follow an observed response phase for this cue');
        const input = trace.inputs.findLast(input => input.at <= answer.sent && input.at >= phase.at && input.key === cue.key);
        assert(input, 'native keyboard/touch input must occur after the phase');
        const observation = answer.reply.state.observations[index];
        assert.equal(observation.sequence, cue.sequence); assert.equal(observation.directionMatches, true);
        assert.equal(answer.reply.state.observations.length, index + 1);
        // RTT midpoint estimate is measured locally, never treated as a proof
        // of either one-way delay or what a human actually saw on the display.
        const estimatedTarget = issued.received + cue.target - issued.reply.serverTime - issued.rtt / 2;
        row.samples.push({ sequence: cue.sequence, issuedRttMs: issued.rtt, answerRttMs: answer.rtt,
          phaseAfterEstimatedTargetMs: phase.at - estimatedTarget, inputAfterPhaseMs: input.at - phase.at,
          inputToFetchMs: answer.sent - input.at,
          clientElapsedFromIssueMs: answer.received - issued.received,
          serverElapsedFromIssueMs: answer.reply.serverTime - issued.reply.serverTime,
          elapsedDifferenceMs: (answer.reply.serverTime - issued.reply.serverTime) - (answer.received - issued.received),
          serverArrivalDeltaMs: observation.arrivalDeltaMs,
          arrival: observation.arrival });
      }
      // A large elapsed difference can include changing downstream delay,
      // scheduling and different clock behavior. Preserve it as uncertainty;
      // passing interaction assertions must never imply timing fairness.
      row.elapsedWarnings = row.samples.filter(sample => Math.abs(sample.elapsedDifferenceMs)
        > sample.issuedRttMs + sample.answerRttMs + 100).map(sample => sample.sequence);
      const last = trace.commands.at(-1);
      assert.equal(last.kind, 'pause'); assert.equal(last.reply.state.status, 'paused');
      assert.equal(last.reply.state.observations.length, 3);
    }
    const trace = await page.evaluate(() => window.labTiming);
    row.requests = trace.commands.map(command => ({ kind: command.kind, rttMs: command.rtt, ok: command.ok }));
    row.maxObservedFrameGapMs = Math.max(0, ...trace.frames.slice(1).map((at, index) => at - trace.frames[index]));
    assert(trace.commands.every(command => command.ok), 'all protocol writes must be acknowledged');
    for (const command of trace.commands) {
      assert.deepEqual(command.reply.simulation, { up: profile.up, down: profile.down, jitter: profile.jitter || 0 });
      assert(command.rtt >= profile.up + profile.down + (profile.jitter || 0) - 10, 'injected transport delay must be observed');
    }
    if (profile.frameMs) assert(row.maxObservedFrameGapMs >= profile.frameMs - 10, 'controlled RAF delay must be observed');
    assert(requested.every(request => new URL(request).origin === url && !new URL(request).pathname.startsWith('/api/')), 'isolated lab requests only');
    assert.deepEqual(pageErrors, []);
    row.passed = true;
  } catch (error) {
    row.passed = false; row.error = error.stack; errors.push(profile.name);
    row.diagnostic = await page?.evaluate(() => ({
      status: document.getElementById('status')?.textContent,
      phase: document.getElementById('phase')?.textContent,
      commands: window.labTiming?.commands.map(command => ({ kind: command.kind, sent: command.sent,
        received: command.received, rttMs: command.rtt, ok: command.ok,
        status: command.reply?.state?.status, observations: command.reply?.state?.observations.length })),
    })).catch(() => null);
  } finally {
    try { await context?.close(); } finally { await stop(child); }
  }
  results.push(row);
  console.log(`${row.passed ? 'PASS' : 'FAIL'} ${profile.name}: ${row.samples.length} measured responses${row.elapsedWarnings?.length ? `; elapsed uncertainty on cues ${row.elapsedWarnings.join(', ')}` : ''}${row.error ? `\n${row.error}` : ''}`);
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const profile of profiles) await measure(profile);
} finally {
  await browser?.close();
  await writeFile(join(dir, 'results.json'), JSON.stringify({
    notes: 'Synthetic loopback transport; actual isolated client/server and native Chrome input. DOM text observation and controlled RAF cadence are not photon timing, physical touch, human response, population success rates, or a fairness approval. RTT includes local HTTP/JSON scheduling. Elapsed differences include varying downstream delay and scheduling; warnings flag differences larger than both RTTs plus 100ms, not a clock-drift diagnosis. Three responses per running profile are diagnostic samples only. No scores, rewards, production game, save, or player service accessed.',
    results, errors,
  }, null, 2));
  console.log(`Report: ${join(dir, 'results.json')}`);
}
if (errors.length) process.exitCode = 1;
