// Real untimed treasure completions: acknowledged page-local results, isolated HTTP/DB.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-game-outcome-')), results = [];
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
async function settledScroll(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    let previous = scrollY, stable = 0;
    const deadline = performance.now() + 3000;
    function frame() {
      stable = scrollY === previous ? stable + 1 : 0; previous = scrollY;
      if (stable >= 12) return resolve(scrollY);
      if (performance.now() > deadline) return reject(new Error('Native reading scroll did not settle'));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }));
}
async function nativeReceiptStop(page, region) {
  // Reach the physical C and then the receipt through the native Tab order;
  // do not activate a key or synthesize focus on the reading stop.
  for (let i = 0; i < 15 && !await page.locator('.button-c').evaluate(el => el === document.activeElement); i++)
    await page.keyboard.press('Tab');
  assert(await page.locator('.button-c').evaluate(el => el === document.activeElement));
  for (let i = 0; i < 8 && !await region.evaluate(el => el === document.activeElement); i++)
    await page.keyboard.press('Shift+Tab');
  assert(await region.evaluate(el => el === document.activeElement), 'Native Tab must reach the game receipt');
  assert.equal(await region.getAttribute('tabindex'), '0');
  assert.match(await page.locator(`[id="${await region.getAttribute('aria-describedby')}"]`).innerText(), /Enter 不操作/);
  assert.deepEqual(await region.evaluate(el => { const css = getComputedStyle(el); return [css.outlineWidth, css.outlineStyle]; }), ['2px', 'solid']);
}
// Native document scrolling, including every line at double root font size.
async function reachableLines(page, selector) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  await page.locator(selector).evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      const lines = Array.from(range.getClientRects(), r => ({top:r.top + scrollY,left:r.left,width:r.width,height:r.height}));
      for (const line of lines) {
        window.scrollTo({top:line.top - 12,behavior:'instant'});
        const top = line.top - scrollY, hit = document.elementFromPoint(line.left + line.width / 2, top + line.height / 2);
        if (line.left < -1 || line.left + line.width > innerWidth + 1 || top < 0 || top + line.height > innerHeight || !hit || !text.parentElement.contains(hit))
          throw new Error('Result line is clipped or unreachable: ' + text.textContent);
      }
    }
  });
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const cases = [
    { ...modes[2], exhausted: true, familiarity: 'cooldown' },
    { ...modes[0], exhausted: true, familiarity: 'cooldown', playHabit: 'credited' },
    ...modes.flatMap(mode => [false, true].map(exhausted => ({ ...mode, exhausted, familiarity: 'credited' }))),
    { ...modes[2], exhausted: true, familiarity: 'familiar' },
  ];
  for (const mode of cases) {
    const { exhausted, familiarity, playHabit = 'cooldown' } = mode;
    const at = Date.now();
    const initial = await api('import', { schema: 1, species: 2, name: '把陪玩收好', createdAt: at - 4 * 3600000,
      hatchedAt: at - 4 * 3600000, lastTick: at, sleeping: false, needs: { hunger: 70, mood: 70, energy: 80, clean: 80 }, careCount: 0, logs: [] });
    const fixture = initial.state;
    fixture.economy.lastGameAt = initial.serverTime;
    fixture.economy.gameCoins = exhausted ? initial.shop.gameDailyLimit : 0;
    fixture.economy.coins = 12;
    // Explicit imported history, not natural multi-hour play. Finish below is real.
    fixture.growth.care.play = 1;
    fixture.growth.care.lastPlay = initial.serverTime - (playHabit === 'credited' ? 31 * 60000 : 60000);
    fixture.companion.since = fixture.createdAt;
    if (familiarity !== 'credited') {
      const interest = fixture.companion.interests.find(i => i.kind === 'treasure');
      interest.points = familiarity === 'familiar' ? 5 : 1;
      interest.lastAt = initial.serverTime - 20 * 60000;
      fixture.companion.recent = { kind: 'treasure', id: 'a'.repeat(32), at: interest.lastAt };
    }
    await api('import', fixture);
    const before = (await api('state')).state;
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = `${font}px`; localStorage.setItem('pixelpet-guide-v1-treasure', 'seen');
    }), mode.font);
    const page = await context.newPage(), errors = [], writes = [];
    const label = `${familiarity}-${playHabit}-${exhausted ? 'zero' : 'available'}-${mode.width}-${mode.height}-${mode.font}`;
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    page.on('request', r => { if (r.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(r.url()).pathname)) writes.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor();
      assert.equal(await page.locator('.game-outcome').count(), 0);
      for (const k of ['A', 'A', 'B']) await key(page, k);
      for (let i = 0; i < 6; i++) await key(page, 'A');
      await key(page, 'B'); await page.locator('.game-guide').waitFor(); await key(page, 'B');
      await page.locator('.treasure-game').waitFor(); await key(page, 'C'); // deliberate resume
      for (let i = 0; i < 6; i++) {
        await key(page, 'B');
        const hunt = (await api('state')).state.game.treasure;
        if (hunt.opened.length >= 6 || hunt.opened.filter(tile => hunt.layout[tile] > 0).length === 3) break;
      }
      await page.locator('.treasure-game[data-done="true"]').waitFor();
      const gameId = (await api('state')).state.game.id;
      const finishResponse = page.waitForResponse(r => r.url() === `${base}/api/action` && r.request().postDataJSON().kind === 'treasure-finish');
      await page.evaluate(() => {
        window.resultFocusTargets = [];
        document.addEventListener('focusin', e => window.resultFocusTargets.push(e.target.matches('.button-b')), {capture:true});
      });
      await key(page, 'B'); const confirmed = await (await finishResponse).json();
      const receipt = page.getByLabel('本页最近一次游戏结算'); await receipt.waitFor();
      // Check before any test scrolling: being reachable later is not enough.
      const headingLocator = receipt.locator(':scope > h3');
      const heading = await headingLocator.boundingBox();
      assert(heading && heading.y >= 0 && heading.y + heading.height <= mode.height,
        `New receipt heading is outside viewport: ${JSON.stringify(heading)}`);
      assert(await headingLocator.evaluate(el => {
        const b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return !!hit && el.contains(hit);
      }), 'New receipt heading must not be covered');
      // Chrome may natively blur a key while the HTTP write disables it.
      // Do not require forced focus restoration; receipt navigation adds none.
      assert(await page.evaluate(() => window.resultFocusTargets.every(Boolean)), 'Receipt must not steal focus');
      await page.screenshot({path:join(dir, `${label}-initial-viewport.png`)});
      console.log('PLACEMENT', label, JSON.stringify(heading));
      assert.equal(await receipt.locator('.game-outcome-message').innerText(), confirmed.message);
      assert.equal(await receipt.locator(':scope > time').getAttribute('datetime'), new Date(confirmed.serverTime).toISOString());
      assert.equal(confirmed.state.companion.recent.id, gameId);
      assert.match(await receipt.innerText(), /本局共同游戏已记录/);
      assert.equal(confirmed.gameReceipt.interest.reason, familiarity);
      assert.equal(confirmed.gameReceipt.interest.gameId, gameId);
      const interestPanel = receipt.getByLabel('本局游戏熟悉度');
      assert.match(await interestPanel.innerText(), familiarity === 'credited' ? /本局熟悉度 \+1/ : familiarity === 'cooldown' ? /仍在 30 分钟间隔内/ : /熟悉度已满/);
      assert.match(await interestPanel.innerText(), /熟悉度按每款游戏分别记录/);
      const learning = receipt.getByLabel('本次成长与习惯');
      assert.equal(confirmed.careFeedback.reason, playHabit);
      assert.equal(confirmed.careFeedback.habitGain, playHabit === 'credited' ? 1 : 0, 'Familiarity is independent of shared habit cooldown');
      assert.equal(confirmed.careFeedback.points, playHabit === 'credited' ? .25 : 0);
      assert.equal(confirmed.state.growth.care.play, before.growth.care.play + (playHabit === 'credited' ? 1 : 0));
      const minutesAtReceipt = retryAt => Math.max(1, Math.ceil((retryAt - confirmed.serverTime) / 60000));
      if (familiarity === 'cooldown') {
        const minutes = minutesAtReceipt(confirmed.gameReceipt.interest.retryAt);
        assert((await interestPanel.innerText()).includes(`这款游戏的熟悉度：记录时约还需 ${minutes} 分钟`), 'A care receipt must not hide familiarity timing');
        if (playHabit === 'cooldown') assert.notEqual(minutes, minutesAtReceipt(confirmed.careFeedback.retryAt), 'Imported fixture must have different historical interval boundaries');
      } else assert.equal(await interestPanel.locator('.game-interest-next').count(), 0);
      if (playHabit === 'cooldown') assert((await learning.innerText()).includes(`记录时约还需 ${minutesAtReceipt(confirmed.careFeedback.retryAt)} 分钟`));
      else assert((await learning.innerText()).includes('本次成长：+0.25 点'));
      assert(!confirmed.state.game);
      if (exhausted) assert.equal(confirmed.state.economy.coins, before.economy.coins);
      else assert(confirmed.state.economy.coins > before.economy.coins);
      const text = await receipt.innerText(), count = writes.length;
      // Respect a player's native reading position after the one-shot jump.
      // Expire the short message (4.2s), animation and care feedback (8s).
      await page.evaluate(() => window.scrollTo({top:0,behavior:'instant'}));
      const readingY = await page.evaluate(() => scrollY);
      await wait(8500);
      assert.equal(await page.evaluate(() => scrollY), readingY, 'Feedback expiry must not replay receipt navigation');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await wait(250); assert.equal(await receipt.innerText(), text);
      assert.equal(await page.evaluate(() => scrollY), readingY, 'Ordinary sync must not replay receipt navigation');
      const region = page.getByRole('region', { name: '游戏结算阅读区' });
      await nativeReceiptStop(page, region);
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.care-menu').count(), 0, 'Reading Enter must not open the menu');
      const movements = [];
      await page.keyboard.press('Home'); await settledScroll(page);
      for (const [key, direction] of [['ArrowDown', 1], ['Space', 1], ['Shift+Space', -1], ['End', 1], ['PageUp', -1]]) {
        const before = await settledScroll(page);
        await page.keyboard.press(key); const after = await settledScroll(page);
        assert((after - before) * direction > 0, `${key} must scroll natively: ${before} -> ${after}`);
        assert(await region.evaluate(el => el === document.activeElement), 'Reading must keep focus');
        movements.push({ key, before, after });
      }
      const position = await settledScroll(page);
      await region.evaluate(el => el.dataset.syncProbe = 'same-node');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(250);
      assert.equal(await region.getAttribute('data-sync-probe'), 'same-node');
      assert(await region.evaluate(el => el === document.activeElement));
      assert.equal(await settledScroll(page), position, 'Sync must preserve focused reading position');
      assert.equal(writes.length, count, 'Native reading must not submit an action');
      await page.screenshot({path:join(dir, `${label}-reading-viewport.png`)});
      await reachableLines(page, '.game-outcome');
      await page.screenshot({path:join(dir, `${label}.png`),fullPage:true});
      // Status first page also carries exactly the acknowledged receipt.
      await key(page, 'A'); for (let i = 0; i < 4; i++) await key(page, 'A'); await key(page, 'B');
      await page.locator('.screen-status').waitFor(); assert.equal(await receipt.innerText(), text);
      assert.equal(await page.getByRole('region', { name: '游戏结算阅读区' }).count(), 0, 'Status must not nest reading stops');
      await reachableLines(page, '.game-outcome');
      assert.equal(writes.length, count, 'reading/navigating the result must not write');
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
      // C returns from status first; a separate home C acknowledges the result.
      await key(page, 'C'); assert.equal(await receipt.innerText(), text);
      assert((await page.locator('.lcd-bottom').innerText()).includes('C 收起回执'));
      await nativeReceiptStop(page, region);
      const savedBeforeDismiss = (await api('state')).state;
      await page.keyboard.press('c');
      assert(await page.locator('.button-c').evaluate(el => el === document.activeElement), 'Dismissal returns focus to C');
      assert.equal(await region.count(), 0);
      assert.equal(await receipt.count(), 0, 'Home C dismisses the complete game receipt');
      assert.equal(await page.locator('.care-outcome,.toast').count(), 0);
      assert(!(await page.locator('.lcd-bottom').innerText()).includes('收起'));
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(250);
      assert.equal(await receipt.count(), 0, 'Ordinary reads must not reconstruct a dismissed result');
      const savedAfterDismiss = (await api('state')).state;
      for (const field of ['logs', 'album', 'economy', 'careCount', 'companion'])
        assert.deepEqual(savedAfterDismiss[field], savedBeforeDismiss[field], `Dismissal changed saved ${field}`);
      assert.equal(writes.length, count, 'Dismissing a result must not write');
      await page.screenshot({ path: join(dir, `${label}-dismissed.png`), fullPage: true });
      await page.reload(); await page.locator('.home-caption').waitFor();
      assert.equal(await receipt.count(), 0, 'never reconstruct historical result from a read');
      const reloaded = (await api('state')).state;
      assert.equal(reloaded.economy.coins, confirmed.state.economy.coins);
      assert.equal(reloaded.companion.recent.id, gameId);
      assert.deepEqual(errors, []); results.push({...mode,heading,movements,passed:true}); console.log('PASS', label);
    } catch (error) {
      await page.screenshot({path:join(dir, `${label}-failure.png`),fullPage:true}); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({groups:results.length,artifacts:dir,port}));
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log); console.log('Artifacts:', dir);
}
