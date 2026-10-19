import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { request } from './api';
import { emptyGrowth } from './growth';
import type { PetState, Result } from './types';

vi.mock('./api', () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), message: '', serverTime: Date.now() });
const writes = () => api.mock.calls.filter(([path]) => ['action', 'import', 'reset', 'recap/read'].includes(path));
const flags = [{ name: 'composition flag', init: { isComposing: true } }, { name: 'legacy code 229', init: { keyCode: 229 } }];
const shortcuts = ['a', 'A', 'b', 'c', 'ArrowRight', 'ArrowDown', 'Enter', ' ', 'Escape'];
async function key(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
async function mount() { await act(async () => { render(<App />); }); }
async function menu(index = 0) { await key('a'); for (let i = 0; i < index; i++) await key('a'); }
const selection = () => document.querySelector('.care-item.selected')?.textContent;
async function preview() {
  const text = JSON.stringify({ ...saved, name: '备份里的伙伴' });
  const file = new File([text], 'keyboard-backup.json');
  Object.defineProperty(file, 'text', { value: async () => text });
  await act(async () => { fireEvent.change(screen.getByLabelText('导入存档文件'), { target: { files: [file] } }); });
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  saved = { schema: 12, revision: 1, species: 2, name: '键盘伙伴', createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, growth: emptyGrowth('baby'),
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  api.mockImplementation(async (path, body) => {
    if (path === 'action') {
      const action = body as { kind: string };
      if (action.kind === 'feed') { saved.needs.hunger += 20; saved.careCount++; }
      if (action.kind === 'sleep') saved.sleeping = !saved.sleeping;
      if (action.kind === 'hatch') { saved.hatchedAt = Date.now(); saved.growth = emptyGrowth('baby'); }
      saved.revision++;
    }
    if (path === 'import') saved = { ...(body as PetState), revision: saved.revision + 1 };
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

for (const flag of flags) describe(flag.name, () => {
  it.each(shortcuts)('does not turn composing %j into menu movement or care', async value => {
    await mount(); await menu(); const before = selection();
    const event = await key(value, flag.init);
    expect(selection()).toBe(before); expect(document.querySelector('.content-menu')).toBeTruthy();
    expect(event.defaultPrevented).toBe(false); expect(writes()).toHaveLength(0);
  });
  it('does not wake a sleeping companion', async () => {
    saved.sleeping = true; await mount(); await menu(3);
    const event = await key('Enter', flag.init, screen.getByRole('button', { name: 'B 确认' }));
    expect(saved.sleeping).toBe(true); expect(selection()).toContain('起床啦'); expect(writes()).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
    await key('b'); expect(saved.sleeping).toBe(false); expect(writes()).toHaveLength(1);
  });
  it('does not hatch or replace a save before a normal confirmation', async () => {
    saved.hatchedAt = 0; saved.growth = emptyGrowth('egg'); await mount(); await key('b');
    await key('Enter', flag.init); expect(saved.hatchedAt).toBe(0); expect(writes()).toHaveLength(0);
    await key('b'); expect(saved.hatchedAt).toBeGreaterThan(0); expect(writes()).toHaveLength(1);
  });
  it('does not import a preview from an IME confirmation key', async () => {
    await mount(); await preview(); expect(document.querySelector('.import-preview')).toBeTruthy();
    await key('Enter', flag.init, screen.getByRole('button', { name: 'B 确认' }));
    expect(document.querySelector('.import-preview')).toBeTruthy(); expect(saved.name).toBe('键盘伙伴'); expect(writes()).toHaveLength(0);
    await key('b'); expect(saved.name).toBe('备份里的伙伴'); expect(writes()).toHaveLength(1);
  });
  it.each(['b','c'])('does not catch or open abandon confirmation on composing %s', async value => {
    saved.game = { id: '1'.repeat(32), startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 };
    await mount(); await key(value, flag.init);
    expect(document.querySelector('.content-game')).toBeTruthy(); expect(document.querySelector('.game-abandon')).toBeNull(); expect(writes()).toHaveLength(0);
  });
  it.each(['Escape', 'Tab'])('does not close a modal or trap composing %s', async value => {
    await mount(); fireEvent.click(screen.getByRole('button', { name: '玩法说明' }));
    const close = screen.getByRole('button', { name: '关闭' }); close.focus();
    const event = await key(value, { ...flag.init, shiftKey: true }, close);
    expect(screen.getByRole('dialog')).toBeTruthy(); expect(document.activeElement).toBe(close);
    expect(event.defaultPrevented).toBe(false); expect(writes()).toHaveLength(0);
    await key('Escape', {}, close); expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('respects a key another handler has already consumed', async () => {
  await mount(); await menu(); const before = selection();
  const consume = (e: KeyboardEvent) => e.preventDefault();
  document.addEventListener('keydown', consume);
  try { const event = await key('b', {}, document.body); expect(event.defaultPrevented).toBe(true); }
  finally { document.removeEventListener('keydown', consume); }
  expect(selection()).toBe(before); expect(writes()).toHaveLength(0);
});
it('does not steal shortcuts from a content-editable target', async () => {
  await mount(); await menu();
  const editor = document.createElement('div'); editor.contentEditable = 'true';
  // jsdom does not implement native inherited editability. Real-browser QA
  // covers that behavior; this models the DOM property read by the handler.
  Object.defineProperty(editor, 'isContentEditable', { value: true }); document.body.append(editor);
  try {
    for (const value of shortcuts) expect((await key(value, {}, editor)).defaultPrevented).toBe(false);
    expect(selection()).toContain('吃点东西'); expect(writes()).toHaveLength(0);
  } finally { editor.remove(); }
});
it.each(['b', 'B', 'Enter', ' '])('normal %j still confirms exactly one saved meal', async value => {
  await mount(); await menu(); expect((await key(value)).defaultPrevented).toBe(true);
  expect(writes()).toHaveLength(1); expect(saved.careCount).toBe(1);
});
it.each(['a', 'A', 'ArrowRight', 'ArrowDown'])('normal %j still moves one menu item', async value => {
  await mount(); await menu(); await key(value); expect(selection()).toContain('一起玩耍'); expect(writes()).toHaveLength(0);
});
it.each(['c', 'C', 'Escape'])('normal %j still returns home without a write', async value => {
  await mount(); await menu(); await key(value); expect(document.querySelector('.content-home')).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it('physical buttons still perform A/B/C independently of keyboard filters', async () => {
  await mount(); fireEvent.click(screen.getByRole('button', { name: 'A 选择' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'B 确认' })); });
  expect(saved.careCount).toBe(1); fireEvent.click(screen.getByRole('button', { name: 'C 返回' }));
  expect(writes()).toHaveLength(1); expect(document.querySelectorAll('.physical-button')).toHaveLength(3);
  expect(document.querySelector('.lcd button,.lcd input,.lcd a')).toBeNull();
});
