// Seven game reading layouts: own temporary database/server and native Chrome.
// The test deliberately exercises the real three-key route into each game,
// then checks that long reading content scrolls inside the LCD instead of
// resizing the device shell.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-game-reading-layout-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const value = socket.address().port;
    socket.close(error => error ? reject(error) : resolve(value));
  });
});
const base = `http://127.0.0.1:${port}`;
let server, browser, log = '', startupError;
const results = [];

async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert(response.ok, `${path}: ${await response.clone().text()}`);
  return response.json();
}

async function fixture() {
  const now = Date.now();
  return api('import', {
    schema: 1,
    revision: 1,
    species: 2,
    name: '阅读布局小伙伴',
    createdAt: now - 3600000,
    hatchedAt: now - 3600000,
    lastTick: now,
    sleeping: false,
    needs: { hunger: 80, mood: 80, energy: 80, clean: 80 },
    careCount: 0,
    logs: [],
  });
}

async function key(page, value) {
  await page.locator(`.button-${value.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}

async function openGame(page, index) {
  for (const value of ['a', 'a', 'b']) await key(page, value);
  await page.locator('.arcade-panel').waitFor();
  for (let i = 0; i < index; i++) await key(page, 'a');
  await key(page, 'b');
  await page.locator('.game-guide').waitFor();
  await key(page, 'b');
}

async function pauseIfNeeded(page, id) {
  if (id === 'fishing') {
    await page.locator('.fishing-game').waitFor();
    await key(page, 'c');
    await page.locator('.fishing-pause').waitFor();
  }
}

async function shellMetrics(page) {
  return page.evaluate(() => {
    const selectors = ['.device-stage', '.device', '.screen-bezel', '.lcd', '.lcd-content'];
    return Object.fromEntries(selectors.map(selector => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      return [selector, {
        height: box.height,
        width: box.width,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
      }];
    }));
  });
}

async function assertReadingLayout(page, mode, id) {
  const state = await page.locator('.device-stage').getAttribute('class');
  assert.match(state, /reading-mode/, `${id} did not enter reading mode`);
  assert.doesNotMatch(state, /recovery-mode/, `${id} unexpectedly entered recovery mode`);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0,
    `${id} added a clickable gameplay control inside the LCD`);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${id} overflows horizontally at ${mode.width}px`);

  const before = await shellMetrics(page);
  const content = page.locator('.lcd-content');
  assert.equal(before['.lcd-content'].overflowY, 'auto', `${id} LCD content is not independently scrollable`);
  const expectedScreen = mode.width <= 700 ? 364 : 284;
  assert(Math.abs(before['.screen-bezel'].height - expectedScreen) < 1,
    `${id} screen bezel height changed: ${before['.screen-bezel'].height}`);
  assert(before['.lcd-content'].clientHeight > 0,
    `${id} LCD content has no readable viewport`);

  const overflow = before['.lcd-content'].scrollHeight - before['.lcd-content'].clientHeight;
  if (overflow > 1) {
    await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction(() => {
      const element = document.querySelector('.lcd-content');
      return element && element.scrollTop >= element.scrollHeight - element.clientHeight - 1;
    });
    const afterScroll = await shellMetrics(page);
    assert.equal(afterScroll['.lcd-content'].scrollHeight, before['.lcd-content'].scrollHeight,
      `${id} content changed while scrolling`);
    for (const selector of ['.device-stage', '.device', '.screen-bezel', '.lcd']) {
      assert(Math.abs(afterScroll[selector].height - before[selector].height) < 1,
        `${id} ${selector} grew while reading`);
    }
    const bottom = await content.evaluate(element => {
      const box = element.getBoundingClientRect();
      const last = [...element.querySelectorAll('*')].reverse().find(node => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && node.textContent?.trim();
      });
      if (!last) return false;
      const rect = last.getBoundingClientRect();
      return rect.bottom <= box.bottom + 1 && rect.right <= box.right + 1;
    });
    assert(bottom, `${id} bottom reading content is not reachable inside LCD`);
  }

  const horizontalOverflow = await content.evaluate(element => ({
    content: element.scrollWidth - element.clientWidth,
    page: document.documentElement.scrollWidth - innerWidth,
  }));
  assert(horizontalOverflow.content <= 1 && horizontalOverflow.page <= 1,
    `${id} text is horizontally clipped at ${mode.font}px root size: ${JSON.stringify(horizontalOverflow)}`);
  return { ...before, overflow };
}

try {
  server = spawn(binary, [], {
    cwd: root,
    env: {
      ...process.env,
      PIXELPET_ADDR: `127.0.0.1:${port}`,
      PIXELPET_DB: join(dir, 'test.db'),
      PIXELPET_WEB: web,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', chunk => { log += chunk; });
  server.stderr.on('data', chunk => { log += chunk; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, log);
    try {
      if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; }
    } catch {}
    await wait(100);
  }
  assert(ready, log);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const games = [
    ['stars', '.star-game'],
    ['tiles', '.tile-game'],
    ['snake', '.snake-game'],
    ['tetris', '.tetris-game'],
    ['fishing', '.fishing-game'],
    ['walk', '.walking-game'],
    ['treasure', '.treasure-game'],
  ];
  const modes = [
    { width: 1200, height: 800, font: 14 },
    { width: 390, height: 844, font: 14 },
    { width: 320, height: 568, font: 28 },
  ];
  for (const mode of modes) {
    let shellBaseline;
    for (const [index, [id, selector]] of games.entries()) {
      await fixture();
      const context = await browser.newContext({
        viewport: { width: mode.width, height: mode.height },
        hasTouch: true,
        isMobile: mode.width < 700,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(font => {
          document.addEventListener('DOMContentLoaded', () => {
            document.documentElement.style.fontSize = `${font}px`;
          });
        }, mode.font);
        await page.goto(base);
        await page.locator('.home-caption').waitFor();
        await openGame(page, index);
        await page.locator(selector).waitFor();
        await pauseIfNeeded(page, id);
        const metrics = await assertReadingLayout(page, mode, id);
        const shell = Object.fromEntries(['.device-stage', '.device', '.screen-bezel', '.lcd']
          .map(selector => [selector, metrics[selector].height]));
        if (!shellBaseline) shellBaseline = shell;
        for (const selector of Object.keys(shellBaseline)) {
          assert(Math.abs(shell[selector] - shellBaseline[selector]) < 1,
            `${id} ${selector} height differs from the ${mode.width}px reading shell: ${shell[selector]} vs ${shellBaseline[selector]}`);
        }
        assert.deepEqual(errors, [], `${id} emitted browser errors: ${errors.join('; ')}`);
        results.push({ ...mode, id, overflow: metrics.overflow, passed: true });
      } catch (error) {
        await page.screenshot({ path: join(dir, `failure-${id}-${mode.width}-${mode.font}.png`), fullPage: true });
        throw error;
      } finally {
        await context.close();
      }
    }
  }
  assert(results.some(result => result.width === 320 && result.font === 28 && result.overflow > 1),
    'narrow large-text coverage never exercised an internally scrollable game reading');
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    await closed;
  }
  await writeFile(join(dir, 'server.log'), log);
  console.log('Artifacts:', dir);
}
