// Optional real-Chrome regression. Always creates its own temporary save and server.
// See docs/NAME_LAYOUT.md for the binary and Playwright setup. Never targets :8080.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY;
assert(binary && isAbsolute(binary), 'Set PIXELPET_TEST_BINARY to an absolute path to a freshly built test binary.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'pixelpet-name-layout-'));
const db = join(directory, 'test.db');
const port = await new Promise((resolve, reject) => {
  const listener = net.createServer();
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', () => {
    const port = listener.address().port;
    listener.close(error => error ? reject(error) : resolve(port));
  });
});
const base = `http://127.0.0.1:${port}`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const cases = [], failures = [];
let server, browser, serverLog = '';
const nameCases = [
  { label: 'default', name: '莓莓兔', sleeping: false },
  { label: 'chinese-12', name: '草莓小熊今天也要好好长大', sleeping: false },
  { label: 'wide-ascii-12', name: 'WWWWWWWWWWWW', sleeping: false },
  { label: 'astral-12', name: '🐻'.repeat(12), sleeping: true },
];
const key = async (page, value, touch) => {
  const button = page.locator(`.button-${value}:not(:disabled)`);
  await button.waitFor();
  if (touch) await button.tap();
  else { await button.focus(); await page.keyboard.press(value); }
};
async function inspect(page, testCase, mode, actions, errors) {
  const layout = await page.evaluate(() => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const title = document.querySelector('.companion-title');
    const screen = document.querySelector('.home-caption, .status-name');
    const shell = Object.fromEntries(['.device-stage', '.device', '.screen-bezel', '.lcd', '.lcd-content', '.device-buttons']
      .map(selector => [selector, rect(document.querySelector(selector))]));
    const containers = [title, screen];
    const children = [...title.children, ...screen.querySelectorAll('strong, small, span, .pet-sprite')];
    return {
      viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      shell,
      containers: containers.map(rect), children: children.map(rect),
      overflow: containers.map(e => e.scrollWidth > e.clientWidth + 1),
      name: title.querySelector('h2').textContent,
      screenName: screen.querySelector('strong, span').textContent,
      stage: title.querySelector('span').textContent,
      buttons: document.querySelectorAll('.physical-button').length,
      lcdControls: document.querySelectorAll('.lcd button, .lcd a, .lcd input, .lcd [role="button"]').length,
    };
  });
  const checks = [];
  const check = (condition, message) => { if (!condition) checks.push(message); };
  check(layout.scrollWidth <= layout.viewport + 1, 'horizontal document overflow');
  check(layout.overflow.every(value => !value), 'title or LCD header overflows');
  for (const [index, child] of layout.children.entries()) {
    const parent = layout.containers[index < 2 ? 0 : 1];
    check(child.x >= parent.x - 1 && child.right <= parent.right + 1 && child.y >= parent.y - 1 && child.bottom <= parent.bottom + 1, `child ${index} outside header`);
  }
  const [name, stage] = layout.children;
  check(name.right <= stage.x + 1 || stage.right <= name.x + 1 || name.bottom <= stage.y + 1 || stage.bottom <= name.y + 1, 'name and stage overlap');
  check(layout.name === testCase.name && layout.screenName === testCase.name, 'name was truncated or replaced');
  check(layout.stage === '幼年期', 'stage label lost');
  check(layout.buttons === 3 && layout.lcdControls === 0, 'three-key constraint violated');
  check(Object.values(layout.shell).every(box => box.height > 0 && box.width > 0), 'device shell geometry is missing');
  check(actions.length === 0, 'read-only navigation wrote an action');
  check(errors.length === 0, 'browser runtime error');
  const entry = { ...testCase, mode, layout, failures: checks };
  cases.push(entry);
  if (checks.length) failures.push(entry);
  console.log(checks.length ? 'FAIL' : 'PASS', testCase.label, testCase.width, testCase.zoom, mode, checks.join('; '));
  return layout;
}
try {
  server = spawn(binary, [], {
    cwd: root,
    env: { ...process.env, PIXELPET_DB: db, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_WEB: join(root, 'web/dist') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let startupError;
  server.on('error', error => { startupError = error; });
  server.stderr.on('data', data => { serverLog += data; });
  server.stdout.on('data', data => { serverLog += data; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, serverLog);
    try { if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, `Test server unavailable: ${serverLog}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const sample of nameCases) for (const width of [320, 390, 700, 701, 960, 961, 1200, 1440]) for (const zoom of [1, 2]) {
    assert(Array.from(sample.name).length <= 12);
    const now = Date.now();
    const response = await fetch(`${base}/api/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema: 1, revision: 1, species: 2, name: sample.name,
        createdAt: now - 60000, hatchedAt: now - 60000, lastTick: now, sleeping: sample.sleeping,
        needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] }),
    });
    const imported = await response.json();
    assert(response.ok, JSON.stringify(imported));
    assert.equal(imported.state.name, sample.name);
    const touch = width <= 700, context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: touch, isMobile: touch });
    try {
      const page = await context.newPage(), actions = [], errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('request', request => { if (new URL(request.url()).pathname === '/api/action') actions.push(request.postData()); });
      await page.addInitScript(zoom => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = 14 * zoom + 'px'; }), zoom);
      await page.goto(base); await page.locator('.home-caption').waitFor(); await page.evaluate(() => document.fonts.ready);
      const testCase = { ...sample, width, zoom, touch };
      const homeLayout = await inspect(page, testCase, 'home', actions, errors);
      if (sample.label === 'wide-ascii-12' && ((width === 320 && zoom === 2) || (width === 1200 && zoom === 1))) {
        await page.screenshot({ path: join(directory, `name-${width}-${zoom}.png`), fullPage: true });
      }
      await key(page, 'a', touch); for (let i = 0; i < 4; i++) await key(page, 'a', touch); await key(page, 'b', touch);
      await page.locator('.status-name').waitFor();
      const statusLayout = await inspect(page, testCase, 'status', actions, errors);
      const shellChanges = Object.keys(homeLayout.shell).filter(selector =>
        Math.abs(homeLayout.shell[selector].height - statusLayout.shell[selector].height) > 1
        || Math.abs(homeLayout.shell[selector].width - statusLayout.shell[selector].width) > 1);
      if (shellChanges.length) {
        const failure = { ...testCase, mode: 'home-to-status', failures: [`device shell resized: ${shellChanges.join(', ')}`] };
        failures.push(failure);
        cases.push(failure);
        console.log('FAIL', testCase.label, testCase.width, testCase.zoom, failure.failures[0]);
      }
      await key(page, 'c', touch); await page.locator('.home-caption').waitFor();
      const current = await (await fetch(`${base}/api/state`)).json();
      assert.equal(current.state.name, sample.name); assert.equal(current.state.sleeping, sample.sleeping);
      assert.equal(current.state.careCount, 0);
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.pid) {
    await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
  }
  await writeFile(join(directory, 'results.json'), JSON.stringify({ db, base, cases, failures }, null, 2));
  console.log(`${cases.length - failures.length}/${cases.length} groups passed. Evidence: ${directory}`);
}
assert.equal(failures.length, 0, `Name layout failures: ${failures.length}; inspect ${directory}/results.json`);
