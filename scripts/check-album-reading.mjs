// Real HTTP permanent album reading; isolated build, save and random port.
// --forms-only reruns the saved adult-form cases without the larger reading matrix.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
console.log(JSON.stringify({ testBuilds: { binary, web } }));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-album-reading-')), results = [];
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
  const problems = await page.locator('.content-album').evaluate(el => {
    const area = el.getBoundingClientRect(), footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), problems = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      // The reading hint is intentionally screen-reader-only until keyboard focus.
      if (text.parentElement.matches('[data-care-reading-start]') && getComputedStyle(text.parentElement).clipPath !== 'none') continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < area.left - 1 || box.right > area.right + 1 || box.top < area.top - 1 || box.bottom > Math.min(area.bottom, footer.top) + 1) problems.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) problems.push('clipped: ' + text.textContent);
        }
      }
    }
    return problems;
  });
  assert.deepEqual(problems, [], 'reading text clipped or overlaps footer');
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert(await page.locator('.lcd-bottom').evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), 'three-key directions clipped');
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
  const categories = ['all', 'growth', 'care', 'play', 'home', 'days', 'scenery'];
  const homeItems = { outfit: 'leaf-pin', decoration: 'clover-pot', wallpaper: 'meadow-wall', floor: 'honey-floor' };
  const catalog = (await api('state')).shop.catalog;
  const cases = [{ kind: 'home', sleeping: false }, { kind: 'home', sleeping: true }, { kind: 'fishing', sleeping: false }, { kind: 'walk', sleeping: false }];
  const readingModes = process.argv.includes('--forms-only') ? [] : modes;
  for (const mode of readingModes) for (const { kind, sleeping } of cases) for (const history of ['empty', 'saved']) {
    const at = Date.now();
    const fixture = (await api('import', { schema: 1, revision: 1, species: 2, name: '纪念伙伴',
      createdAt: at - 3600000, hatchedAt: at - 3500000, lastTick: at, sleeping,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] })).state;
    // Constructed legal care memories exercise longer card text; they are not
    // claimed as naturally played history. Saved scenery uses constructed discoveries
    // and must pass the real service import validation, not a response mock.
    for (const memory of ['meal', 'bath', 'goodnight']) fixture.album.entries.push({ kind: memory, at: fixture.lastTick, source: 'shared' });
    if (history === 'saved') {
      const at = fixture.lastTick;
      fixture.pond.fish = [{ id: 'reed-minnow', firstAt: at, lastAt: at, count: 1 }];
      fixture.park.finds = [{ id: 'leaf', firstAt: at, lastAt: at, count: 1 }];
      for (const kind of ['scenery-fishing-clear', 'scenery-walk-rain']) fixture.album.entries.push({ kind, at, source: 'shared' });
    }
    // Constructed first-use records with different current equipment. This is
    // layout/provenance coverage, not a claim of naturally earning all items.
    if (history === 'saved' && kind === 'home') {
      fixture.economy.owned = [...Object.values(homeItems), 'berry-scarf', 'moon-lamp', 'starlit-wall', 'mint-floor'];
      fixture.economy.equipped = { accessory: 'berry-scarf', room: 'moon-lamp', wallpaper: 'starlit-wall', floor: 'mint-floor' };
      for (const [kind, item] of Object.entries(homeItems)) fixture.album.entries.push({ kind, item, at: fixture.lastTick, source: 'shared' });
    }
    await api('import', fixture);
    if (kind !== 'home') {
      const game = (await api('action', { kind: kind === 'fishing' ? 'play-fishing' : 'play-walk' })).state.game;
      if (kind === 'fishing') await api('action', { kind: 'fish-pause', gameId: game.id, step: game.fishing.step });
    }
    const before = (await api('state')).state;
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), errors = [], writes = []; let reads = 0;
    const label = `${kind}-${sleeping}-${mode.width}-${mode.height}-${mode.font}-${history}`;
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', res => { if (['/api/state', '/api/visit'].includes(new URL(res.url()).pathname)) reads++; });
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    const current = '.album-directory [aria-current="true"]', header = '.album-panel > header';
    const pause = kind === 'fishing' ? '.fishing-pause' : '.walk-pause';
    async function stableRead() {
      await page.evaluate(() => scrollBy({ top: 70, behavior: 'instant' }));
      const position = await page.evaluate(() => scrollY), focus = await focusedKey(page), count = reads;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      for (let i = 0; i < 100 && reads === count; i++) await wait(20);
      assert(reads > count, 'authoritative read completed'); await wait(100);
      assert.equal(await page.evaluate(() => scrollY), position, 'ordinary sync moved reading');
      assert.equal(await focusedKey(page), focus, 'ordinary sync moved native focus');
    }
    try {
      console.log('RUN', label);
      await page.goto(base); await page.locator(kind === 'home' ? '.home-caption' : pause).waitFor();
      const preferences = await page.evaluate(() => JSON.stringify(localStorage));
      if (kind === 'home') {
        await key(page, 'A'); for (let i = 0; i < 8; i++) await key(page, 'A'); await key(page, 'B');
        await visible(page, current); await readable(page); await stableRead();
        // Cycle all seven rows and wrap, asserting directly after actual key taps.
        for (let n = 1; n <= categories.length; n++) {
          await key(page, 'A'); await visible(page, current);
          assert.equal(await page.locator('[data-album-directory]').getAttribute('data-album-directory'), categories[n % categories.length]);
          await readable(page);
        }
        for (const [n, category] of categories.entries()) {
          await key(page, 'B'); await visible(page, header); await readable(page);
          assert.equal(await page.locator('[data-album-page]').getAttribute('data-album-category'), category);
          const size = parseFloat(await page.locator('.album-panel > p').evaluate(el => getComputedStyle(el).fontSize));
          assert(Math.abs(size - mode.font * 12 / 14) < .1, 'actual paragraph font must double');
          const pages = Number((await page.locator('.album-panel > header > span').innerText()).split('/')[1]);
          for (let i = 0; i < pages; i++) {
            await page.locator('.album-source:last-child').scrollIntoViewIfNeeded(); await visible(page, '.album-source:last-child');
            await key(page, 'B'); await visible(page, header); await readable(page);
            assert.equal(await page.locator('.album-panel > header > span').innerText(), `${(i + 1) % pages + 1} / ${pages}`);
            const recorded = homeItems[await page.locator('[data-album-page]').getAttribute('data-album-kind')];
            if (recorded) {
              const expected = `当时选用：${catalog.find(item => item.id === recorded).name}`;
              assert.equal(await page.locator('.album-item').textContent(), expected);
              assert((await page.locator('[data-album-page]').ariaSnapshot()).includes(expected));
              await page.locator('.album-item').scrollIntoViewIfNeeded(); await visible(page, '.album-item');
            }
          }
          // Reverse the entire category, including cover-to-last and first-to-cover.
          for (let i = 0; i < pages; i++) {
            await page.locator('.album-source:last-child').scrollIntoViewIfNeeded();
            await key(page, 'A'); await visible(page, header); await readable(page);
            assert.equal(await page.locator('.album-panel > header > span').innerText(), `${(pages - i - 1) % pages + 1} / ${pages}`);
          }
          // Back/forward pairs must restore the exact selected page, not jump twice.
          await page.keyboard.press('a'); await page.keyboard.press('b'); await visible(page, header);
          assert.equal(await page.locator('[data-album-page]').getAttribute('data-album-page'), '0');
          if (n === 0) {
            await stableRead();
            await page.locator('.button-b').focus();
            for (const [i, k] of ['Enter', 'Space'].entries()) {
              await page.keyboard.press(k); await visible(page, header);
              assert.equal(await page.locator('.album-panel > header > span').innerText(), `${i + 2} / ${pages}`, 'native activation flips exactly once');
              assert.equal(await focusedKey(page), 'b', 'reading stole native key focus');
            }
            await page.locator('.button-a').focus();
            for (const [i, k] of ['Space', 'Enter'].entries()) {
              await page.keyboard.press(k); await visible(page, header);
              assert.equal(await page.locator('.album-panel > header > span').innerText(), `${2 - i} / ${pages}`, 'native A flips backwards exactly once');
              assert.equal(await focusedKey(page), 'a', 'reading stole native A focus');
            }
            await key(page, 'A'); await visible(page, header); await readable(page);
            assert.equal(await page.locator('[data-album-page]').getAttribute('data-album-page'), String(pages - 1));
            await page.screenshot({ path: join(dir, `card-${label}.png`) });
          }
          await page.locator('.album-source:last-child').scrollIntoViewIfNeeded();
          await key(page, 'C'); await visible(page, current);
          assert.equal(await page.locator('[data-album-directory]').getAttribute('data-album-directory'), category);
          if (n < categories.length - 1) { await key(page, 'A'); await visible(page, current); }
        }
        await page.screenshot({ path: join(dir, `directory-${label}.png`) });
        await key(page, 'C'); await page.locator('.home-caption').waitFor();
      } else {
        for (const k of ['A', 'A', 'A', 'B']) await key(page, k);
        await visible(page, header); await readable(page);
        assert.equal(await page.locator('[data-album-page]').getAttribute('data-album-category'), 'scenery');
        if (history === 'empty') assert((await page.locator('.album-panel').innerText()).includes('还没有留下风景手记'));
        else {
          assert.equal(await page.locator('.album-panel > header > span').innerText(), '1 / 3');
          for (const [k, expected] of [['A', 'scenery-walk-rain'], ['A', 'scenery-fishing-clear'], ['A', null], ['B', 'scenery-fishing-clear'], ['B', 'scenery-walk-rain'], ['B', null]]) {
            await page.locator('.album-source:last-child').scrollIntoViewIfNeeded(); await key(page, k);
            await visible(page, header); await readable(page);
            assert.equal(await page.locator('[data-album-page]').getAttribute('data-album-kind'), expected);
          }
        }
        await stableRead();
        for (const k of ['A', 'B']) {
          await page.locator('.album-source:last-child').scrollIntoViewIfNeeded();
          await key(page, k); await visible(page, header); await readable(page);
        }
        await page.screenshot({ path: join(dir, `scenery-${label}.png`) });
        await page.locator('.album-source:last-child').scrollIntoViewIfNeeded(); await key(page, 'C');
        // Very large pause menus can exceed a short viewport: require the title
        // and selected option, not an impossible fully-visible whole panel.
        await page.locator(pause).waitFor(); await visible(page, `${pause} > strong`);
        await visible(page, kind === 'fishing' ? '.fishing-pause li.selected' : '.walk-pause [data-selected="true"]');
        await page.screenshot({ path: join(dir, `pause-${label}.png`) });
        // Selection is preserved. B returns to scenery rather than resuming.
        await key(page, 'B'); await visible(page, header);
        await key(page, 'C'); await visible(page, `${pause} > strong`);
        await page.reload(); await page.locator(pause).waitFor();
      }
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preferences);
      const after = (await api('state')).state;
      for (const field of ['species', 'hatchedAt', 'sleeping', 'careCount', 'economy', 'game', 'album', 'pond', 'park', 'logs']) assert.deepEqual(after[field], before[field]);
      results.push({ ...mode, kind, sleeping, history: `constructed-care; ${history}-scenery` });
    } catch (error) { await page.screenshot({ path: join(dir, `failure-${label}.png`) }); throw error; }
    finally { await context.close(); }
  }
  // Constructed migrated adults verify saved form illustrations; this does not
  // represent natural multi-day growth. Import still uses real save validation.
  for (const mode of [modes[0], modes[2]]) for (const form of ['balanced', 'lively', 'gentle', 'easygoing']) {
    const at = Date.now(), age = 100 * 3600000;
    const fixture = (await api('import', { schema: 1, revision: 1, species: 2, name: '成长纪念',
      createdAt: at - age, hatchedAt: at - age, lastTick: at, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] })).state;
    fixture.growth.form = form; delete fixture.growth.formRecord;
    fixture.album.entries.find(memory => memory.kind === 'adult').form = form;
    const before = (await api('import', fixture)).state;
    // Legacy upgrades can give growing/adult the same timestamp; use the album's
    // actual chronological/tie-break order instead of assuming stage order.
    const cards = before.album.entries.filter(m => ['hatch', 'growing', 'adult'].includes(m.kind))
      .sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));
    const adultPage = cards.findIndex(m => m.kind === 'adult') + 1;
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [], label = `form-${form}-${mode.width}`;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    async function openGrowthAlbum() {
      await page.locator('.home-caption').waitFor();
      await key(page, 'A'); for (let i = 0; i < 8; i++) await key(page, 'A'); await key(page, 'B');
      await key(page, 'A'); await key(page, 'B');
      assert.equal(await page.locator('[data-album-page]').getAttribute('data-album-category'), 'growth');
    }
    async function checkForm() {
      const badge = page.locator(`[data-album-form="${form}"] .growth-form-emblem`);
      await badge.waitFor(); await badge.scrollIntoViewIfNeeded(); await visible(page, '.album-form');
      assert(await badge.evaluate(el => {
        const box = el.getBoundingClientRect(), row = el.closest('.album-picture').getBoundingClientRect();
        const pet = el.closest('.album-picture').querySelector('.pet-sprite').getBoundingClientRect();
        return box.width >= 20 && box.height >= 20 && box.left >= pet.right && box.top >= row.top && box.bottom <= row.bottom + 1;
      }), 'form emblem must remain visible beside the portrait');
      await readable(page);
      if (mode.font === 28) assert.equal(await badge.locator('path').first().evaluate(el => getComputedStyle(el).fill), 'rgb(0, 0, 0)');
    }
    try {
      console.log('RUN', label); await page.goto(base); await openGrowthAlbum(); await checkForm();
      for (const { kind } of cards) {
        await key(page, 'B'); assert.equal(await page.locator('[data-album-kind]').getAttribute('data-album-kind'), kind);
        if (kind === 'adult') await checkForm();
        else assert.equal(await page.locator('.album-form').count(), 0, 'earlier milestones must not inherit the adult form');
      }
      await key(page, 'B'); for (let i = 0; i < adultPage; i++) await key(page, 'B'); await checkForm();
      const names = { balanced: '均衡型', lively: '活力型', gentle: '恬静型', easygoing: '自在型' };
      assert((await page.locator('.album-panel').ariaSnapshot()).includes(names[form]));
      await page.keyboard.press('Tab'); await page.getByRole('region', { name: '永久纪念册阅读区' }).focus();
      assert.equal(await page.locator('.care-reading-hint').evaluate(el => getComputedStyle(el).clipPath), 'none');
      await readable(page);
      await page.locator('.album-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
      await key(page, 'A'); assert.equal(await page.locator('.album-form').count(), 0);
      await key(page, 'B'); await checkForm();
      await page.reload(); await openGrowthAlbum();
      for (let i = 0; i < adultPage; i++) await key(page, 'B'); await checkForm();
      assert.equal(await page.locator('[data-album-kind]').getAttribute('data-album-kind'), 'adult');
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      const after = (await api('state')).state;
      for (const field of ['careCount', 'economy', 'album']) assert.deepEqual(after[field], before[field]);
      assert.equal(after.growth.form, before.growth.form);
      results.push({ ...mode, kind: 'growth-portrait', form, source: 'constructed-migrated-adult', writes });
    } catch (error) { await page.screenshot({ path: join(dir, `failure-${label}.png`), fullPage: true }); throw error; }
    finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  console.error('Artifacts:', dir); if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await stopped; }
  await writeFile(join(dir, 'server.log'), log);
}
