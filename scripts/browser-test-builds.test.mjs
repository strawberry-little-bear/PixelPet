import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'pixelpet-build-guard-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'repo'), binary = join(dir, 'build/pixelpet'), web = join(dir, 'build/web');
  for (const path of [join(root, 'bin'), join(root, 'web/dist'), web]) await mkdir(path, { recursive: true });
  for (const path of [binary, join(root, 'bin/pixelpet'), join(web, 'index.html'), join(root, 'web/dist/index.html')]) await writeFile(path, 'fixture');
  return { dir, root, binary, web, env: { PIXELPET_TEST_BINARY: binary, PIXELPET_TEST_WEB: web } };
}
test('accepts isolated builds and returns canonical paths through harmless aliases', async t => {
  const f = await fixture(t), alias = join(f.dir, 'alias'); await symlink(join(f.dir, 'build'), alias);
  assert.deepEqual(await isolatedTestBuilds({ root: f.root, env: { PIXELPET_TEST_BINARY: join(alias, 'pixelpet'), PIXELPET_TEST_WEB: join(alias, 'web') } }), { binary: f.binary, web: f.web });
});
for (const key of ['PIXELPET_TEST_BINARY', 'PIXELPET_TEST_WEB']) {
  for (const value of [undefined, '', 'relative/path']) test(`${key} refuses ${JSON.stringify(value)} without defaults`, async t => {
    const f = await fixture(t); f.env[key] = value;
    await assert.rejects(isolatedTestBuilds({ root: f.root, env: f.env }), new RegExp(key));
  });
  for (const alias of ['direct', 'symlink', 'parent-symlink', 'hardlink']) test(`${key} refuses shared ${alias}`, async t => {
    const f = await fixture(t), shared = key.endsWith('BINARY') ? join(f.root, 'bin/pixelpet') : join(f.root, 'web/dist');
    let path = shared;
    if (alias === 'symlink') { path = join(f.dir, 'shared-alias'); await symlink(shared, path); }
    if (alias === 'parent-symlink') { const parent = join(f.dir, 'repo-alias'); await symlink(f.root, parent); path = join(parent, key.endsWith('BINARY') ? 'bin/pixelpet' : 'web/dist'); }
    if (alias === 'hardlink') {
      if (key.endsWith('BINARY')) { path = join(f.dir, 'shared-link'); await link(shared, path); }
      else { path = join(f.dir, 'linked-web'); await mkdir(path); await link(join(shared, 'index.html'), join(path, 'index.html')); }
    }
    f.env[key] = path; await assert.rejects(isolatedTestBuilds({ root: f.root, env: f.env }), /shared/);
  });
}
test('rejects an index symlink into shared dist', async t => {
  const f = await fixture(t); await rm(join(f.web, 'index.html'));
  await symlink(join(f.root, 'web/dist/index.html'), join(f.web, 'index.html'));
  await assert.rejects(isolatedTestBuilds({ root: f.root, env: f.env }), /shared/);
});
test('accepts isolated builds even when no shared artifacts exist', async t => {
  const f = await fixture(t); await rm(join(f.root, 'bin'), { recursive: true }); await rm(join(f.root, 'web/dist'), { recursive: true });
  assert.deepEqual(await isolatedTestBuilds({ root: f.root, env: f.env }), { binary: f.binary, web: f.web });
});
for (const kind of ['missing-binary', 'missing-web', 'directory-binary', 'missing-index', 'directory-index']) test(`rejects ${kind}`, async t => {
  const f = await fixture(t);
  if (kind === 'missing-binary') f.env.PIXELPET_TEST_BINARY = join(f.dir, 'absent');
  if (kind === 'missing-web') f.env.PIXELPET_TEST_WEB = join(f.dir, 'absent');
  if (kind === 'directory-binary') f.env.PIXELPET_TEST_BINARY = f.web;
  if (kind.endsWith('index')) { await rm(join(f.web, 'index.html')); if (kind === 'directory-index') await mkdir(join(f.web, 'index.html')); }
  await assert.rejects(isolatedTestBuilds({ root: f.root, env: f.env }));
});
const scripts = ['recovery-reading', 'growth-response', 'return-layout', 'return-scroll', 'return-viewport', 'return-touch', 'return-keyboard', 'sleep-progress', 'sleep-home', 'sleep-summary', 'care-growth-journey', 'fishing-catches', 'fishing-pulse-pause', 'walk-pulse-pause', 'board-pulse-pause', 'rested-memory'];
for (const script of scripts) {
  test(`${script} refuses missing web before browser import or service startup`, async t => {
    const f = await fixture(t), env = { ...process.env, PIXELPET_TEST_BINARY: f.binary, PIXELPET_PLAYWRIGHT_MODULE: join(f.dir, 'no-playwright.mjs') };
    delete env.PIXELPET_TEST_WEB;
    await assert.rejects(promisify(execFile)(process.execPath, [join(repository, `scripts/check-${script}.mjs`)], { env, timeout: 10000 }), error => {
      assert.match(error.stderr, /Set absolute isolated PIXELPET_TEST_WEB/);
      assert.doesNotMatch(error.stderr, /ERR_MODULE_NOT_FOUND/); return true;
    });
  });
  test(`${script} forwards the explicit web build and creates its own database/address`, async t => {
    const f = await fixture(t), trace = join(f.dir, 'trace.json'), playwright = join(f.dir, 'playwright.mjs');
    await writeFile(playwright, 'export const chromium = {};');
    await writeFile(f.binary, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.TEST_TRACE, JSON.stringify({web:process.env.PIXELPET_WEB,db:process.env.PIXELPET_DB,addr:process.env.PIXELPET_ADDR})); process.exit(23);`);
    await chmod(f.binary, 0o755);
    const env = { ...process.env, ...f.env, TMPDIR: f.dir, PIXELPET_PLAYWRIGHT_MODULE: playwright, TEST_TRACE: trace,
      PIXELPET_TEST_ARTIFACTS: join(f.dir, 'artifacts'), PIXELPET_TEST_SCOPE: 'all',
      PIXELPET_DB: join(f.dir, 'do-not-use.db'), PIXELPET_ADDR: '127.0.0.1:18102', PIXELPET_WEB: join(repository, 'web/dist') };
    // Intentional early server failure: this is startup plumbing, not a browser test.
    await assert.rejects(promisify(execFile)(process.execPath, [join(repository, `scripts/check-${script}.mjs`)], { env, timeout: 10000 }));
    const captured = JSON.parse(await readFile(trace, 'utf8'));
    assert.equal(captured.web, f.web); assert.notEqual(captured.db, env.PIXELPET_DB);
    assert(captured.db.startsWith(f.dir + '/')); assert(captured.db.endsWith('/test.db'));
    assert.match(captured.addr, /^127\.0\.0\.1:\d+$/); assert.notEqual(captured.addr, env.PIXELPET_ADDR);
    await assert.rejects(readFile(env.PIXELPET_DB), { code: 'ENOENT' });
  });
}

for (const nextWeb of [undefined, 'relative', 'shared']) {
  test(`runtime cache refuses ${nextWeb ?? 'missing'} next build before browser import`, async t => {
    const f = await fixture(t), env = { ...process.env, ...f.env, PIXELPET_PLAYWRIGHT_MODULE: join(f.dir, 'no-playwright.mjs') };
    delete env.PIXELPET_CACHE_NEXT_WEB;
    if (nextWeb) env.PIXELPET_CACHE_NEXT_WEB = nextWeb === 'shared' ? join(repository, 'web/dist') : nextWeb;
    await assert.rejects(promisify(execFile)(process.execPath, [join(repository, 'scripts/check-runtime-cache.mjs')], { env, timeout: 10000 }), error => {
      assert.match(error.stderr, nextWeb === 'shared' ? /shared/ : /Set absolute isolated PIXELPET_TEST_WEB/);
      assert.doesNotMatch(error.stderr, /ERR_MODULE_NOT_FOUND/); return true;
    });
  });
}
test('runtime cache serves only temporary copies with its own database and address', async t => {
  const f = await fixture(t), next = join(f.dir, 'next'), trace = join(f.dir, 'cache-trace.json'), playwright = join(f.dir, 'playwright.mjs');
  for (const [web, app] of [[f.web, 'before.js'], [next, 'after.js']]) {
    await mkdir(join(web, '.vite'), { recursive: true });
    await writeFile(join(web, 'index.html'), 'fixture');
    await writeFile(join(web, 'runtime.js'), 'stable runtime');
    await writeFile(join(web, '.vite/manifest.json'), JSON.stringify({ entry: { isEntry: true, file: app }, runtime: { name: 'react-vendor', file: 'runtime.js' } }));
  }
  await writeFile(playwright, 'export const chromium = {};');
  await writeFile(f.binary, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.TEST_TRACE, JSON.stringify({web:process.env.PIXELPET_WEB,db:process.env.PIXELPET_DB,addr:process.env.PIXELPET_ADDR})); process.exit(23);`);
  await chmod(f.binary, 0o755);
  const env = { ...process.env, ...f.env, TMPDIR: f.dir, PIXELPET_CACHE_NEXT_WEB: next,
    PIXELPET_PLAYWRIGHT_MODULE: playwright, TEST_TRACE: trace, PIXELPET_DB: join(f.dir, 'do-not-use.db'),
    PIXELPET_ADDR: '127.0.0.1:18102', PIXELPET_WEB: join(repository, 'web/dist') };
  await assert.rejects(promisify(execFile)(process.execPath, [join(repository, 'scripts/check-runtime-cache.mjs')], { env, timeout: 10000 }));
  const captured = JSON.parse(await readFile(trace, 'utf8'));
  assert(captured.web.startsWith(f.dir + '/')); assert.notEqual(captured.web, f.web); assert.notEqual(captured.web, next);
  assert(captured.db.startsWith(f.dir + '/')); assert(captured.db.endsWith('/test.db'));
  assert.match(captured.addr, /^127\.0\.0\.1:\d+$/); assert.notEqual(captured.addr, env.PIXELPET_ADDR);
  await assert.rejects(readFile(env.PIXELPET_DB), { code: 'ENOENT' });
});
