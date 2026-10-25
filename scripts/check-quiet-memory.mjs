// Real HTTP/Chrome memory chat. Fixture ages are controlled, actions use a temporary save.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-quiet-memory-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '', startupError;
async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, `${path}: ${await response.clone().text()}`); return response.json();
}
async function appearance(page, selector) {
  return page.locator(selector).evaluate(panel => {
    const rig = panel.querySelector('.growth-size'), box = rig.getBoundingClientRect();
    const outfit = panel.querySelector('.growth-outfit'), outfitBox = outfit?.getBoundingClientRect();
    return {
      rig: rig.className,
      outfit: outfit?.outerHTML ?? null,
      emblem: panel.querySelector('.growth-form-emblem')?.outerHTML ?? null,
      accessory: panel.querySelector('.equipped-accessory')?.outerHTML ?? null,
      geometry: outfitBox ? [box.width, box.height, outfitBox.x - box.x, outfitBox.y - box.y, outfitBox.width, outfitBox.height] : [box.width, box.height],
    };
  });
}
async function sameAppearance(page, expected, saved) {
  assert.deepEqual(await appearance(page, '.quiet-moment-pet'), expected, 'Quiet company must preserve the home rig, outfit placement, form and accessory');
  const stageNames = { baby: '幼年期', growing: '成长期', adult: '成年期' };
  const formNames = { balanced: '均衡型', lively: '活力型', gentle: '恬静型', easygoing: '自在型' };
  assert.equal(await page.locator('.quiet-growth-label').innerText(), stageNames[saved.growth.stage] + (saved.growth.stage === 'adult' ? ` · ${formNames[saved.growth.form]}` : ''));
}
async function responseVisible(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const replied = await page.locator('.quiet-moment').getAttribute('data-replied') === 'true';
  const box = await page.locator(replied ? '.quiet-moment-copy > p' : '.quiet-moment-copy').boundingBox(), height = page.viewportSize().height;
  assert(box && box.y >= -1 && (box.height > height - 24 ? box.y <= 13 : box.y + box.height <= height + 1),
    `Current ${replied ? "reply" : "choice"} must be in view: ${JSON.stringify(box)}, viewport=${height}`);
}
async function physical(page, key) {
  const button = page.locator(`.button-${key}`);
  const previous = key === 'a' ? await page.locator('.quiet-moment-copy > strong').innerText() : null;
  await button.tap();
  await responseVisible(page);
  if (key === 'a') {
    const titles = await page.locator('.quiet-moment').getAttribute('data-sleeping') === 'true'
      ? ['轻轻摸摸', '守着它睡', '轻声道晚安'] : ['摸摸它', '陪它发呆', '说声你好'];
    assert.equal(await page.locator('.quiet-moment-copy > strong').innerText(), titles[(titles.indexOf(previous) + 1) % 3], 'Each tap must change the choice once');
  }
  assert(await button.evaluate(el => document.activeElement === el), 'Reading navigation must preserve physical button focus');
}
async function open(page) {
  await page.keyboard.press('a');
  for (let i = 0; i < 12; i++) await page.keyboard.press('a');
  await physical(page, 'b'); await page.locator('.quiet-moment').waitFor();
  await physical(page, 'a'); await physical(page, 'a');
}
// Observe the actual CSS animation, not an implementation-specific DOM key.
async function repeatedResponses(page, reduced) {
  const panel = page.getByRole('region', { name: '无目的互动阅读区' });
  await panel.evaluate(el => { window.__quietReadingNode = el; });
  for (const title of ['摸摸它', '陪它发呆', '说声你好']) {
    await physical(page, 'a');
    assert.equal(await page.locator('.quiet-moment-copy > strong').innerText(), title);
    await panel.focus();
    await page.keyboard.press('b');
    await responseVisible(page);
    assert(await panel.evaluate(el => document.activeElement === el && el === window.__quietReadingNode),
      'A reply must preserve the reading region and keyboard focus');
    if (reduced) {
      await physical(page, 'b');
      assert.equal(await page.locator('.quiet-moment-pet').evaluate(el => el.getAnimations().length), 0,
        'Reduced motion must keep repeated company still');
      continue;
    }
    await page.locator('.quiet-moment-pet').evaluate(async el => {
      const motion = el.getAnimations().find(a => a.animationName.startsWith('quiet-moment-'));
      if (!motion || motion.playState !== 'running') throw new Error('An explicit reply must visibly respond');
      window.__quietReplyMotion = motion;
      await motion.finished;
    });
    await physical(page, 'b');
    assert(await page.locator('.quiet-moment-pet').evaluate(el => {
      const motion = el.getAnimations().find(a => a.animationName.startsWith('quiet-moment-'));
      return motion && motion !== window.__quietReplyMotion && motion.playState === 'running';
    }), `${title}: B must respond again after the first animation finishes`);
    await page.locator('.quiet-moment-pet').evaluate(el => {
      window.__quietReplyMotion = el.getAnimations().find(a => a.animationName.startsWith('quiet-moment-'));
    });
    await page.keyboard.press('b');
    assert(await page.locator('.quiet-moment-pet').evaluate(el => {
      const motion = el.getAnimations().find(a => a.animationName.startsWith('quiet-moment-'));
      return motion && motion !== window.__quietReplyMotion && motion.playState === 'running';
    }), `${title}: a new B press must replace, rather than queue, the current response`);
    await page.locator('.quiet-moment-pet').evaluate(async el => {
      window.__quietReplyMotion = el.getAnimations().find(a => a.animationName.startsWith('quiet-moment-'));
      await window.__quietReplyMotion.finished;
    });
    const polled = page.waitForResponse(response => /\/api\/(state|visit)$/.test(response.url()));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await polled;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert(await page.locator('.quiet-moment-pet').evaluate(el => {
      const motion = el.getAnimations().find(a => a.animationName.startsWith('quiet-moment-'));
      return motion === window.__quietReplyMotion && motion.playState === 'finished';
    }), 'A state read must not replay the completed response');
  }
  // Return to the idle third choice so the original memory and sleep flow stays intact.
  for (let i = 0; i < 3; i++) await physical(page, 'a');
  assert.equal(await page.locator('.quiet-moment').getAttribute('data-replied'), 'false');
}
// Two representative viewports cover interruptions without multiplying the
// stage/appearance matrix. Network failure is injected into this page only.
async function interruptedResponses(page, reduced, label) {
  const panel = page.getByRole('region', { name: '无目的互动阅读区' });
  async function rememberReply() {
    const previous = await page.locator('.quiet-memory-source').allTextContents();
    await page.keyboard.press('b');
    assert.equal(await page.locator('.quiet-moment').getAttribute('data-replied'), 'true');
    assert.equal(await page.locator('.quiet-memory-source').count(), 1);
    assert.notDeepEqual(await page.locator('.quiet-memory-source').allTextContents(), previous,
      'Each explicit B, including after tool closure, must advance the real memory');
    await panel.evaluate(el => { window.__quietInterruptedRegion = el; });
    await page.locator('.quiet-moment-pet').evaluate(async (el, reduced) => {
      window.__quietInterruptedMotion = el.getAnimations().find(a => a.animationName.startsWith('quiet-moment-'));
      if (reduced ? window.__quietInterruptedMotion : window.__quietInterruptedMotion?.playState !== 'running')
        throw new Error('An explicit B after an interruption must respect the motion preference');
      if (window.__quietInterruptedMotion) await window.__quietInterruptedMotion.finished;
    }, reduced);
    return {
      text: await page.locator('.quiet-moment-copy').innerText(),
      scrollCalls: await page.evaluate(() => window.__quietScrollCalls),
    };
  }
  async function unchanged(reply) {
    assert.equal(await page.locator('.quiet-moment-copy').innerText(), reply.text,
      'Opening and closing a tool must retain the selected reply');
    assert(await panel.evaluate(el => el === window.__quietInterruptedRegion),
      'An overlay must retain the reading region');
    assert.equal(await page.evaluate(() => window.__quietScrollCalls), reply.scrollCalls,
      'Closing a tool must not replay the old reply location');
    assert(await page.locator('.quiet-moment-pet').evaluate((el, reduced) => {
      const motion = el.getAnimations().find(a => a.animationName.startsWith('quiet-moment-'));
      return reduced ? !motion : motion === window.__quietInterruptedMotion && motion.playState === 'finished';
    }, reduced), 'Closing a tool must not replay a completed animation');
  }
  let reply = await rememberReply();
  for (const overlay of ['help', 'reset', 'tools']) {
    if (overlay === 'help') await page.getByRole('button', { name: '玩法说明', exact: true }).click();
    else {
      await page.getByRole('button', { name: '存档盒', exact: true }).click();
      if (overlay === 'reset') await page.getByRole('button', { name: '重新开始', exact: true }).click();
    }
    await page.keyboard.press('a'); await page.keyboard.press('b');
    assert.equal(await page.locator('.quiet-moment-copy').innerText(), reply.text,
      'Overlay keys must not act on company behind the tool');
    await page.keyboard.press(overlay === 'reset' ? 'Escape' : 'c');
    if (overlay !== 'tools') {
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert(await page.locator('.button-c').evaluate(el => document.activeElement === el),
        'A closed dialog must return focus to the physical C key');
    }
    await unchanged(reply);
    reply = await rememberReply();
  }
  // Fail actual browser reads; the separate HTTP client/server stay connected.
  const reads = /\/api\/(state|visit)$/;
  await page.route(reads, route => route.abort('connectionfailed'));
  try {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.locator('.save-recovery').waitFor();
    assert.equal(await page.locator('.quiet-moment').count(), 0);
    await page.screenshot({ path: join(dir, `${label}-offline.png`), fullPage: true });
  } finally { await page.unroute(reads); }
  const scrollCalls = await page.evaluate(() => window.__quietScrollCalls);
  await page.keyboard.press('b'); await page.locator('.quiet-moment').waitFor();
  assert.equal(await page.locator('.quiet-moment').getAttribute('data-replied'), 'false',
    'Reconnection must discard the interrupted reply');
  assert.equal(await page.locator('.quiet-memory-source').count(), 0);
  assert.equal(await page.locator('.quiet-moment-pet').evaluate(el => el.getAnimations().length), 0,
    'Reconnection must not animate without an explicit B');
  assert.equal(await page.evaluate(() => window.__quietScrollCalls), scrollCalls,
    'Reconnection must not jump to a discarded reply');
  await panel.focus();
  await page.keyboard.press('b'); await responseVisible(page);
  assert(await panel.evaluate(el => document.activeElement === el), 'B works again with reading focus after recovery');
  assert.equal(await page.locator('.quiet-moment').getAttribute('data-replied'), 'true');
  assert.equal(await page.locator('.quiet-memory-source').count(), 1);
  assert(await page.locator('.quiet-moment-pet').evaluate((el, reduced) => {
    const motion = el.getAnimations().find(a => a.animationName.startsWith('quiet-moment-'));
    return reduced ? !motion : motion?.playState === 'running';
  }, reduced), 'Only the next explicit B starts a new response');
  await page.screenshot({ path: join(dir, `${label}-reconnected.png`), fullPage: true });
  await page.keyboard.press('c'); await page.locator('.home-caption').waitFor();
  await open(page);
  assert.equal(await page.locator('.quiet-moment').getAttribute('data-replied'), 'false');
}
async function readable(page) {
  const problems = await page.locator('.quiet-moment').evaluate(panel => {
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT), problems = [];
    let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (box.left < -1 || box.right > innerWidth + 1) problems.push('horizontal: ' + text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1))
            problems.push('clipped: ' + text.textContent);
        }
      }
    }
    return problems;
  });
  assert.deepEqual(problems, [], 'Chat text must remain readable');
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  // Imported catalog records verify saved recollections, not naturally played
  // catches or walks. The HTTP service still validates and persists the fixture.
  if (process.argv.includes('--discoveries-only') || !process.argv.some(arg => arg.endsWith('-only'))) {
    const fish = [['reed-minnow', '青苇小鲦'], ['sun-carp', '暖阳小鲤'], ['ribbon-loach', '丝带泥鳅'],
      ['lotus-fish', '荷花小鱼'], ['moon-perch', '月纹小鲈'], ['pebble-goby', '石斑虾虎'], ['rain-koi', '雨珠小鲤'], ['willow-darter', '柳影小鳉']];
    const park = [['leaf', '银杏叶'], ['pinecone', '小松果'], ['feather', '落羽'], ['flower', '落花'], ['shell', '水边贝壳'], ['pebble', '圆石子']];
    for (const mode of [{ width: 1200, height: 700, font: 14 }, { width: 320, height: 380, font: 28 }]) {
      const at = Date.now(), since = at - 3600000;
      const seeded = (await api('import', { schema: 1, revision: 1, species: 2, name: '图鉴回忆伙伴',
        createdAt: since, hatchedAt: since, lastTick: at, sleeping: false,
        needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] })).state;
      const expected = [...fish.map(([id, name]) => ({ id, name, source: '鱼', art: 'fish' })),
        ...park.map(([id, name]) => ({ id, name, source: '公园', art: 'park' }))]
        .map((entry, index) => ({ ...entry, firstAt: at - 1000 - index * 1000 }));
      const record = ({ id, firstAt }) => ({ id, firstAt, lastAt: firstAt, count: 1 });
      seeded.pond = { since, fish: expected.filter(e => e.art === 'fish').map(record) };
      seeded.park = { since, finds: expected.filter(e => e.art === 'park').map(record), walks: 0, lastWalkAt: 0 };
      const before = (await api('import', seeded)).state;
      const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true, reducedMotion: 'reduce' });
      const page = await context.newPage(), writes = [], errors = [], label = `discoveries-${mode.width}`;
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(request.url()).pathname)) writes.push(request.url()); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
      try {
        await page.goto(base); await page.locator('.home-caption').waitFor(); await open(page);
        assert.equal(await page.locator('.quiet-memory-source').count(), 0, 'A discovery needs an explicit B');
        for (const [index, entry] of expected.entries()) {
          await physical(page, 'b');
          const source = page.locator('.quiet-memory-source'), reply = await page.locator('.quiet-moment-copy > p').innerText();
          assert((await source.innerText()).includes(`从${entry.source}图鉴想起：初次遇见「${entry.name}」`));
          assert(reply.includes(entry.name), reply); assert.doesNotMatch(reply, /今天|昨天|刚才|完成|奖励|金币|集齐/);
          assert.equal(await source.locator('time').getAttribute('datetime'), new Date(entry.firstAt).toISOString());
          assert.equal(await page.locator(`.quiet-discovery .${entry.art}-art`).count(), 1);
          assert.equal(await page.locator('.quiet-memory-position').innerText(), `闲聊回忆 ${index + 1} / ${expected.length}`);
          await readable(page); await source.scrollIntoViewIfNeeded();
          const box = await source.boundingBox(); assert(box && box.y >= -1 && box.y + box.height <= mode.height + 1);
          if (index === 0 || entry.id === 'leaf') await page.screenshot({ path: join(dir, `${label}-${entry.art}.png`) });
        }
        await physical(page, 'b');
        const source = page.locator('.quiet-memory-source'), first = await source.innerText();
        const sync = async () => {
          const response = page.waitForResponse(r => /\/api\/(state|visit)$/.test(new URL(r.url()).pathname));
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); assert((await response).ok());
        };
        await sync(); assert.equal(await source.innerText(), first, 'An ordinary read preserves the selected first record');
        const after = (await api('state')).state;
        for (const field of ['pond', 'park', 'companion', 'economy', 'album', 'careCount']) assert.deepEqual(after[field], before[field], `${field} must not change during read-only chat`);
        await page.keyboard.press('c'); await page.locator('.home-caption').waitFor();
        await page.reload(); await page.locator('.home-caption').waitFor(); await open(page); await physical(page, 'b');
        assert.equal(await source.innerText(), first, 'Reload keeps the catalog record, not a new encounter');
        // This separate test client puts the temporary pet to sleep; the browser
        // itself performs no game, care, import or backup writes.
        await api('action', { kind: 'sleep' }); await sync();
        await page.waitForFunction(() => document.querySelector('.quiet-moment')?.getAttribute('data-sleeping') === 'true');
        await physical(page, 'b'); assert.equal(await source.count(), 0); assert.equal(await page.locator('.quiet-discovery').count(), 0);
        assert.equal((await api('state')).state.sleeping, true);
        assert.deepEqual(writes, []); assert.deepEqual(errors, []);
        results.push({ label, fixtureCatalogs: true, discoveries: expected.length, sleeping: true, writes, errors }); console.log('PASS', label);
      } finally { await context.close(); }
    }
  }
  // Controlled ages/care/form fixtures exercise presentation, not natural aging.
  if (process.argv.includes('--reactions-only')) for (const fixture of [
    { label: 'baby', age: 1, reaction: 'peek' },
    { label: 'growing-empty', age: 30, reaction: 'breathe' },
    { label: 'growing-lively', age: 30, reaction: 'lively', play: 2 },
    { label: 'growing-gentle', age: 30, reaction: 'gentle', clean: 4 },
    { label: 'growing-easygoing', age: 30, reaction: 'easygoing', hours: 12, wellbeing: 1 },
    ...['balanced', 'lively', 'gentle', 'easygoing'].map(form => ({
      label: `adult-${form}`, age: 80, reaction: form === 'balanced' ? 'breathe' : form,
      form, play: form === 'lively' ? 0 : 20, clean: form === 'lively' ? 20 : 0,
    })),
  ]) for (const mode of [
    { width: 1200, height: 700, font: 14, reduced: false },
    ...(fixture.label === 'baby' || fixture.label === 'adult-easygoing' ? [
      { width: 320, height: 380, font: 28, reduced: false },
      { width: 320, height: 380, font: 28, reduced: true },
    ] : []),
  ]) {
    const at = Date.now(), born = at - fixture.age * 3600000;
    const seeded = (await api('import', { schema: 1, revision: 1, species: fixture.label === 'baby' ? 4 : 3,
      name: '动作测试伙伴', createdAt: born, hatchedAt: born, lastTick: at, sleeping: false,
      needs: { hunger: 70, mood: 80, clean: 70, energy: 80 }, careCount: 0, logs: [] })).state;
    seeded.growth.care.play = fixture.play ?? 0; seeded.growth.care.clean = fixture.clean ?? 0;
    seeded.growth.trackedHours = fixture.hours ?? 0; seeded.growth.wellbeing = fixture.wellbeing ?? 0;
    if (fixture.form) {
      seeded.growth.form = fixture.form;
      seeded.album.entries.find(entry => entry.kind === 'adult').form = fixture.form;
    }
    const before = (await api('import', seeded)).state;
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      reducedMotion: mode.reduced ? 'reduce' : 'no-preference', forcedColors: mode.reduced ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [], samples = [];
    const label = `reaction-${fixture.label}-${mode.width}-${mode.reduced ? 'still' : 'motion'}`;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(request.url()).pathname)) writes.push(request.url());
    });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = `${font}px`;
    }), mode.font);
    const art = page.locator('.quiet-moment-pet');
    const sync = async () => {
      const read = page.waitForResponse(r => /\/api\/(state|visit)$/.test(new URL(r.url()).pathname));
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      assert((await read).ok());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor(); await open(page);
      await physical(page, 'a'); await physical(page, 'a');
      assert.equal(await page.locator('.quiet-moment-copy > strong').innerText(), '陪它发呆');
      assert.equal(await art.evaluate(el => el.getAnimations().length), 0, 'Selecting an option is not a reply');
      await physical(page, 'b');
      assert.equal(await art.getAttribute('data-reaction'), fixture.reaction);
      if (mode.reduced) {
        assert.equal(await art.evaluate(el => el.getAnimations().length), 0, 'Reduced motion keeps all reactions still');
        await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
      } else {
        assert.equal(await art.evaluate(el => el.getAnimations()[0]?.animationName), `quiet-moment-${fixture.reaction}`);
        await art.scrollIntoViewIfNeeded();
        for (const progress of [0, .25, .5, .7, 1]) {
          const sample = await art.evaluate(async (el, progress) => {
            const motion = el.getAnimations()[0]; motion.pause();
            motion.currentTime = motion.effect.getTiming().duration * progress;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const box = el.getBoundingClientRect(), clip = el.closest('.quiet-moment-reading').getBoundingClientRect();
            return { progress, transform: getComputedStyle(el).transform,
              box: { x: box.x, y: box.y, width: box.width, height: box.height },
              fitsHorizontally: box.left >= clip.left - 1 && box.right <= clip.right + 1 };
          }, progress);
          assert(sample.fitsHorizontally, JSON.stringify(sample)); samples.push(sample);
          if (progress === .5) await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
        }
        assert(new Set(samples.map(sample => sample.transform)).size >= 3, 'The response must actually move, then settle');
        await art.evaluate(el => { window.__growthReplyNode = el; window.__growthReplyMotion = el.getAnimations()[0]; window.__growthReplyMotion.finish(); });
        await sync();
        assert(await art.evaluate(el => el === window.__growthReplyNode && el.getAnimations()[0] === window.__growthReplyMotion
          && el.getAnimations()[0].playState === 'finished'), 'Ordinary reads must not replay the completed reaction');
        await physical(page, 'b');
        assert(await art.evaluate(el => el !== window.__growthReplyNode && el.getAnimations()[0] !== window.__growthReplyMotion
          && el.getAnimations()[0].playState === 'running'), 'A fresh B starts a new one-shot reply');
      }
      await readable(page);
      const after = (await api('state')).state;
      assert.deepEqual(after.growth.care, before.growth.care);
      assert.equal(after.growth.form, before.growth.form);
      assert.deepEqual(after.economy, before.economy); assert.deepEqual(after.companion, before.companion);
      await api('action', { kind: 'sleep' }); await sync();
      await page.waitForFunction(() => document.querySelector('.quiet-moment')?.dataset.sleeping === 'true');
      await physical(page, 'b');
      assert.equal(await art.evaluate(el => el.getAnimations().length), 0, 'Sleeping company must not play an awake response');
      assert.equal((await api('state')).state.sleeping, true);
      await page.reload(); await page.locator('.home-caption').waitFor(); await open(page);
      assert.equal(await art.evaluate(el => el.getAnimations().length), 0, 'Reload must not replay a previous B');
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ label, fixtureAgeCare: true, reaction: fixture.reaction, samples, sleeping: true, writes, errors });
      console.log('PASS', label);
    } finally { await context.close(); }
  }
  // Mock only the browser's wall clock. The service and temporary save keep real
  // time, so these checks prove presentation boundaries, not seasonal waiting.
  if (!process.argv.includes('--discoveries-only') && !process.argv.includes('--reactions-only') && !process.argv.includes('--items-only') && !process.argv.includes('--interest-only')) for (const species of [3, 4]) for (const mode of [
    { width: 1200, height: 700, font: 14 }, { width: 320, height: 380, font: 28 },
  ]) {
    const at = Date.now();
    await api('import', { schema: 1, revision: 1, species, name: '四季伙伴',
      createdAt: at - 3600000, hatchedAt: at - 3600000, lastTick: at, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
    const label = `atmosphere-${species}-${mode.width}-${mode.font}`, writes = [], errors = [];
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(request.url()).pathname)) writes.push(request.url());
    });
    await page.addInitScript(font => {
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; });
    }, mode.font);
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor();
      await open(page);
      for (const [date, season] of [
        ['02-28', 'winter'], ['03-01', 'spring'], ['05-31', 'spring'], ['06-01', 'summer'],
        ['08-31', 'summer'], ['09-01', 'autumn'], ['11-30', 'autumn'], ['12-01', 'winter'],
      ]) {
        await page.clock.setFixedTime(`2026-${date}T02:00:00+08:00`);
        // Move from hello through touch to idle company, rerendering against
        // the selected local time without a state mutation.
        await physical(page, 'a'); await physical(page, 'a');
        assert.equal(await page.locator('.quiet-moment-copy > strong').innerText(), '陪它发呆');
        assert.equal(await page.locator('.quiet-event').getAttribute('data-season'), season, date);
        assert((await page.locator('.quiet-atmosphere').innerText()).includes('深夜'));
        assert(!/阳光|耳朵|鼻尖|脚步/.test(await page.locator('.quiet-moment-copy').innerText()), date);
        await physical(page, 'b');
        assert.equal(await page.locator('.quiet-moment').getAttribute('data-replied'), 'true');
        await readable(page);
        if (date === '03-01' || date === '06-01') await page.screenshot({ path: join(dir, `${label}-${date}.png`), fullPage: true });
        await physical(page, 'a'); // Back to hello for the next boundary.
      }
      const slept = await api('action', { kind: 'sleep' });
      assert.equal(slept.state.sleeping, true);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() => document.querySelector('.quiet-moment')?.dataset.sleeping === 'true');
      assert.equal(await page.locator('.quiet-atmosphere,.quiet-event').count(), 0);
      await physical(page, 'a'); await physical(page, 'a'); await physical(page, 'b');
      assert.equal(await page.locator('.quiet-moment-copy > strong').innerText(), '守着它睡');
      assert((await page.locator('.quiet-moment-copy > p').innerText()).includes('安安稳稳地睡'));
      await page.keyboard.press('c'); await page.locator('.home-caption').waitFor();
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ label, boundaries: 8, sleeping: true, writes, errors });
      console.log('PASS', label);
    } finally { await context.close(); }
  }
  // Controlled save fixtures verify rendering; these are not natural growth journeys.
  if (!process.argv.includes('--discoveries-only') && !process.argv.includes('--reactions-only') && !process.argv.includes('--items-only') && !process.argv.includes('--atmosphere-only') && !process.argv.includes('--interest-only')) for (const fixture of [
    { stage: 'baby', species: 2, age: 1 },
    { stage: 'growing', species: 3, age: 30 },
    { stage: 'adult', species: 9, age: 80 },
    { stage: 'adult', species: 7, age: 80, form: 'gentle', accessory: 'leaf-pin' },
  ]) for (const mode of [
    { width: 1200, height: 700, font: 14 }, { width: 320, height: 700, font: 14 }, { width: 320, height: 380, font: 28 },
  ]) {
    const { stage } = fixture, at = Date.now(), age = fixture.age * 3600000;
    const seeded = await api('import', { schema: 1, revision: 1, species: fixture.species, name: '回忆伙伴',
      createdAt: at - age, hatchedAt: at - age, lastTick: at, sleeping: false,
      needs: { hunger: 50, mood: 70, clean: 50, energy: 80 }, careCount: 0, logs: [] });
    if (fixture.form) {
      seeded.state.growth.form = fixture.form;
      seeded.state.album.entries.find(memory => memory.kind === 'adult').form = fixture.form;
      seeded.state.economy.owned.push(fixture.accessory);
      seeded.state.economy.equipped.accessory = fixture.accessory;
      await api('import', seeded.state);
    }
    await api('action', { kind: 'feed' }); await api('action', { kind: 'clean' });
    const before = (await api('state')).state;
    assert.equal(before.growth.stage, stage);
    assert.deepEqual(before.album.entries.filter(m => m.source === 'shared').map(m => m.kind).sort(), ['bath', 'meal']);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width < 700, reducedMotion: mode.font === 28 ? 'reduce' : 'no-preference', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [], label = `${stage}${fixture.accessory ? '-equipped' : ''}-${mode.width}-${mode.height}`;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
    await page.addInitScript(font => {
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; });
      const original = window.scrollBy.bind(window);
      window.__quietScrollCalls = 0;
      window.scrollBy = (...args) => { window.__quietScrollCalls++; return original(...args); };
    }, mode.font);
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor();
      const homeAppearance = await appearance(page, '.pet-scene');
      await open(page);
      await repeatedResponses(page, mode.font === 28);
      const interruptions = stage === 'baby' && (mode.width === 1200 || mode.height === 380);
      if (interruptions) await interruptedResponses(page, mode.font === 28, label);
      await sameAppearance(page, homeAppearance, before);
      await page.locator('.quiet-moment-pet').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(dir, `${label}-appearance.png`) });
      assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      assert.equal(await page.locator('.quiet-memory-position').count(), 0);
      await physical(page, 'b'); const first = await page.locator('.quiet-memory-source').innerText();
      assert.equal(await page.locator('.quiet-memory-position').innerText(), '闲聊回忆 1 / 2');
      await physical(page, 'b'); const second = await page.locator('.quiet-memory-source').innerText();
      assert.equal(await page.locator('.quiet-memory-position').innerText(), '闲聊回忆 2 / 2');
      assert.notEqual(first, second);
      assert([first, second].some(t => t.includes('泡泡里的小陪伴')));
      assert([first, second].some(t => t.includes('一份暖暖的小饭团')));
      await physical(page, 'b'); assert.equal(await page.locator('.quiet-memory-source').innerText(), first);
      assert.equal(await page.locator('.quiet-memory-position').innerText(), '闲聊回忆 1 / 2');
      await readable(page);
      await page.screenshot({ path: join(dir, `${label}-reply-viewport.png`) });
      await physical(page, 'b');
      const panel = page.getByRole('region', { name: '无目的互动阅读区' });
      for (let i = 0; i < 12 && !await panel.evaluate(el => document.activeElement === el); i++) await page.keyboard.press('Shift+Tab');
      assert(await panel.evaluate(el => document.activeElement === el), 'Native Tab must reach the reading region');
      const current = await page.locator('.quiet-memory-source').innerText();
      await page.keyboard.press('Enter'); assert.equal(await page.locator('.quiet-memory-source').innerText(), current);
      await page.keyboard.press('b'); assert.notEqual(await page.locator('.quiet-memory-source').innerText(), current);
      await page.locator('.quiet-moment-note').scrollIntoViewIfNeeded(); await readable(page);
      const box = await page.locator('.quiet-moment-note').boundingBox();
      assert(box && box.y >= -1 && box.y + box.height <= mode.height + 1, 'Final note must be reachable');
      await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
      await physical(page, 'a'); assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      assert.equal(await page.locator('.quiet-memory-position').count(), 0);
      await page.keyboard.press('c'); await page.locator('.home-caption').waitFor();
      await open(page); assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      await page.reload(); await page.locator('.home-caption').waitFor();
      await open(page); await page.keyboard.press('b');
      assert.equal(await page.locator('.quiet-memory-source').innerText(), first, 'Reload starts a new conversation');
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      const after = (await api('state')).state;
      for (const field of ['album', 'careCount', 'economy']) assert.deepEqual(after[field], before[field], `${field} changed during read-only chat`);
      // Ordinary reads and sleep/wake must not replay a prior explicit reading jump.
      await page.locator('.quiet-moment-note').scrollIntoViewIfNeeded();
      const scrollCalls = await page.evaluate(() => window.__quietScrollCalls);
      const polled = page.waitForResponse(response => /\/api\/(state|visit)$/.test(response.url()));
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await polled; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert.equal(await page.evaluate(() => window.__quietScrollCalls), scrollCalls, 'Ordinary read must not reposition the response');
      // Sleep/wake happens through a separate client; this page stays read-only.
      await api('action', { kind: 'sleep' });
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() => document.querySelector('.quiet-moment')?.dataset.sleeping === 'true');
      assert.equal(await page.evaluate(() => window.__quietScrollCalls), scrollCalls, 'Sleep sync must not reposition the response');
      const sleepingBefore = (await api('state')).state;
      await sameAppearance(page, homeAppearance, before);
      if (stage === 'adult') assert.equal(await page.locator('.quiet-moment .growth-form-emblem').evaluate(el => getComputedStyle(el).opacity), '0.4');
      assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      assert.equal(await page.locator('.quiet-memory-position').count(), 0);
      assert.equal(await page.locator('.quiet-moment').getAttribute('data-replied'), 'false');
      assert((await page.locator('.lcd-bottom').innerText()).includes('B 安静陪着'));
      // Selection is still the third option; wrap through all bedside interactions.
      for (const title of ['轻声道晚安', '轻轻摸摸', '守着它睡']) {
        assert.equal(await page.locator('.quiet-moment-copy > strong').innerText(), title);
        await physical(page, 'b');
        assert.equal(await page.locator('.quiet-memory-source').count(), 0);
        assert.equal(await page.locator('.quiet-moment .expression-asleep.rig-motion-sleeping').count(), 1);
        assert.equal(await page.locator('.quiet-moment-pet').evaluate(el => getComputedStyle(el).animationName), 'none');
        assert.equal(await page.locator('.quiet-moment .sprite-eyes-open').evaluate(el => getComputedStyle(el).opacity), '0');
        assert.equal(await page.locator('.quiet-moment .sprite-eyes-closed').evaluate(el => getComputedStyle(el).opacity), '1');
        await readable(page);
        if (title === '轻声道晚安') await page.screenshot({ path: join(dir, `${label}-sleep-reply-viewport.png`) });
        await physical(page, 'a');
      }
      await page.locator('.quiet-moment-note').scrollIntoViewIfNeeded();
      const sleepBox = await page.locator('.quiet-moment-note').boundingBox();
      assert(sleepBox && sleepBox.y >= -1 && sleepBox.y + sleepBox.height <= mode.height + 1, 'Bedside note must be reachable');
      await page.screenshot({ path: join(dir, `${label}-sleeping.png`), fullPage: true });
      const sleepingAfter = (await api('state')).state;
      assert.equal(sleepingAfter.sleeping, true, 'Quiet company must not wake the pet');
      for (const field of ['album', 'careCount', 'economy']) assert.deepEqual(sleepingAfter[field], sleepingBefore[field]);
      await page.reload(); await page.locator('.home-caption').waitFor(); await open(page);
      assert.equal(await page.locator('.quiet-moment-copy > strong').innerText(), '轻声道晚安');
      await sameAppearance(page, homeAppearance, before);
      await page.keyboard.press('b');
      assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      await page.locator('.quiet-moment-note').scrollIntoViewIfNeeded();
      const wakeScrollCalls = await page.evaluate(() => window.__quietScrollCalls);
      await api('action', { kind: 'sleep' });
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() => document.querySelector('.quiet-moment')?.dataset.sleeping === 'false');
      assert.equal(await page.evaluate(() => window.__quietScrollCalls), wakeScrollCalls, 'Wake sync must not reposition the response');
      assert.equal(await page.locator('.quiet-moment').getAttribute('data-replied'), 'false');
      await sameAppearance(page, homeAppearance, before);
      assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      assert((await page.locator('.lcd-bottom').innerText()).includes('B 聊聊回忆'));
      await page.keyboard.press('b');
      assert.equal(await page.locator('.quiet-memory-source').innerText(), '从纪念册想起：轻轻说一声晚安', 'Waking starts with the latest real memory, including the separate client’s bedtime');
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ label, first, second, sleeping: true, interruptions, writes, errors }); console.log('PASS', label);
    } finally { await context.close(); }
  }
  // Controlled ownership only supplies fixture inventory. Actual equip/remove
  // requests create all four shared memories through the real service.
  if (!process.argv.includes('--discoveries-only') && !process.argv.includes('--reactions-only') && !process.argv.includes('--atmosphere-only') && !process.argv.includes('--interest-only')) for (const mode of [
    { label: 'items-desktop', width: 1200, height: 700, font: 14 },
    { label: 'items-phone-large', width: 320, height: 380, font: 28 },
  ]) {
    const at = Date.now(), since = at - 80 * 3600000;
    const seeded = await api('import', { schema: 1, revision: 1, species: 2, name: '小窝回忆伙伴',
      createdAt: since, hatchedAt: since, lastTick: at, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    const items = ['accessory', 'room', 'wallpaper', 'floor'].map(slot => seeded.shop.catalog.find(item => item.slot === slot));
    assert(items.every(Boolean));
    const alternate = seeded.shop.catalog.find(item => item.slot === 'accessory' && item.id !== items[0].id);
    assert(alternate);
    seeded.state.economy.owned = [...items.map(item => item.id), alternate.id];
    await api('import', seeded.state);
    for (const item of items) {
      await api('action', { kind: 'equip', item: item.id });
      await api('action', { kind: 'equip', item: item.id });
    }
    await api('action', { kind: 'equip', item: alternate.id });
    const before = (await api('state')).state;
    const memories = before.album.entries.filter(m => m.source === 'shared')
      .sort((a, b) => b.at - a.at || a.kind.localeCompare(b.kind));
    assert.equal(memories.length, 4);
    assert.equal(before.economy.equipped.accessory, alternate.id);
    const names = new Map(items.map(item => [item.id, item.name]));
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => {
      if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url());
    });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = `${font}px`;
    }), mode.font);
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor(); await open(page);
      for (const memory of [...memories, memories[0]]) {
        await physical(page, 'b');
        const reply = await page.locator('.quiet-moment-copy > p').innerText();
        assert(reply.includes(`「${names.get(memory.item)}」`), reply);
        assert(!reply.includes(alternate.name), 'Current equipment must not replace the saved memory');
        await readable(page);
      }
      await page.screenshot({ path: join(dir, `${mode.label}-reply.png`), fullPage: true });
      await page.reload(); await page.locator('.home-caption').waitFor(); await open(page); await physical(page, 'b');
      assert((await page.locator('.quiet-moment-copy > p').innerText()).includes(`「${names.get(memories[0].item)}」`));
      await page.keyboard.press('c'); await page.locator('.home-caption').waitFor();
      const after = (await api('state')).state;
      for (const field of ['album', 'economy', 'careCount', 'companion']) assert.deepEqual(after[field], before[field]);
      assert.equal(after.growth.form, before.growth.form);
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ label: mode.label, memories: memories.map(m => m.item), current: alternate.id, writes, errors });
      console.log('PASS', mode.label);
    } finally { await context.close(); }
  }
  // Imported familiarity is a controlled rendering fixture, not a claim that
  // these games were naturally played twice with a 30-minute interval.
  if (!process.argv.includes('--discoveries-only') && !process.argv.includes('--reactions-only') && !process.argv.includes('--items-only') && !process.argv.includes('--atmosphere-only')) for (const fixture of [
    { species: 4, kind: 'snake', part: '菌盖', absent: /尾巴/ },
    { species: 6, kind: 'snake', part: '身子', absent: /尾巴/ },
    { species: 3, kind: 'walk', part: '浅水道', absent: /慢慢走走/ },
  ]) for (const mode of [{ width: 1200, height: 700, font: 14 }, { width: 320, height: 380, font: 28 }]) {
    const at = Date.now(), seeded = await api('import', { schema: 1, revision: 1, species: fixture.species,
      name: '熟悉的小伙伴', createdAt: at - 3600000, hatchedAt: at - 3600000, lastTick: at,
      sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    seeded.state.companion.since = seeded.state.hatchedAt;
    seeded.state.companion.history.since = seeded.state.hatchedAt;
    const interest = seeded.state.companion.interests.find(entry => entry.kind === fixture.kind);
    interest.points = 2; interest.lastAt = seeded.state.lastTick;
    seeded.state.companion.history.completions.find(entry => entry.kind === fixture.kind).count = 2;
    seeded.state.companion.recent = { kind: fixture.kind, id: '0123456789abcdef0123456789abcdef', at: seeded.state.lastTick };
    const before = (await api('import', seeded.state)).state;
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [], label = `interest-${fixture.species}-${fixture.kind}-${mode.width}`;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor(); await open(page);
      await physical(page, 'a'); await physical(page, 'a');
      assert.equal(await page.locator('.quiet-interest').count(), 0, 'Familiarity needs an explicit B in quiet company');
      await physical(page, 'b');
      const cue = page.locator('.quiet-interest'), text = await cue.innerText();
      assert(text.includes(fixture.part), text); assert.doesNotMatch(text, fixture.absent);
      assert.equal(await cue.getAttribute('data-game'), fixture.kind);
      await readable(page); await cue.scrollIntoViewIfNeeded();
      const box = await cue.boundingBox(); assert(box && box.y >= -1 && box.y + box.height <= mode.height + 1);
      await cue.screenshot({ path: join(dir, `${label}.png`) });
      const sync = async () => {
        const response = page.waitForResponse(r => /\/api\/(state|visit)$/.test(new URL(r.url()).pathname));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        assert((await response).ok());
      };
      await sync(); assert.equal(await cue.innerText(), text, 'An ordinary read keeps the same species-aware cue');
      assert.deepEqual((await api('state')).state.companion, before.companion);
      const tied = (await api('backup'));
      const other = tied.companion.interests.find(entry => entry.kind === (fixture.kind === 'snake' ? 'walk' : 'snake'));
      other.points = 2; other.lastAt = tied.companion.recent.at;
      await api('import', tied); await sync();
      // Every import starts a new save generation, including same-pet imports.
      // Reopen the quiet page instead of treating its closure as a hidden cue.
      await page.locator('.home-caption').waitFor(); await open(page);
      await physical(page, 'a'); await physical(page, 'a'); await physical(page, 'b');
      assert.equal(await cue.count(), 0, 'Tied familiarity stays hidden after an explicit reply');
      await api('action', { kind: 'sleep' }); await sync();
      await page.waitForFunction(() => document.querySelector('.quiet-moment')?.getAttribute('data-sleeping') === 'true');
      await physical(page, 'b'); assert.equal(await cue.count(), 0);
      assert.match(await page.locator('.quiet-moment-copy > p').innerText(), /睡/);
      assert.equal((await api('state')).state.sleeping, true, 'Quiet company must not wake the pet');
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ label, fixtureFamiliarity: true, sleeping: true, writes, errors }); console.log('PASS', label);
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log);
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ dir, groups: results.length, serviceExited: server?.exitCode !== null || server?.signalCode !== null }));
}
