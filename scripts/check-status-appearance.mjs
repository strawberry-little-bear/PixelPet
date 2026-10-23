// Real HTTP / temporary SQLite / native Chrome. Constructed growth fixtures
// verify appearance continuity, not natural multi-day growth or physical phones.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-status-appearance-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const forms = { balanced: '均衡型', lively: '活力型', gentle: '恬静型', easygoing: '自在型' };
const modes = [
  { label: 'desktop', width: 1280, height: 900, font: 14 },
  { label: 'phone-large', width: 320, height: 568, font: 28 },
  { label: 'short-large', width: 320, height: 380, font: 28 },
  { label: 'contrast-large', width: 320, height: 568, font: 28, forcedColors: 'active' },
];
let server, browser, startupError, log = '';
async function api(path, body) {
  const res = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function key(page, k) {
  await page.locator(`.button-${k}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function openStatus(page) { await key(page, 'a'); for (let i = 0; i < 4; i++) await key(page, 'a'); await key(page, 'b'); }
async function appearance(locator) {
  return locator.evaluate(el => {
    const geometry = target => {
      if (!target) return null;
      const css = getComputedStyle(target);
      // The outer canvas can be wider; only outfit offsets use actor coordinates.
      return [css.width, css.height, css.bottom, css.marginLeft, target.matches(".growth-size") ? null : css.left];
    };
    return {
      art: ['.growth-outfit', '.growth-form-emblem', '.equipped-accessory'].map(s => el.querySelector(s)?.outerHTML ?? null),
      rig: el.querySelector('.growth-size')?.className,
      geometry: ['.growth-size', '.growth-outfit'].map(s => geometry(el.querySelector(s))),
    };
  });
}
async function verify(page, expected, state) {
  const header = page.locator('.status-name'); await header.waitFor();
  assert.deepEqual(await appearance(header), expected, 'status must use the same saved artwork and species offsets as home');
  assert.equal(await header.locator('.expression-asleep.rig-motion-sleeping').count(), state.sleeping ? 1 : 0);
  assert.equal((await header.innerText()).includes('正在睡觉'), state.sleeping);
  if (state.growth.stage === 'adult') assert((await header.innerText()).includes(forms[state.growth.form]));
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,[role=button]').count(), 0);
  assert.equal(await header.locator('.status-portrait').getAttribute('aria-hidden'), 'true');
  const problems = await header.evaluate(el => {
    const errors = [], lcd = document.querySelector('.lcd-content').getBoundingClientRect();
    if (document.documentElement.scrollWidth > innerWidth + 1) errors.push('page horizontal overflow');
    if (el.scrollWidth > el.clientWidth + 1) errors.push('header horizontal overflow');
    const portrait = el.querySelector('.status-portrait').getBoundingClientRect();
    for (const target of el.querySelectorAll('.status-portrait-canvas,.pet-sprite,.growth-outfit,.growth-form-emblem')) {
      const box = target.getBoundingClientRect();
      if (box.left < portrait.left - 1 || box.right > portrait.right + 1 || box.top < portrait.top - 1 || box.bottom > portrait.bottom + 1) errors.push('portrait outside reserved area: ' + target.getAttribute('class'));
    }
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
    while ((node = text.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (box.left < lcd.left - 1 || box.right > lcd.right + 1 || box.top < lcd.top - 1 || box.bottom > lcd.bottom + 1) errors.push('text outside LCD: ' + node.textContent);
        if (box.left < portrait.right && box.right > portrait.left && box.top < portrait.bottom && box.bottom > portrait.top) errors.push('text overlaps portrait');
      }
    }
    return errors;
  });
  assert.deepEqual(problems, []);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', b => { log += b; }); server.stderr.on('data', b => { log += b; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const cases = [];
  for (let species = 0; species < 10; species++) for (const [i, stage] of ['baby', 'growing', 'adult'].entries()) {
    cases.push({ species, stage, form: stage === 'adult' ? 'balanced' : '', sleeping: species % 2 === 1, mode: modes[i === 2 && species % 2 ? 3 : i] });
  }
  for (const [i, form] of Object.keys(forms).entries()) cases.push({ species: 2, stage: 'adult', form, sleeping: true, mode: modes[i] });
  cases.push({ species: 2, stage: 'adult', form: 'gentle', sleeping: false, accessory: 'leaf-pin', mode: modes[1], sync: true });
  for (const test of cases) {
    const { species, stage, form, sleeping, accessory, mode } = test;
    const at = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
    let state = (await api('import', { schema: 1, revision: 1, species, name: '一起慢慢长大的伙伴', createdAt: at - age,
      hatchedAt: at - age, lastTick: at, sleeping, needs: { hunger: 70, mood: 70, clean: 70, energy: 70 }, careCount: 0, logs: [] })).state;
    assert.equal(state.growth.stage, stage);
    if (form || accessory) {
      // Keep the constructed legacy adult and its migrated album consistent.
      state.growth.form = form;
      for (const memory of state.album.entries) if (memory.kind === "adult") memory.form = form;
      if (accessory) { state.economy.owned.push(accessory); state.economy.equipped.accessory = accessory; }
      state = (await api('import', state)).state;
      assert.equal(state.growth.form, form);
    }
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, locale: 'zh-CN', hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.forcedColors || 'none' });
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), mode.font);
      const page = await context.newPage(), writes = [], errors = [];
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname !== '/api/visit') writes.push(new URL(r.url()).pathname); });
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base); await page.locator('.home-caption').waitFor();
      const expected = await appearance(page.locator('.pet-scene'));
      await openStatus(page); await verify(page, expected, state);
      await key(page, 'a'); await page.locator('.status-guide').waitFor();
      await key(page, 'a'); await verify(page, expected, state);
      if (test.sync) {
        for (const asleep of [true, false]) {
          state = (await api('action', { kind: 'sleep', requestId: `status-sleep-${asleep}-${Date.now()}` })).state;
          assert.equal(state.sleeping, asleep);
          await page.evaluate(() => window.dispatchEvent(new Event('focus')));
          await page.waitForFunction(asleep => !!document.querySelector('.status-name .expression-asleep') === asleep, state.sleeping);
          await verify(page, expected, state);
        }
      }
      if (species === 2 && stage === 'adult') await page.screenshot({ path: join(dir, `${form}-${mode.label}-${accessory || 'default'}.png`), fullPage: true });
      await page.reload(); await page.locator('.home-caption').waitFor(); await openStatus(page); await verify(page, expected, state);
      const persisted = (await api('state')).state;
      for (const field of ['species', 'name', 'hatchedAt', 'careCount', 'sleeping']) assert.equal(persisted[field], state[field]);
      assert.equal(persisted.growth.stage, stage); assert.equal(persisted.growth.form, form);
      assert.deepEqual(persisted.economy.equipped, state.economy.equipped);
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ species, stage, form, sleeping, accessory, mode: mode.label, sync: !!test.sync });
      console.log('PASS', results.length, species, stage, form, mode.label);
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ results, db: join(dir, 'test.db'), port }, null, 2));
  console.log('PASS total', results.length, 'artifacts', dir);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
  await writeFile(join(dir, 'server.log'), log);
}
