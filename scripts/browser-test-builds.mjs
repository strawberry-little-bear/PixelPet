// Fail before opening a port, importing Playwright or spawning a service. These
// regressions must opt into isolated artifacts, never silently test shared dist.
import assert from 'node:assert/strict';
import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inside = (path, parent) => {
  const part = relative(parent, path);
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`));
};
const optionalStat = async path => stat(path).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const sameFile = (left, right) => left && right && left.dev === right.dev && left.ino === right.ino;

export async function isolatedTestBuilds({ root = repository, env = process.env } = {}) {
  const binary = env.PIXELPET_TEST_BINARY, web = env.PIXELPET_TEST_WEB;
  assert(binary && isAbsolute(binary), 'Set absolute isolated PIXELPET_TEST_BINARY.');
  assert(web && isAbsolute(web), 'Set absolute isolated PIXELPET_TEST_WEB; shared web/dist is not a fallback.');
  const actualRoot = await realpath(root);
  const sharedBin = join(actualRoot, 'bin'), sharedWeb = join(actualRoot, 'web/dist');
  const protectedPaths = [sharedBin, sharedWeb];
  // Check both the requested name and its real target (including parent aliases).
  for (const path of [binary, web]) {
    assert(![join(root, 'bin'), join(root, 'web/dist')].some(parent => inside(resolve(path), resolve(parent))),
      'Do not use shared bin or web/dist for browser tests.');
  }
  for (const path of [...protectedPaths]) {
    try { protectedPaths.push(await realpath(path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const actualBinary = await realpath(binary), actualWeb = await realpath(web);
  const index = join(actualWeb, 'index.html'), actualIndex = await realpath(index);
  for (const path of [actualBinary, actualWeb, actualIndex]) {
    assert(!protectedPaths.some(parent => inside(path, parent)), 'Do not use shared bin or web/dist aliases for browser tests.');
  }
  const binaryStat = await stat(actualBinary), webStat = await stat(actualWeb), indexStat = await stat(index);
  assert(binaryStat.isFile(), 'PIXELPET_TEST_BINARY must be a file.');
  assert(webStat.isDirectory() && indexStat.isFile(), 'PIXELPET_TEST_WEB must be a built directory with index.html.');
  assert(!sameFile(binaryStat, await optionalStat(join(actualRoot, 'bin/pixelpet'))), 'Do not use a hard link to the shared binary.');
  assert(!sameFile(indexStat, await optionalStat(join(sharedWeb, 'index.html'))), 'Do not use a hard link to the shared web entry point.');
  return { binary: actualBinary, web: actualWeb };
}
