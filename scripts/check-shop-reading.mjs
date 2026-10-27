// Real HTTP shop selection reading; isolated build, save and random port.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-shop-reading-')), results = [];
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
async function key(page, k) { await page.locator(`.button-${k.toLowerCase()}`).tap(); }
async function focusedKey(page) { return page.evaluate(() => ['a', 'b', 'c'].find(k => document.activeElement?.classList.contains(`button-${k}`)) ?? null); }
async function visible(page, selector) {
  await wait(100);
  const box = await page.locator(selector).boundingBox(), height = await page.evaluate(() => innerHeight);
  assert(box && box.y >= -1 && box.y + box.height <= height + 1, `${selector} outside native viewport: ${JSON.stringify(box)}`);
}
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow');
  const problems = await page.locator('.content-shop').evaluate(el => {
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
  const quantities = await page.locator('.shop-sections small').evaluateAll(elements => elements.map(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    return { id: el.closest('[data-section]').getAttribute('data-section'), text: el.textContent, lines: new Set([...range.getClientRects()].filter(r => r.width && r.height).map(r => Math.round(r.top))).size,
      clipped: el.scrollWidth > el.clientWidth + 1, font: parseFloat(getComputedStyle(el).fontSize), rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize) };
  }));
  assert.equal(quantities.length, await page.locator('.shop-panel[data-shop-category=directory]').count() ? 8 : 0);
  assert(quantities.every(q => q.lines === 1 && !q.clipped && q.font >= q.rootFont * .85), `quantity split or clipped: ${JSON.stringify(quantities)}`);
  assert(quantities.every(q => (q.id === 'daily' ? /^\+\d+ 币$/ : /^\d+ 件$/).test(q.text)), 'amount units missing or swapped');
  if (quantities.length) {
    const layout = await page.locator('.shop-sections').evaluate(el => ({
      columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
      rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
    }));
    if (layout.rootFont === 28) assert.equal(layout.columns, 1, 'large text needs one full-width category per row');
  }
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
  // Put mobile first so the old build demonstrates the small-screen failure.
  const modes = [{ width: 320, height: 700, font: 28 }, { width: 1200, height: 700, font: 14 }, { width: 320, height: 380, font: 28 },
    { width: 320, height: 700, font: 14, smoke: true }, { width: 390, height: 700, font: 14, smoke: true }];
  const sections = ['daily', 'all', 'seasonal', 'accessory', 'room', 'wallpaper', 'floor', 'owned'];
  const current = '.shop-sections [aria-current="true"]';
  const announcementsOnly = process.argv.includes('--announcements-only');
  for (const mode of modes.filter(m => !announcementsOnly || m.width === 1200 || m.height === 380))
  for (const stage of announcementsOnly || mode.smoke ? ['baby'] : ['baby', 'growing', 'adult'])
  for (const kind of announcementsOnly || mode.smoke ? ['funded'] : ['funded', 'poor', 'sleeping']) {
    const at = Date.now(), age = stage === 'adult' ? 80 : stage === 'growing' ? 30 : 1;
    const fixture = (await api('import', { schema: 1, revision: 1, species: 2, name: '看清再购买',
      createdAt: at - age * 3600000, hatchedAt: at - age * 3600000, lastTick: at, sleeping: kind === 'sleeping',
      needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [] })).state;
    // Constructed wallet and ownership for UI coverage, not earned resources.
    fixture.economy.coins = kind === 'poor' ? 0 : 500;
    fixture.economy.owned = []; await api('import', fixture);
    const before = (await api('state')).state;
    assert.equal(before.growth.stage, stage);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), errors = [], writes = []; let reads = 0;
    const label = `${stage}-${kind}-${mode.width}-${mode.height}-${mode.font}`;
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', res => { if (['/api/state', '/api/visit'].includes(new URL(res.url()).pathname)) reads++; });
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push({ path: new URL(req.url()).pathname, body: req.postDataJSON() }); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    async function selection(n) {
      await visible(page, current); // Never scroll in the harness before asserting the explicit-navigation target.
      assert.equal(await page.locator(current).getAttribute('data-section'), sections[n]); await readable(page);
      const title = (await page.locator(current + ' > span').innerText()).replace(/^[▸·]\s*/, '');
      const live = page.locator('.shop-decision');
      assert((await live.textContent()).includes(`第 ${n + 1} / ${sections.length} 项，${title}`));
      assert.equal(await live.getAttribute('aria-live'), 'polite'); assert.equal(await live.getAttribute('aria-atomic'), 'true');
    }
    async function announcedItem() {
      const title = await page.locator('.shop-panel h3').evaluate(el => el.firstChild.textContent);
      const text = await page.locator('.shop-decision').textContent();
      assert(text.includes(title === '这里还空着呢' ? '暂无物品' : title), text);
      assert.equal(await page.locator('.shop-decision').count(), 1);
    }
    async function stableRead({ shop = true } = {}) {
      if (shop) await page.locator('.shop-decision').evaluate(el => {
        const record = window.__shopAnnouncement = { el, text: el.textContent, mutations: 0 };
        record.observer = new MutationObserver(records => { record.mutations += records.length; });
        record.observer.observe(el, { subtree: true, childList: true, characterData: true });
      });
      await page.evaluate(() => scrollBy({ top: 70, behavior: 'instant' }));
      const position = await page.evaluate(() => scrollY), focus = await focusedKey(page), count = reads;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      for (let i = 0; i < 100 && reads === count; i++) await wait(20);
      assert(reads > count, 'authoritative read completed'); await wait(100);
      assert.equal(await page.evaluate(() => scrollY), position, 'ordinary sync moved reading');
      assert.equal(await focusedKey(page), focus, 'ordinary sync moved native focus');
      if (shop) assert(await page.locator('.shop-decision').evaluate(el => {
        const record = window.__shopAnnouncement; record.observer.disconnect();
        return record.el === el && record.text === el.textContent && record.mutations === 0;
      }), 'Ordinary reads must not replace or rewrite the choice announcement');
    }
    try {
      console.log('RUN', label); await page.goto(base); await page.locator('.home-caption').waitFor();
      const preferences = await page.evaluate(() => JSON.stringify(localStorage));
      await key(page, 'A'); for (let i = 0; i < 9; i++) await key(page, 'A'); await key(page, 'B'); await selection(0);
      await page.screenshot({ path: join(dir, `directory-${label}.png`), fullPage: true });
      const font = parseFloat(await page.locator('.shop-panel p').first().evaluate(el => getComputedStyle(el).fontSize));
      assert(Math.abs(font - mode.font * 12 / 14) < .1, 'actual shop text must respect doubled root size');
      await stableRead();
      for (let n = 1; n < sections.length; n++) {
        await key(page, 'A'); await selection(n); await key(page, 'B');
        await visible(page, '.shop-panel h3'); await readable(page); await announcedItem();
        const count = await page.locator('.shop-panel').getAttribute('data-shop-category'); assert.equal(count, sections[n]);
        await stableRead();
        if (sections[n] !== 'owned') {
          const first = await page.locator('.shop-panel h3').innerText();
          await page.locator('.shop-footer').scrollIntoViewIfNeeded(); await visible(page, '.shop-footer');
          await key(page, 'A'); await visible(page, '.shop-panel h3'); await readable(page);
          assert.notEqual(await page.locator('.shop-panel h3').innerText(), first);
          if (kind === 'funded') {
            await key(page, 'B'); assert.equal(await page.locator('.shop-panel').getAttribute('data-confirm'), 'true');
            await visible(page, '.shop-decision'); assert((await page.locator('.shop-decision').innerText()).includes('确认花'));
            await stableRead();
            await key(page, n % 2 ? 'A' : 'C'); assert.equal(await page.locator('.shop-panel').getAttribute('data-confirm'), 'false');
            await visible(page, '.shop-panel h3');
          } else {
            await key(page, 'B'); await visible(page, '.shop-decision');
            assert((await page.locator('.shop-decision').innerText()).includes(kind === 'poor' ? '还差' : '安心睡'));
            assert.equal(await page.locator('.shop-panel').getAttribute('data-confirm'), 'false');
          }
        } else assert((await page.locator('.shop-panel h3').innerText()).includes('空着'));
        await key(page, 'C'); await selection(n);
      }
      await key(page, 'A'); await selection(0);
      await key(page, 'A'); await selection(1);
      // Browser-native Enter/Space stay on A and advance once, without focus tricks.
      for (const [i, k] of ['Enter', 'Space'].entries()) {
        await page.keyboard.press(k); await selection(i + 2); assert.equal(await focusedKey(page), 'a');
      }
      await page.screenshot({ path: join(dir, `shop-${label}.png`) }); await stableRead();
      await key(page, 'C'); await page.locator('.home-caption').waitFor();
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preferences);
      const after = (await api('state')).state;
      for (const field of ['species', 'hatchedAt', 'sleeping', 'careCount', 'economy', 'game', 'album', 'pond', 'park', 'logs']) assert.deepEqual(after[field], before[field]);
      if (kind === 'funded') {
        // Now execute an actual two-step buy and toggle equipment on this temporary save.
        await key(page, 'A'); for (let i = 0; i < 9; i++) await key(page, 'A'); await key(page, 'B');
        for (let i = 0; i < sections.indexOf('accessory'); i++) await key(page, 'A');
        await key(page, 'B'); await visible(page, '.shop-panel h3');
        await key(page, 'B'); await visible(page, '.shop-decision');
        assert((await page.locator('.shop-decision').innerText()).includes('确认花 12 金币购买「嫩叶胸针」'));
        await readable(page); await page.screenshot({ path: join(dir, `quote-${label}.png`) });
        assert.deepEqual(writes, [], 'first B must never purchase');
        async function action() {
          const settled = page.waitForResponse(res => new URL(res.url()).pathname === '/api/action');
          await key(page, 'B'); const res = await settled; assert(res.ok(), await res.text());
          await page.waitForFunction(() => !document.querySelector('.button-b').disabled);
          await visible(page, '.shop-decision'); await announcedItem();
        }
        await action();
        await page.waitForFunction(() => document.querySelector('.shop-panel')?.getAttribute('data-confirm') === 'false');
        let economic = (await api('state')).state.economy;
        assert.equal(economic.coins, 488); assert(economic.owned.includes('leaf-pin')); assert.equal(economic.equipped.accessory, '');
        await stableRead(); assert.equal(writes.length, 1, 'sync never repeats the buy');
        await action(); economic = (await api('state')).state.economy;
        assert.equal(economic.coins, 488); assert.equal(economic.equipped.accessory, 'leaf-pin');
        await action(); economic = (await api('state')).state.economy;
        assert.equal(economic.coins, 488); assert.equal(economic.equipped.accessory, '');
        assert.deepEqual(writes.map(write => write.body.kind), ['buy', 'equip', 'equip']);
        assert(writes.every(write => write.body.item === 'leaf-pin'));
        await page.reload(); await page.locator('.home-caption').waitFor(); await stableRead({ shop: false });
        assert.equal(writes.length, 3, 'reload never repeats economics');
        assert.deepEqual((await api('state')).state.economy, economic);
        await key(page, 'A'); for (let i = 0; i < 9; i++) await key(page, 'A'); await key(page, 'B');
        for (let i = 0; i < sections.indexOf('owned'); i++) await key(page, 'A'); await selection(sections.indexOf('owned'));
        assert.equal(await page.locator('[data-section=owned] .shop-quantity').innerText(), '1 件');
        assert.equal(writes.length, 3, 'count reading never repeats economics');
      }
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preferences);
      results.push({ ...mode, stage, kind, history: 'schema1 age migration and constructed wallet/ownership; funded executes real buy/equip/unequip, never daily' });
    } catch (error) { await page.screenshot({ path: join(dir, `failure-${label}.png`) }); throw error; }
    finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  console.error('Artifacts:', dir); if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await stopped; }
  await writeFile(join(dir, 'server.log'), log);
}
