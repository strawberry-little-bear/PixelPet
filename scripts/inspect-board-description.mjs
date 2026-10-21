// Inspect Chrome's actual accessibility description, not just an SVG <desc> in DOM.
// Read-only helper for the isolated snake/tetris HTTP journeys.
import assert from 'node:assert/strict';
// Chrome may insert whitespace between React text nodes when computing SVG descriptions.
const normalize = value => value.replace(/\s+/g, ' ').trim();
const compact = value => value.replace(/\s+/g, '');
const coord = p => `${p.y + 1} 行 ${p.x + 1} 列`;
const names = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
export async function inspectBoardDescription(page, kind, state) {
  const selector = kind === 'snake' ? '.snake-field > svg' : '.tetris-field > svg';
  const board = page.locator(selector);
  const snapshot = await board.evaluate(svg => {
    const desc = document.getElementById(svg.getAttribute('aria-describedby'));
    const cells = selector => Array.from(svg.querySelectorAll(selector), el => ({
      x: Math.floor(Number(el.getAttribute('x')) / 10), y: Math.floor(Number(el.getAttribute('y')) / 10),
    }));
    return { description: desc?.textContent, connected: !!desc && svg.contains(desc),
      live: svg.closest('[aria-live]')?.getAttribute('aria-live') ?? null,
      fixed: cells('.locked-block'), active: cells('.active-block > rect'), ghost: cells('.ghost-block'),
      bodies: Array.from(svg.children).filter(el => el.tagName.toLowerCase() === 'g' && el.querySelector('rect'))
        .map(el => el.getAttribute('transform')),
      patternValid: !svg.querySelector('pattern') || svg.querySelector('rect[fill^="url("]')?.getAttribute('fill') === `url(#${svg.querySelector('pattern').id})`,
    };
  });
  assert(snapshot.connected); assert.equal(snapshot.live, null); assert(snapshot.patternValid);
  assert.equal(typeof snapshot.description, 'string'); const text = normalize(snapshot.description);
  assert(text.includes('行从上到下、列从左到右，均从 1 开始'));
  assert(text.includes(state.end ? '本局已结束' : '当前暂停'));
  if (kind === 'snake') {
    assert(text.includes('棋盘 10 行 12 列'));
    assert(text.includes(`蛇头：${coord(state.body[0])}，朝${['右', '下', '左', '上'][state.direction]}`));
    assert(text.includes(`其余蛇身由头至尾：${state.body.slice(1).map(coord).join('；') || '无'}`));
    assert.deepEqual(snapshot.bodies, state.body.map(p => `translate(${p.x * 12} ${p.y * 12})`));
    if (state.end === 'won') assert(!text.includes('果子：')); else assert(text.includes(`果子：${coord(state.food)}`));
  } else {
    assert(text.includes('棋盘 12 行 8 列'));
    const fixed = state.board.flatMap((v, i) => v ? [{ x: i % 8, y: Math.floor(i / 8) }] : []);
    assert.deepEqual(snapshot.fixed, fixed);
    assert(text.includes(`已固定：${fixed.map(coord).join('；') || '无'}`));
    if (state.active) {
      assert.equal(snapshot.active.length, 4); assert.equal(snapshot.ghost.length, 4);
      assert(text.includes(`当前积木：${names[state.active.kind - 1]} 型，顺时针旋转 ${state.active.kind === 2 ? 0 : state.active.rotation * 90} 度`));
      assert(text.includes(`占据 ${snapshot.active.map(coord).join('；')}`));
      assert(text.includes(`落点投影：${snapshot.ghost.map(coord).join('；')}`));
    } else {
      assert.equal(snapshot.active.length, 0); assert.equal(snapshot.ghost.length, 0);
      assert(text.includes('当前积木：无')); assert(!text.includes('落点投影：'));
    }
    assert(text.includes(`下一块：${names[state.next - 1]} 型`));
  }
  const client = await page.context().newCDPSession(page);
  try {
    const { root } = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { nodes } = await client.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const image = nodes.find(node => !node.ignored && node.role?.value === 'image');
    assert(image, 'board is absent from Chrome accessibility tree');
    assert.equal(compact(image.description?.value ?? ''), compact(text), 'Chrome did not expose the full board description');
    return { name: image.name?.value, description: text };
  } finally { await client.detach(); }
}
