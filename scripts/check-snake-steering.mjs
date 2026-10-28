// Real isolated HTTP sessions: paused reminders reflect saved relative turns.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { inspectBoardDescription } from './inspect-board-description.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-snake-steering-'));
const listener = createServer();
await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise(r => listener.close(r));
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const directions = ['右', '下', '左', '上'], results = [], journeys = [];
let server, browser, startupError, log = '';
async function api(path, data) {
  const response = await fetch(`${base}/api/${path}`, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const body = await response.json(); assert(response.ok, JSON.stringify(body)); return body;
}
async function key(page, letter) {
  await page.locator(`.button-${letter.toLowerCase()}:not(:disabled)`).waitFor();
  await page.keyboard.press(letter);
}
async function inspectRunningLayout(page) {
  const layout = await page.locator('.snake-game').evaluate(el => {
    const lcd = el.closest('.lcd-content').getBoundingClientRect();
    const footer = el.closest('.lcd').querySelector('.lcd-bottom').getBoundingClientRect();
    const errors = [];
    for (const part of el.querySelectorAll('header strong, header span, .snake-navigation-hint')) {
      const range = document.createRange(), walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim()) continue;
        range.selectNodeContents(node);
        for (const box of range.getClientRects()) {
          if (!box.width || !box.height) continue;
          if (box.left < lcd.left - 1 || box.right > lcd.right + 1) errors.push(`horizontal: ${node.textContent}`);
          if (box.top < lcd.top - 1 || box.bottom > footer.top + 1) errors.push(`vertical: ${node.textContent}`);
        }
      }
    }
    return { errors, shell: el.closest('.device').getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.deepEqual(layout.errors, []);
  assert(!layout.overflow, 'running game has horizontal overflow');
  assert(layout.shell <= 592, `running game stretched the device to ${layout.shell}px`);
}
async function inspect(page, mode, tag, heading) {
  const guide = page.getByRole('region', { name: '继续后的转弯方向' });
  await guide.waitFor();
  const saved = (await api("state")).state.game.snake;
  const board = await inspectBoardDescription(page, "snake", saved);
  assert.equal(await page.locator('.snake-progress').getAttribute('aria-live'), 'off');
  const position = await page.locator('.snake-paused-position').textContent();
  const head = saved.body[0], dx = saved.food.x - head.x, dy = saved.food.y - head.y;
  if (dx) assert(position.includes(`横向 ${Math.abs(dx)} 格`));
  if (dy) assert(position.includes(`纵向 ${Math.abs(dy)} 格`));
  const distance = [11 - head.x, 9 - head.y, head.x, head.y][saved.direction];
  assert(position.includes(distance === 0 ? '前面就是围栏，再直行一步会碰到' : `沿当前朝向，到围栏还有 ${distance} 格`));
  await guide.scrollIntoViewIfNeeded();
  const text = await guide.textContent();
  assert(text.includes(`蛇头现在朝${directions[heading]}`));
  assert(text.includes(`A 左转：朝${directions[(heading + 3) % 4]}`));
  assert(text.includes(`B 右转：朝${directions[(heading + 1) % 4]}`));
  assert.match(await page.locator('.snake-overlay').textContent(), /A \/ C 继续 · B 放弃确认/);
  const layout = await guide.evaluate(el => {
    const clipped = [], range = document.createRange(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (box.left < -1 || box.right > innerWidth + 1) clipped.push(node.textContent);
      }
    }
    return { clipped, font: parseFloat(getComputedStyle(el.querySelector('li')).fontSize),
      rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
      overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.deepEqual(layout.clipped, []); assert(!layout.overflow);
  assert(layout.font >= layout.rootFont * .85, 'reminder ignores enlarged root text');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  for (const rect of await page.locator('.physical-button').evaluateAll(els => els.map(el => {
    const box = el.getBoundingClientRect(); return { width: box.width, height: box.height };
  }))) assert(rect.width >= 44 && rect.height >= 44);
  await guide.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(dir, `${mode.name}-${tag}.png`), fullPage: true });
  results.push({ mode: mode.name, tag, heading, text, layout, board });
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { await api('state'); ready = true; break; } catch { await wait(50); }
  }
  assert(ready, log); browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const mode of [{ name: 'desktop', width: 1200, height: 850, font: 14 },
    { name: 'phone-large', width: 320, height: 480, font: 28, contrast: true }]) for (const turn of [-1, 1]) {
    const now = Date.now(), tag = turn < 0 ? 'left' : 'right';
    // Construct an ordinary healthy baby in this private database, then start a real game.
    await api('import', { schema: 1, revision: 1, species: 2, name: '转弯伙伴', createdAt: now - 3600000,
      hatchedAt: now - 3600000, lastTick: now, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    await api('action', { kind: 'play-snake', requestId: crypto.randomUUID() });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.contrast ? 'active' : 'none' });
    let held = null;
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      const page = await context.newPage(), writes = [], errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => {
        if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON());
      });
      await page.route('**/api/action', async route => {
        if (route.request().postDataJSON().kind !== 'snake-step' || !held) return route.continue();
        const current = held, response = await route.fetch({ maxRetries: 0 });
        current.result = await response.json(); current.request = route.request().postDataJSON();
        await current.releasePromise; await route.fulfill({ response });
      });
      await page.goto(base); await inspect(page, mode, `${tag}-0`, 0);
      for (let move = 1; move <= 3; move++) {
        let release;
        held = { releasePromise: new Promise(r => { release = r; }), release };
        await key(page, 'c'); await page.locator('.snake-overlay').waitFor({ state: 'hidden' });
        await page.locator('.snake-navigation-hint').waitFor();
        await inspectRunningLayout(page);
        assert.equal(await page.locator('.snake-steering-guide').count(), 0);
        assert.equal(await page.locator('.snake-navigation-hint').getAttribute('aria-live'), 'off');
        assert.equal(await page.locator('.snake-navigation-hint').getAttribute('role'), null);
        assert.equal(await page.locator('.snake-progress').getAttribute('aria-live'), 'polite');
        const opening = '第一颗果子在前方，先沿直线走';
        assert.equal((await page.locator('.snake-navigation-hint').textContent()).includes(opening), move === 1,
          'opening advice must follow the saved heading, including after reload');
        const progressBeforeStep = await page.locator('.snake-progress').textContent();
        const previousDescription = await page.locator(".snake-field desc").textContent();
        await key(page, turn < 0 ? 'a' : 'b');
        assert(!(await page.locator('.snake-navigation-hint').textContent()).includes(opening),
          'a queued turn must immediately withdraw straight-line advice');
        for (let i = 0; !held.result && i < 120; i++) await wait(25);
        assert(!(await page.locator('.snake-navigation-hint').textContent()).includes(opening),
          'a pending step must not restore straight-line advice before acknowledgement');
        assert(held.result, 'automatic step did not arrive'); assert.equal(held.request.turn, turn);
        const heading = (turn * move + 4) % 4;
        assert.equal(held.result.state.game.snake.direction, heading);
        assert.equal(await page.locator(".snake-field desc").textContent(), previousDescription, "unacknowledged movement changed the board description");
        if (move === 1) await page.screenshot({ path: join(dir, `${mode.name}-${tag}-pending.png`), fullPage: true });
        // Pause during a real persisted step whose acknowledgement is held in transit.
        await key(page, 'c');
        held.release(); held = null;
        await page.waitForFunction(heading => document.querySelector('.snake-steering-guide strong')?.textContent === `蛇头现在朝${heading}`,
          directions[heading]);
        for (let i = 0; !(await api('state')).state.game.snake.paused && i < 100; i++) await wait(20);
        const before = (await api('state')).state;
        assert(before.game.snake.paused); assert.equal(before.game.snake.step, move);
        assert.equal(await page.locator('.snake-progress').textContent(), progressBeforeStep, 'a normal move changed live fruit progress');
        await inspect(page, mode, `${tag}-${move}`, heading);
        const written = writes.length;
        await page.locator('.button-b:not(:disabled)').tap(); await page.locator('.game-abandon').waitFor();
        await key(page, 'c'); await page.locator('.snake-steering-guide').waitFor();
        await page.reload(); await page.locator('.snake-steering-guide').waitFor();
        await wait(800);
        assert.equal(writes.length, written, 'reminder, cancel confirmation or reload sent an action');
        assert.equal((await api('state')).state.game.snake.direction, heading);
        assert.deepEqual((await api('state')).state.game, before.game);
        await inspectBoardDescription(page, "snake", before.game.snake);
      }
      assert.deepEqual(writes.map(w => w.kind), Array.from({ length: 3 }, () => ['snake-resume', 'snake-step', 'snake-pause']).flat());
      // B still means abandon confirmation while paused, not a right turn.
      await key(page, 'b'); await page.locator('.game-abandon').waitFor();
      await key(page, 'b'); await page.locator('.content-home').waitFor();
      const after = (await api('state')).state;
      assert(!after.game); assert.equal(after.economy.coins, 0); assert.equal(after.careCount, 0);
      assert.equal(writes.at(-1).kind, 'cancel-play'); assert.deepEqual(errors, []);
      journeys.push({ mode: mode.name, turn, writes, coins: after.economy.coins, careCount: after.careCount });
    } finally { held?.release(); await context.close(); }
  }
  // Model an older saved opening with a random fruit. Only this private test
  // save is edited. Import intentionally clears games, so seed the private DB
  // to model reopening an existing session instead of restoring a backup.
  for (const mode of [{ name: 'desktop', width: 1200, height: 850, font: 14 },
    { name: 'phone-large', width: 320, height: 480, font: 28 }]) {
    await api('action', { kind: 'play-snake', requestId: crypto.randomUUID() });
    const fixture = (await api('state')).state;
    fixture.game.snake.food = { x: 9, y: 9 };
    const db = new DatabaseSync(join(dir, 'test.db'));
    try { db.prepare('UPDATE saves SET body=? WHERE id=1').run(JSON.stringify(fixture)); } finally { db.close(); }
    assert.deepEqual((await api('state')).state.game.snake.food, { x: 9, y: 9 });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      const page = await context.newPage();
      await page.goto(base); await page.locator('.snake-steering-guide').waitFor();
      await key(page, 'c'); await page.locator('.snake-navigation-hint').waitFor();
      const text = await page.locator('.snake-navigation-hint').textContent();
      assert(!text.includes('先沿直线走')); assert(text.includes('果子在右下方'));
      await page.screenshot({ path: join(dir, `${mode.name}-legacy-running.png`), fullPage: true });
      await key(page, 'c'); await page.locator('.snake-steering-guide').waitFor();
      const before = (await api('state')).state;
      await page.reload(); await page.locator('.snake-steering-guide').waitFor();
      assert.deepEqual((await api('state')).state.game, before.game);
      assert.deepEqual(before.game.snake.food, { x: 9, y: 9 });
      await page.screenshot({ path: join(dir, `${mode.name}-legacy-opening.png`), fullPage: true });
      await key(page, 'b'); await page.locator('.game-abandon').waitFor();
      await key(page, 'b'); await page.locator('.content-home').waitFor();
      results.push({ mode: mode.name, tag: 'legacy-opening', text, fixture: 'constructed random first fruit' });
    } finally { await context.close(); }
  }
  // Ordinary automatic movement to the fence: detailed coordinates keep
  // changing, but the concise warning is written once throughout 2/1/0 cells.
  const at = Date.now();
  await api('import', { schema: 1, revision: 1, species: 2, name: '围栏提醒测试', createdAt: at - 3600000,
    hatchedAt: at - 3600000, lastTick: at, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
  await api('action', { kind: 'play-snake', requestId: crypto.randomUUID() });
  const ctx = await browser.newContext(), page = await ctx.newPage();
  try {
    await page.goto(base); await page.locator('.snake-overlay').waitFor();
    await page.evaluate(() => {
      window.snakeReading = { warnings: [], progress: [], distances: [] };
      const warning = document.querySelector('.snake-boundary-announcement');
      const progress = document.querySelector('.snake-progress');
      new MutationObserver(() => window.snakeReading.warnings.push(warning.textContent))
        .observe(warning, { childList: true, characterData: true, subtree: true });
      new MutationObserver(() => window.snakeReading.progress.push({ text: progress.textContent, live: progress.getAttribute('aria-live') }))
        .observe(progress, { childList: true, characterData: true, subtree: true });
      new MutationObserver(() => {
        const hint = document.querySelector('.snake-navigation-hint');
        const match = hint?.textContent.match(/前方还有 (\d+) 格到围栏/);
        if (match) window.snakeReading.distances.push(Number(match[1]));
      }).observe(document.querySelector('.snake-game'), { childList: true, characterData: true, subtree: true });
    });
    await key(page, 'c');
    await page.locator('.snake-navigation-hint').waitFor();
    assert.equal(await page.locator('.snake-navigation-hint').getAttribute('aria-live'), 'off');
    await page.getByText('休息一下再来', { exact: true }).waitFor();
    const saved = (await api('state')).state, reading = await page.evaluate(() => window.snakeReading);
    assert.equal(saved.game.snake.end, 'wall');
    assert.equal(reading.warnings.filter(Boolean).length, 1);
    for (const distance of [2, 1, 0]) assert(reading.distances.includes(distance), `missing real fence distance ${distance}`);
    assert.equal(reading.progress.length, saved.game.snake.eaten);
    assert(reading.progress.length >= 1, 'first genuine fruit was not collected');
    assert(reading.progress.every(event => event.live === 'polite'));
    assert.equal(await page.locator('.snake-progress').getAttribute('aria-live'), 'off');
    assert.equal(saved.careCount, 0); assert.equal(saved.economy.coins, 0);
    results.push({ mode: 'desktop', tag: 'straight-fence', reading, eaten: saved.game.snake.eaten });
  } finally { await ctx.close(); }
  // Construct valid contiguous coils only in the private database. Freeze the
  // browser clock to inspect a single 650ms beat; the real server still enforces
  // its own clock, collision rules and expected-step checks.
  for (const mode of [{ name: 'desktop', width: 1200, height: 850, font: 14 },
    { name: 'phone-large', width: 320, height: 480, font: 28, contrast: true }]) {
    for (const scenario of ['body', 'turn-away', 'vacating-tail']) {
      const at = Date.now();
      await api('import', { schema: 1, revision: 1, species: 2, name: '蛇身提醒测试', createdAt: at - 3600000,
        hatchedAt: at - 3600000, lastTick: at, sleeping: false,
        needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
      await api('action', { kind: 'play-snake', requestId: crypto.randomUUID() });
      const fixture = (await api('state')).state, snake = fixture.game.snake;
      snake.body = scenario === 'vacating-tail'
        ? [{ x: 4, y: 5 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 5 }]
        : [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 3, y: 4 }, { x: 4, y: 4 },
          { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }];
      Object.assign(snake, { eaten: snake.body.length - 3, step: 20,
        direction: scenario === 'vacating-tail' ? 1 : 0, food: { x: 9, y: 9 } });
      const db = new DatabaseSync(join(dir, 'test.db'));
      try { db.prepare('UPDATE saves SET body=? WHERE id=1').run(JSON.stringify(fixture)); } finally { db.close(); }
      assert.deepEqual((await api('state')).state.game.snake, snake, 'fixture was rejected or changed');
      const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
        reducedMotion: 'reduce', forcedColors: mode.contrast ? 'active' : 'none' });
      let release;
      try {
        await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.fontSize = `${font}px`;
        }), mode.font);
        const page = await context.newPage(), writes = [];
        await page.clock.install({ time: Date.now() }); await page.clock.pauseAt(Date.now() + 50);
        const releasePromise = new Promise(r => { release = r; });
        let stepResult;
        await page.route('**/api/action', async route => {
          const command = route.request().postDataJSON(); writes.push(command.kind);
          if (command.kind !== 'snake-step') return route.continue();
          const response = await route.fetch({ maxRetries: 0 }); stepResult = await response.json();
          await releasePromise; await route.fulfill({ response });
        });
        await page.goto(base); await page.locator('.snake-steering-guide').waitFor();
        await key(page, 'c'); await page.locator('.snake-navigation-hint').waitFor();
        // The frozen clock also freezes toast expiry. Close the existing
        // external notice through its normal UI before inspecting the board.
        await page.getByRole('button', { name: '关闭提示', exact: true }).click({ force: true });
        if (scenario !== 'vacating-tail') {
          assert.equal(await page.locator('.snake-body-warning').count(), 1);
          assert.equal(await page.locator('.snake-body-warning').getAttribute('d'), 'M63 63l6 6m0 -6l-6 6');
        }
        if (scenario === 'turn-away') await key(page, 'b');
        if (scenario === 'vacating-tail') await key(page, 'a');
        const dangerous = scenario === 'body';
        assert.equal(await page.locator('.snake-body-warning').count(), Number(dangerous));
        const text = await page.locator('.snake-navigation-hint').textContent();
        assert.equal(text.includes('下一步会碰到蛇身'), dangerous);
        assert.equal((await page.locator('.snake-boundary-announcement').textContent()).includes('碰到蛇身'), dangerous);
        const layout = await page.locator('.snake-navigation-hint').evaluate(el => {
          const range = document.createRange(); range.selectNodeContents(el);
          const clips = [];
          for (const box of range.getClientRects()) {
            if (box.left < -1 || box.right > innerWidth + 1) clips.push('viewport');
            for (let p = el.parentElement; p; p = p.parentElement) {
              const css = getComputedStyle(p), rect = p.getBoundingClientRect();
              if (/hidden|clip/.test(css.overflowY) && (box.top < rect.top - 2 || box.bottom > rect.bottom + 2)) clips.push(p.className);
            }
          }
          const mark = document.querySelector('.snake-body-warning');
          const markBox = mark?.getBoundingClientRect();
          const visible = markBox && document.elementFromPoint(markBox.x + markBox.width / 2, markBox.y + markBox.height / 2) === mark;
          return { clips, overflow: document.documentElement.scrollWidth > innerWidth + 1,
            stroke: mark && getComputedStyle(mark).stroke, animation: mark && getComputedStyle(mark).animationName, visible };
        });
        assert.deepEqual(layout.clips, []); assert(!layout.overflow);
        if (dangerous) { assert.notEqual(layout.stroke, 'none'); assert.equal(layout.animation, 'none'); assert(layout.visible, 'mark is covered'); }
        assert.equal(await page.locator('.physical-button').count(), 3);
        assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
        await page.screenshot({ path: join(dir, `${mode.name}-${scenario}.png`), fullPage: true });
        assert.deepEqual(writes, ['snake-resume'], 'read-only warning or queued turn sent a move');
        assert.deepEqual((await api('state')).state.game.snake.body, snake.body);
        // Renew the real server lease after inspecting the frozen UI. No cell
        // moves here; advancing browser time must send exactly one real step.
        await api('action', { kind: 'snake-resume', gameId: fixture.game.id, step: snake.step, requestId: crypto.randomUUID() });
        await wait(650); await page.clock.runFor(700);
        for (let i = 0; i < 100 && !stepResult; i++) await wait(20);
        assert(stepResult?.state, 'real step did not complete');
        assert.equal(await page.locator('.snake-body-warning').count(), 0, 'stale mark remained while step was in flight');
        assert(!(await page.locator('.snake-boundary-announcement').textContent()).includes('碰到蛇身'));
        release();
        if (dangerous) {
          await page.locator('.snake-overlay').waitFor();
          assert.equal(stepResult.state.game.snake.end, 'body');
          assert.deepEqual(stepResult.state.game.snake.body, snake.body);
        } else {
          const target = scenario === 'vacating-tail' ? { x: 5, y: 5 } : { x: 4, y: 6 };
          await page.waitForFunction(({ x, y }) => document.querySelector('.snake-field desc')?.textContent.includes(`蛇头：${y + 1} 行 ${x + 1} 列`), target);
          assert(!stepResult.state.game.snake.end);
          assert.deepEqual(stepResult.state.game.snake.body[0], scenario === 'vacating-tail' ? { x: 5, y: 5 } : { x: 4, y: 6 });
        }
        assert.equal(stepResult.state.game.snake.step, snake.step + 1);
        assert.equal(stepResult.state.careCount, 0); assert.equal(stepResult.state.economy.coins, 0);
        assert.deepEqual(writes, ['snake-resume', 'snake-step']);
        results.push({ mode: mode.name, tag: scenario, fixture: 'constructed contiguous coil',
          clock: 'browser frozen for inspection, real server step', text, layout, end: stepResult.state.game.snake.end ?? null });
      } finally { release?.(); await context.close(); }
    }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ results, journeys }, null, 2));
  console.log(JSON.stringify({ passed: results.length, artifacts: dir }));
} finally {
  console.log('Artifacts:', dir); await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exited;
  }
}
