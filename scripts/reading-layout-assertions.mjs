import assert from 'node:assert/strict';

export async function assertReadingFlow(page, selector, label = selector) {
  const result = await page.locator(selector).evaluate(target => {
    const lcd = target.closest('.lcd-content') ?? target;
    const boundary = lcd.getBoundingClientRect().bottom;
    const scrollports = [];
    for (let element = target; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight) scrollports.push(element);
      if (element === lcd) break;
    }
    const saved = scrollports.map(element => element.scrollTop);
    const nodes = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || node.parentElement.closest('[aria-hidden="true"]')) continue;
      const readingHint = node.parentElement.closest('[data-care-reading-start]');
      if (readingHint && getComputedStyle(readingHint).clipPath !== 'none') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
      if (rects.length) nodes.push({ node, rects });
    }
    const lcdRect = lcd.getBoundingClientRect();
    const errors = [];
    for (const { node, rects } of nodes) {
      for (const rect of rects) {
        if (rect.left < lcdRect.left - 1 || rect.right > lcdRect.right + 1) errors.push(`horizontal: ${node.textContent}`);
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
          if (['hidden', 'clip'].includes(style.overflowY) && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) errors.push(`hard clip: ${node.textContent}`);
          if (['hidden', 'clip'].includes(style.overflowX) && (rect.left < box.left - 1 || rect.right > box.right + 1)) errors.push(`hard horizontal clip: ${node.textContent}`);
          if (parent === lcd) break;
        }
      }
    }
    for (const port of scrollports) port.scrollTop = 0;
    const first = nodes[0]?.node;
    const firstRect = () => first && (() => { const range = document.createRange(); range.selectNodeContents(first); return [...range.getClientRects()].find(rect => rect.width && rect.height); })();
    for (const port of scrollports) {
      const rect = firstRect(), box = port.getBoundingClientRect();
      if (rect && rect.top < box.top) port.scrollTop += rect.top - box.top;
      else if (rect && rect.bottom > box.bottom) port.scrollTop += rect.bottom - box.bottom;
    }
    const firstVisible = firstRect();
    const startReachable = !firstVisible || (firstVisible.top >= lcdRect.top - 1 && firstVisible.bottom <= boundary + 1);
    const last = nodes.at(-1)?.node;
    const lastRect = () => last && (() => { const range = document.createRange(); range.selectNodeContents(last); return [...range.getClientRects()].filter(rect => rect.width && rect.height).at(-1); })();
    for (const port of scrollports) {
      const rect = lastRect(), box = port.getBoundingClientRect();
      if (rect && rect.top < box.top) port.scrollTop += rect.top - box.top;
      else if (rect && rect.bottom > box.bottom) port.scrollTop += rect.bottom - box.bottom;
    }
    const lastVisible = lastRect();
    const endReachable = !lastVisible || (lastVisible.top >= lcdRect.top - 1 && lastVisible.bottom <= boundary + 1);
    scrollports.forEach((port, index) => { port.scrollTop = saved[index]; });
    return {
      errors, startReachable, endReachable,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      endRect: lastVisible && { top: lastVisible.top, bottom: lastVisible.bottom },
      lcdRect: { top: lcdRect.top, bottom: lcdRect.bottom }, boundary,
      scrollports: scrollports.map(port => ({ className: port.className, top: port.scrollTop, max: port.scrollHeight - port.clientHeight })),
    };
  });
  assert.deepEqual(result.errors, [], `${label}: text is clipped by a non-scrollable container`);
  assert.equal(result.horizontalOverflow, false, `${label}: page has horizontal overflow`);
  assert.equal(result.startReachable, true, `${label}: first text is not reachable at the top: ${JSON.stringify(result)}`);
  assert.equal(result.endReachable, true, `${label}: final text is not reachable after scrolling: ${JSON.stringify(result)}`);
  return result;
}
