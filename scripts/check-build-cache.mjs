// Build only a temporary source copy. Never overwrite a player's web/dist,
// binary, database or running server. Both builds use the same installed deps.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = await realpath(await mkdtemp(join(tmpdir(), 'pixelpet-build-cache-')));
const source = join(dir, 'source');
await mkdir(source);
for (const path of ['src', 'public', 'index.html', 'vite.config.ts', 'package.json']) {
  await cp(join(root, 'web', path), join(source, path), { recursive: true });
}
await symlink(join(root, 'web/node_modules'), join(source, 'node_modules'), 'dir');
const vite = await realpath(join(root, 'web/node_modules/vite/bin/vite.js'));
async function build(label) {
  const out = join(dir, label);
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    [vite, 'build', '--manifest', '--outDir', out], { cwd: source, maxBuffer: 2 * 1024 * 1024 });
  await writeFile(join(dir, `${label}.log`), stdout + stderr);
  const manifest = JSON.parse(await readFile(join(out, '.vite/manifest.json'), 'utf8'));
  const entries = Object.entries(manifest);
  const entry = entries.find(([, chunk]) => chunk.isEntry);
  assert(entry, 'Missing build entry');
  const runtime = entries.find(([, chunk]) => chunk.name === 'react-vendor');
  assert(runtime, 'React must be separate from the changing game bundle');
  assert((entry[1].imports ?? []).includes(runtime[0]), 'The entry must load the runtime eagerly, not suspend gameplay');
  assert.deepEqual(runtime[1].imports ?? [], [], 'Stable runtime must not import changing game code');
  const sizes = [];
  for (const [key, chunk] of entries) {
    for (const dep of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) assert(manifest[dep], `Broken manifest import: ${dep}`);
    const bytes = await readFile(join(out, chunk.file));
    if (chunk.file.endsWith('.js')) {
      assert(bytes.length <= 500_000, `${chunk.file} exceeds Vite's existing 500kB warning threshold`);
      sizes.push({ file: chunk.file, bytes: bytes.length, gzip: gzipSync(bytes).length });
    }
    for (const css of chunk.css ?? []) await readFile(join(out, css));
  }
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert(html.match(/<script\b[^>]*type="module"[^>]*>/g)?.some(tag => tag.includes(entry[1].file)), 'HTML must load the module entry');
  assert(html.match(/<link\b[^>]*rel="modulepreload"[^>]*>/g)?.some(tag => tag.includes(runtime[1].file)), 'HTML must eagerly preload the runtime');
  assert(!/Some chunks are larger/.test(stdout + stderr), 'Do not hide or raise the existing bundle warning');
  return { out, entry: entry[1].file, runtime: runtime[1].file, sizes };
}
try {
  const before = await build('before');
  // Change only temporary app source. A comment may be minified away, so use
  // an observable instruction; it never enters the real workspace or release.
  const main = join(source, 'src/main.tsx');
  await writeFile(main, await readFile(main, 'utf8') + '\ndocument.documentElement.dataset.buildCacheProbe = "isolated-cache-check";\n');
  const after = await build('after');
  assert.notEqual(before.entry, after.entry, 'Changing app code must change its content-hashed entry');
  assert.equal(before.runtime, after.runtime, 'An app-only update must keep the React filename/cache key stable');
  assert.deepEqual(await readFile(join(before.out, before.runtime)), await readFile(join(after.out, after.runtime)),
    'A stable runtime name is insufficient: bytes must match too');
  await writeFile(join(dir, 'results.json'), JSON.stringify({ before, after }, null, 2));
  console.log('PASS: app changes, React bytes/hash stay stable; eager imports and original size limit checked');
  console.log(JSON.stringify({ artifacts: dir, before, after }, null, 2));
} catch (error) {
  console.error('Build/cache artifacts:', dir);
  throw error;
}
