// Browser-level accessibility contract. Uses its own build, port and SQLite
// database so it cannot touch the player's saved data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-accessibility-contract-'));
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const port = await new Promise((resolvePort, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const value = typeof address === 'object' && address ? address.port : 0;
    server.close(error => error ? reject(error) : resolvePort(value));
  });
});
const base = `http://127.0.0.1:${port}`;
let server;
let browser;
let output = '';

async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert(response.ok, await response.clone().text());
  return response.json();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.equal(server.exitCode, null, output);
    try {
      if ((await fetch(`${base}/api/state`)).ok) return;
    } catch {
      // The service may still be binding its test port.
    }
    await wait(100);
  }
  assert.fail(`isolated service did not start:\n${output}`);
}

async function assertMachineKeys(page) {
  assert.deepEqual(
    await page.locator('.physical-button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))),
    ['A 选择', 'B 确认', 'C 返回'],
  );
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role="button"]').count(), 0);
  const screen = page.locator('[role="region"][aria-labelledby="lcd-page-title"]');
  assert.equal(await screen.count(), 1);
  const title = page.locator('#lcd-page-title');
  assert.match(await title.textContent(), /只能使用 A、B、C 按键操作/);
}

async function assertAccessibilityTree(page) {
  const session = await page.context().newCDPSession(page);
  const tree = await session.send('Accessibility.getFullAXTree');
  const names = tree.nodes
    .filter(node => node.role?.value === 'button')
    .map(node => node.name?.value)
    .filter(Boolean);
  assert(names.includes('A 选择'));
  assert(names.includes('B 确认'));
  assert(names.includes('C 返回'));
}

try {
  server = spawn(binary, [], {
    cwd: root,
    env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', data => { output += data; });
  server.stderr.on('data', data => { output += data; });
  await waitForServer();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.physical-button').first().waitFor();
  await assertMachineKeys(page);
  const fileInput = page.locator('input[type="file"]');
  assert.equal(await fileInput.isDisabled(), true);
  assert.equal(await fileInput.getAttribute('tabindex'), '-1');
  await assertAccessibilityTree(page);

  const helpButton = page.getByRole('button', { name: '玩法说明' });
  await helpButton.click();
  const helpDialog = page.getByRole('dialog');
  await helpDialog.waitFor();
  assert.equal(await helpDialog.getAttribute('aria-modal'), 'true');
  assert.equal(await helpDialog.getAttribute('aria-labelledby'), 'modal-title');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭');
  await page.keyboard.press('C');
  await helpDialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'C 返回');

  await helpButton.click();
  await helpDialog.waitFor();
  await page.keyboard.press('Escape');
  await helpDialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'C 返回');

  const now = Date.now();
  await api('import', {
    schema: 1,
    revision: 1,
    species: 2,
    name: '无障碍伙伴',
    createdAt: now - 3600000,
    hatchedAt: now - 3600000,
    lastTick: now,
    sleeping: false,
    needs: { hunger: 40, mood: 70, clean: 60, energy: 80 },
    careCount: 0,
    logs: [],
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.physical-button').first().waitFor();
  await page.getByRole('button', { name: '存档盒' }).click();
  assert.equal(await fileInput.isDisabled(), false);
  assert.equal(await fileInput.getAttribute('tabindex'), '0');
  await page.getByRole('button', { name: '存档盒' }).click();
  assert.equal(await fileInput.isDisabled(), true);
  assert.equal(await fileInput.getAttribute('tabindex'), '-1');

  await page.getByRole('button', { name: '存档盒' }).click();
  await page.getByRole('button', { name: '重新开始' }).click();
  const resetDialog = page.getByRole('dialog');
  await resetDialog.waitFor();
  assert.equal(await resetDialog.getAttribute('aria-modal'), 'true');
  await page.keyboard.press('C');
  await resetDialog.waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: '存档盒' }).getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'C 返回');

  await assertMachineKeys(page);
  await context.close();
  console.log(`Accessibility contract: machine keys, LCD semantics, modal C/Escape cancellation, focus restoration, file-input tab order and AX tree passed. Artifacts: ${dir}`);
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolveClosed => server.once('exit', resolveClosed));
    server.kill('SIGTERM');
    await closed;
  }
}
