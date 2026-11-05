// Keep the bounded reading shell contract explicit at the source level. The
// browser suites catch computed geometry regressions; this check catches a
// later CSS override that accidentally makes the physical shell auto-height.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const cssFiles = (await readdir(join(root, 'web/src')))
  .filter(file => file.endsWith('.css'))
  .sort();
const cssSources = await Promise.all(cssFiles.map(async file => [
  file,
  await readFile(join(root, 'web/src', file), 'utf8'),
]));
const sourceByFile = new Map(cssSources);
const readability = sourceByFile.get('readability.css');
const treasure = sourceByFile.get('treasure.css');
assert(readability && treasure, 'reading CSS sources are missing');

const requireSelector = (source, selector, label) => {
  assert(source.includes(selector), `missing bounded reading selector: ${label}`);
};

const requireRule = (source, pattern, label) => {
  assert(pattern.test(source), `missing bounded reading rule: ${label}`);
};

for (const [selector, label] of [
  ['.device-stage.bounded-reading-mode:not(.return-mode):not(.treasure-mode)', 'stage'],
  ['.bounded-reading-mode:not(.return-mode):not(.treasure-mode) .device', 'device'],
  ['.bounded-reading-mode:not(.return-mode):not(.treasure-mode) .screen-bezel', 'screen bezel'],
  ['.bounded-reading-mode:not(.return-mode):not(.treasure-mode) .lcd', 'LCD'],
  ['.bounded-reading-mode:not(.return-mode):not(.treasure-mode) .lcd-content', 'LCD content'],
]) {
  requireSelector(readability, selector, label);
}

requireRule(readability, /\.device-stage\.bounded-reading-mode\.return-mode\s*\{[^}]*height:\s*var\(--reading-stage-height\)/s, 'return stage');
requireRule(readability, /\.device-stage\.bounded-reading-mode\.return-mode \.screen-bezel\s*\{[^}]*height:\s*var\(--reading-screen-height\)/s, 'return screen bezel');
requireRule(readability, /\.device-stage\.bounded-reading-mode\.return-mode \.lcd-content\s*\{[^}]*overflow-y:\s*auto/s, 'return LCD scroll');
requireRule(readability, /\.return-mode \.return-panel\s*\{[^}]*overflow-y:\s*auto/s, 'return panel scroll');

requireRule(treasure, /\.device-stage\.treasure-mode\.reading-mode:not\(\.recovery-mode\):not\(\.return-mode\)\s*\{[^}]*height:\s*735px/s, 'treasure stage');
requireRule(treasure, /\.device-stage\.treasure-mode\.reading-mode:not\(\.recovery-mode\):not\(\.return-mode\) \.lcd-content\s*\{[^}]*overflow-y:\s*auto/s, 'treasure LCD scroll');
requireRule(readability, /\.bounded-reading-mode\.tiles-mode \.lcd-content\s*\{[^}]*overflow-y:\s*auto/s, 'tiles LCD scroll');

// Natural height is intentional for recovery explanations and wrapped child
// content. It must never be reintroduced on the physical reading shell. The
// shell class must be the final target compound; a child such as
// `.lcd-content .journal-detail` is content and is allowed to grow naturally.
const shellClasses = ['device-stage', 'device', 'screen-bezel', 'lcd', 'lcd-content'];
const readingMode = /(?:^|[.\s])(?:reading-mode|bounded-reading-mode|game-reading-mode)(?:$|[-\s.:])/;
const recoveryMode = /(?:^|[.\s])recovery-mode(?:$|[-\s.:])/;
const targetsShell = selector => selector.split(',').some(part => {
  const target = part.trim().replace(/\s+/g, ' ');
  return shellClasses.some(shell => new RegExp(
    `(?:^|[>+~\\s])\\.${shell}(?=$|[.#:\\[])[^\\s>+~]*$`,
  ).test(target));
});

let autoHeightRules = 0;
for (const [file, source] of cssSources) {
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*height:\s*auto[^{}]*)\}/g)) {
    const selector = match[1].trim();
    if (!readingMode.test(selector) || !targetsShell(selector)) continue;
    autoHeightRules += 1;
    assert(recoveryMode.test(selector) && !selector.includes('return-mode'),
      `${file}: reading shell must not use auto height outside recovery mode (${selector})`);
  }
}

assert.equal(autoHeightRules, 0, 'unexpected non-recovery reading shell auto-height rule');
console.log(`Reading CSS shell contract: ${cssFiles.length} CSS files scanned; bounded shell rules and recovery auto-height boundary passed.`);
