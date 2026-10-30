import assert from 'node:assert/strict';

export const READING_SHELL_SELECTORS = [
  '.device-stage',
  '.device',
  '.screen-bezel',
  '.lcd',
  '.lcd-content',
];

export async function readReadingShell(page) {
  return page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing reading shell element: ${selector}`);
    const style = getComputedStyle(element);
    return [selector, {
      height: element.getBoundingClientRect().height,
      cssHeight: style.height,
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }];
  })), READING_SHELL_SELECTORS);
}

export function assertSameReadingShell(actual, expected, label) {
  for (const selector of READING_SHELL_SELECTORS) {
    assert(Math.abs(actual[selector].height - expected[selector].height) < 1,
      `${label} ${selector} height changed: ${actual[selector].height} vs ${expected[selector].height}`);
    assert.equal(actual[selector].cssHeight, expected[selector].cssHeight,
      `${label} ${selector} CSS height changed: ${actual[selector].cssHeight} vs ${expected[selector].cssHeight}`);
  }
}

export function assertBoundedReadingShell(metrics, label) {
  for (const selector of READING_SHELL_SELECTORS) {
    assert.notEqual(metrics[selector].cssHeight, 'auto',
      `${label} ${selector} reverted to auto height`);
  }
  assert.equal(metrics['.lcd-content'].overflowY, 'auto',
    `${label} LCD content is not independently scrollable`);
  assert(metrics['.lcd-content'].clientHeight > 0,
    `${label} LCD content has no readable viewport`);
}
