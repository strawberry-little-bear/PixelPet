// Real HTTP care/status/handbook reading; isolated build, save and random port.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBoundedReadingShell, assertSameReadingShell, readReadingShell } from './reading-shell-geometry.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-care-reading-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '', startupError;
async function api(path, body) {
  const res = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function key(page, k) {
  await page.locator(`.button-${k.toLowerCase()}:not(:disabled)`).tap();
  // Let the controlled reading view commit before the next physical-key tap.
  // Without this yield, a fast sequence can land on the previous home view
  // while React is still replacing the care panel.
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
  await page.waitForTimeout(40);
}
async function focusedKey(page) { return page.evaluate(() => ['a', 'b', 'c'].find(k => document.activeElement?.classList.contains(`button-${k}`)) ?? null); }
async function visible(page, selector) {
  await wait(100);
  const box = await page.locator(selector).boundingBox(), height = await page.evaluate(() => innerHeight);
  assert(box && box.y >= -1 && box.y + box.height <= height + 1, `${selector} outside native viewport: ${JSON.stringify(box)}`);
}
async function visibleHeading(page, kind, n) {
  const selector = kind === 'growth' ? [
    '.growth-panel-title', '.growth-panel > .habit-heading', '.form-guide > .habit-heading',
    '.companion-panel > .habit-heading', '.growth-time-guide > h3', '.growth-look-guide > h3',
  ][n] : ['.status-name', '.life-summary > h3', '.status-guide > h3'][n];
  await visible(page, selector);
}
async function open(page, kind) {
  await key(page, 'A'); for (let i = 0; i < (kind === 'growth' ? 6 : 4); i++) await key(page, 'A');
  await key(page, 'B'); await page.locator(`.content-${kind}`).waitFor();
  await visible(page, '[data-care-reading-start]');
}
async function nativeRead(page, kind, panel, capturePath) {
  const originalKey = await focusedKey(page), value = await panel.getAttribute(`data-${kind}-page`);
  assert(originalKey, 'Start from a physical key, not a scripted region focus');
  for (let i = 0; i < 12 && !await panel.evaluate(el => document.activeElement === el); i++)
    await page.keyboard.press('Shift+Tab');
  assert(await panel.evaluate(el => document.activeElement === el), 'Reading region must be reachable with native Tab');
  assert.equal(await panel.getAttribute('aria-label'), kind === 'growth' ? '成长手册阅读区' : '状态说明阅读区');
  assert.equal(await panel.getAttribute('tabindex'), '0');
  const hint = await panel.getAttribute('aria-describedby');
  assert.match(await page.locator(`[id="${hint}"]`).innerText(), /↑\/↓ 或空格/);
  const outline = await panel.evaluate(el => ({width:getComputedStyle(el).outlineWidth, style:getComputedStyle(el).outlineStyle}));
  assert.equal(outline.width, '2px'); assert.equal(outline.style, 'solid');
  if (capturePath) await page.screenshot({path:capturePath});
  const movements = [];
  // Exercise real browser defaults, not synthetic events or a custom scroll handler.
  for (const [key, direction] of [['ArrowDown',1],['Space',1],['Shift+Space',-1],['End',1],['PageUp',-1],['Home',-1],['PageDown',1]]) {
    // Reading pages live in the fixed LCD scroller; use that nearest native
    // scroll container instead of assuming the document itself is scrollable.
    await panel.evaluate((el, direction) => {
      let scroller = null;
      for (let parent = el; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        if (['auto', 'scroll'].includes(css.overflowY) && parent.scrollHeight > parent.clientHeight) { scroller = parent; break; }
      }
      if (scroller) scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * (direction > 0 ? 0.2 : 0.8);
      else scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * (direction > 0 ? 0.2 : 0.8), behavior: 'instant' });
    }, direction);
    await wait(200); const before = await panel.evaluate(el => {
      for (let parent = el; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        if (['auto', 'scroll'].includes(css.overflowY) && parent.scrollHeight > parent.clientHeight) return { scope: 'element', top: parent.scrollTop };
      }
      return { scope: 'document', top: scrollY };
    });
    await page.keyboard.press(key);
    await page.waitForFunction(({before,direction}) => {
      const panel = document.querySelector('[data-care-reading-start]')?.parentElement;
      for (let parent = panel; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        if (['auto', 'scroll'].includes(css.overflowY) && parent.scrollHeight > parent.clientHeight)
          return direction * (parent.scrollTop - before.top) > 1;
      }
      return direction * (scrollY - before.top) > 1;
    }, {before,direction}, {timeout:2500});
    await wait(200); const after = await panel.evaluate(el => {
      for (let parent = el; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        if (['auto', 'scroll'].includes(css.overflowY) && parent.scrollHeight > parent.clientHeight) return { scope: 'element', top: parent.scrollTop };
      }
      return { scope: 'document', top: scrollY };
    });
    assert.equal(await panel.getAttribute(`data-${kind}-page`), value, `${key} must not turn the page`);
    assert(await panel.evaluate(el => document.activeElement === el), `${key} must retain reading focus`);
    movements.push({key,before,after});
  }
  // Tab leaves the region normally; Enter/Space on physical keys stay controls.
  for (let i = 0; i < 6 && await focusedKey(page) !== originalKey; i++) await page.keyboard.press('Tab');
  assert.equal(await focusedKey(page), originalKey, 'Reading must not trap Tab focus');
  return {kind,page:Number(value),movements};
}
async function readable(page, kind) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow');
  assert.equal(await page.locator('[data-care-reading-start]').count(), 1, 'exactly one reading start');
  const problems = await page.locator(`.content-${kind}`).evaluate(el => {
    const area = el.getBoundingClientRect(), footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), problems = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim() || text.parentElement.closest('.sr-only, .care-reading-hint')) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
          const verticalOut = box.top < area.top - 1 || box.bottom > Math.min(area.bottom, footer.top) + 1;
          const scrollableAncestor = (() => {
            for (let parent = text.parentElement; parent; parent = parent.parentElement) {
              const css = getComputedStyle(parent);
              if (['auto', 'scroll'].includes(css.overflowY)) return parent;
            }
            return null;
          })();
          if (box.left < area.left - 1 || box.right > area.right + 1 || (verticalOut && !scrollableAncestor)) problems.push(text.textContent);
          for (let parent = text.parentElement; parent; parent = parent.parentElement) {
            const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
            if (/hidden|clip/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1) && !scrollableAncestor) problems.push('clipped: ' + text.textContent);
          }
      }
    }
    return problems;
  });
  assert.deepEqual(problems, [], 'reading text clipped or overlaps footer');
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [{ width: 1200, height: 700, font: 14 }, { width: 320, height: 700, font: 28 }, { width: 320, height: 380, font: 28 }];
  for (const stage of ['baby', 'growing', 'adult']) for (const sleeping of [false, true]) for (const mode of modes) {
    const at = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
    await api('import', { schema: 1, revision: 1, species: 2, name: '慢慢阅读', createdAt: at - age, hatchedAt: at - age, lastTick: at,
      sleeping, needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [] });
    const before = (await api('state')).state; assert.equal(before.growth.stage, stage);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true, isMobile: mode.width < 700,
      reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [], nativeReading = []; let reads = 0;
    const label = `${stage}-${sleeping}-${mode.width}-${mode.height}`, capture = stage === 'baby' && !sleeping || stage === 'adult' && sleeping;
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', res => { if (['/api/state', '/api/visit'].includes(new URL(res.url()).pathname)) reads++; });
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor();
      const preference = await page.evaluate(() => JSON.stringify(localStorage));
      const shellBaselines = new Map();
      for (const kind of ['growth', 'status']) {
        await open(page, kind); const pages = kind === 'growth' ? 6 : 3;
        for (let n = 0; n < pages; n++) {
          const panel = page.locator(kind === 'growth' ? '.growth-panel' : '.screen-status');
          assert.equal(await panel.getAttribute(`data-${kind}-page`), String(n));
          await visible(page, '[data-care-reading-start]'); await visibleHeading(page, kind, n); await readable(page, kind);
          const shell = await readReadingShell(page);
          const shellBaseline = shellBaselines.get(kind);
          if (!shellBaseline) shellBaselines.set(kind, shell);
          else assertSameReadingShell(shell, shellBaseline, `${label}/${kind}/${n}`);
          assertBoundedReadingShell(shell, `${label}/${kind}/${n}`);
          if (kind === 'growth' && n === 4 || kind === 'status' && n === 1) {
            nativeReading.push(await nativeRead(page, kind, panel, capture ? join(dir, `native-${kind}-${label}.png`) : null));
            // Resume the original reading/sync checks from the explicit start.
            await page.locator('[data-care-reading-start]').scrollIntoViewIfNeeded();
          }
          const focused = await focusedKey(page);
          if (capture && (n === 0 || n === 4 || n === 5 || kind === 'status')) {
            await page.screenshot({ path: join(dir, `visible-${kind}-${label}-${n}.png`) });
            await visible(page, '[data-care-reading-start]');
          }
          // Authoritative reads must not replay the explicit navigation intent.
          await page.evaluate(() => scrollBy({ top: 90, behavior: 'instant' }));
          const position = await page.evaluate(() => scrollY), beforeReads = reads;
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          for (let i = 0; i < 100 && reads === beforeReads; i++) await wait(20);
          assert(reads > beforeReads, 'same-session read not completed');
          await wait(100); assert.equal(await page.evaluate(() => scrollY), position, 'read jumped the document');
          assert.equal(await focusedKey(page), focused, 'reading moved focus');
          // End-of-page content remains reachable with normal document scrolling.
          const end = kind === 'growth' ? '.growth-page-dots' : '.status-page-number';
          await page.locator(end).scrollIntoViewIfNeeded(); await visible(page, end);
          // Full-page diagnostic capture comes last; it can perturb mobile scrollY.
          if (capture && (n === 0 || n === 4 || kind === 'status')) await page.screenshot({ path: join(dir, `full-${kind}-${label}-${n}.png`), fullPage: true });
          await key(page, kind === 'growth' ? 'B' : 'A');
        }
        assert.equal(await page.locator(kind === 'growth' ? '.growth-panel' : '.screen-status').getAttribute(`data-${kind}-page`), '0');
        await visible(page, '[data-care-reading-start]');
        // The focused physical key remains usable via native Enter and Space.
        // Growth last used B; status last used A. Both flip this page.
        const focused = await focusedKey(page); assert(focused, 'physical key lost native focus');
        for (const [index, key] of ['Enter', 'Space'].entries()) {
          await page.keyboard.press(key); await visible(page, '[data-care-reading-start]');
          await visibleHeading(page, kind, (index + 1) % pages);
          assert.equal(await page.locator(kind === 'growth' ? '.growth-panel' : '.screen-status').getAttribute(`data-${kind}-page`), String((index + 1) % pages), 'native key must flip exactly once');
          assert.equal(await focusedKey(page), focused);
        }
        if (kind === 'growth') {
          assert((await page.locator('.lcd-bottom').innerText()).includes('A 上一页'));
          assert((await page.locator('.lcd-bottom').innerText()).includes('B 下一页'));
          // Starting at page 2 after native Enter/Space on B, reverse every
          // page. Scroll to each ending first, so A must reveal the new start.
          for (let step = 1; step <= pages; step++) {
            await page.locator('.growth-page-dots').scrollIntoViewIfNeeded();
            await key(page, 'A'); const expected = (2 - step + pages) % pages;
            assert.equal(await page.locator('.growth-panel').getAttribute('data-growth-page'), String(expected));
            await visible(page, '[data-care-reading-start]'); await visibleHeading(page, kind, expected); await readable(page, kind);
            const beforeReads = reads, position = await page.evaluate(() => scrollY);
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            for (let i = 0; i < 100 && reads === beforeReads; i++) await wait(20);
            assert(reads > beforeReads, 'reverse reading poll did not complete'); await wait(100);
            assert.equal(await page.locator('.growth-panel').getAttribute('data-growth-page'), String(expected));
            assert.equal(await page.evaluate(() => scrollY), position, 'reverse reading poll jumped');
            assert.equal(await focusedKey(page), 'a');
            if (capture && expected === 5) await page.screenshot({ path: join(dir, `reverse-growth-${label}.png`) });
          }
          // Native activation of a focused A also reverses exactly once.
          for (const [i, activation] of ['Enter', 'Space'].entries()) {
            await page.keyboard.press(activation); const expected = 1 - i;
            assert.equal(await page.locator('.growth-panel').getAttribute('data-growth-page'), String(expected));
            await visible(page, '[data-care-reading-start]'); assert.equal(await focusedKey(page), 'a');
          }
        }
        await key(page, kind === 'growth' ? 'C' : 'B'); await page.locator('.home-caption').waitFor();
      }
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preference); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      const after = (await api('state')).state;
      for (const field of ['species', 'hatchedAt', 'sleeping', 'careCount', 'economy', 'game']) assert.deepEqual(after[field], before[field]);
      assert.equal(after.growth.stage, stage); assert.equal(after.growth.form, before.growth.form);
      results.push({ type: 'real-http-reading-after-legacy-migration', stage, sleeping, ...mode, pages: 8, reverseGrowthPages: 6, nativeReading });
    } catch (e) { await page.screenshot({ path: join(dir, `failure-${label}.png`) }); throw e; }
    finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  console.error('Artifacts:', dir); if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await stopped; }
  await writeFile(join(dir, 'server.log'), log);
}
