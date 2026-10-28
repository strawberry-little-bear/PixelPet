// Run the bounded reading-layout regressions from one repeatable entry point.
// Each child owns its temporary server, database, port and browser context.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const allSuites = [
  'check-welcome-reading',
  'check-care-menu-reading',
  'check-care-reading',
  'check-journal-reading',
  'check-memory-reading-keyboard',
  'check-album-reading',
  'check-collection-reading',
  'check-shop-reading',
  'check-status-reading',
  'check-name-layout',
  'check-growth-basis',
  'check-growth-meters',
  'check-growth-response',
  'check-habit-rest-guide',
  'check-arcade-reading',
  'check-pause-guide',
  'check-game-reading-layout',
  'check-stars-reading',
  'check-tile-reading',
  'check-reading-notices',
  'check-return-layout',
  'check-return-scroll',
  'check-return-viewport',
  'check-return-touch',
  'check-recovery-reading',
  'check-game-keepsakes',
];

const requested = process.argv.slice(2).map(value => value.replace(/\.mjs$/, ''));
const suites = requested.length ? requested : allSuites;
assert(suites.every(suite => allSuites.includes(suite)),
  `Unknown suite. Choose from: ${allSuites.join(', ')}`);

for (const suite of suites) {
  await access(join(root, 'scripts', `${suite}.mjs`));
}

const failures = [];
for (const [index, suite] of suites.entries()) {
  const started = Date.now();
  console.log(`\n[reading-layout ${index + 1}/${suites.length}] ${suite}`);
  const result = await new Promise(resolveResult => {
    const child = spawn(process.execPath, [join(root, 'scripts', `${suite}.mjs`)], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', error => resolveResult({ code: 1, signal: null, error }));
    child.once('exit', (code, signal) => resolveResult({ code: code ?? 1, signal }));
  });
  const elapsed = `${((Date.now() - started) / 1000).toFixed(1)}s`;
  if (result.code === 0) {
    console.log(`[reading-layout] PASS ${suite} (${elapsed})`);
    continue;
  }
  const detail = result.error?.message || (result.signal ? `signal ${result.signal}` : `exit ${result.code}`);
  console.error(`[reading-layout] FAIL ${suite} (${elapsed}): ${detail}`);
  failures.push({ suite, detail });
}

if (failures.length) {
  console.error(`\n[reading-layout] ${failures.length}/${suites.length} suite(s) failed.`);
  for (const failure of failures) console.error(`- ${failure.suite}: ${failure.detail}`);
  process.exitCode = 1;
} else {
  console.log(`\n[reading-layout] PASS ${suites.length}/${suites.length} suites.`);
}
