import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useBackupExport } from './useBackupExport';
import { request } from './api';
import { emptyGrowth } from './growth';
import type { PetState } from './types';
vi.mock('./api', () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const fetching = vi.fn<typeof fetch>();
const create = vi.fn((_blob: Blob) => 'blob:backup-test'), revoke = vi.fn();
let click: ReturnType<typeof vi.spyOn>;
const backup = () => new Response(JSON.stringify(saved), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
async function mount(reset = false) {
  await act(async () => { render(<App />); });
  fireEvent.click(screen.getByRole('button', { name: '存档盒' }));
  if (reset) fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
}
async function exportNow(reset = false) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: reset ? '先导出当前存档' : '导出存档' })); });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); fetching.mockReset(); create.mockClear(); revoke.mockClear();
  vi.stubGlobal('fetch', fetching);
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  saved = { schema: 2, revision: 1, species: 2, name: '当前伙伴', createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000,
    lastTick: Date.now(), sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, growth: emptyGrowth('baby'), logs: [] };
  api.mockImplementation(async () => ({ state: structuredClone(saved), serverTime: Date.now(), message: '' }));
  fetching.mockImplementation(async () => backup());
});
afterEach(() => { cleanup(); click.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('explicit backup download feedback', () => {
  it.each([false, true])('downloads the original JSON and does not claim disk success (reset %s)', async reset => {
    await mount(reset); const before = structuredClone(saved);
    await exportNow(reset);
    expect(fetching).toHaveBeenCalledTimes(1);
    expect(fetching).toHaveBeenCalledWith('/api/backup', expect.objectContaining({ cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
    expect(create).toHaveBeenCalledTimes(1); expect(await create.mock.calls[0]?.[0]?.text()).toBe(JSON.stringify(saved));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('已交给浏览器');
    expect(screen.getByRole('status').textContent).toContain('确认文件已保存');
    expect(saved).toEqual(before); expect(api.mock.calls.some(([p]) => p === 'reset' || p === 'import')).toBe(false);
    expect(document.querySelector('.lcd button,.lcd a,.lcd input')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(60000); }); expect(revoke).toHaveBeenCalledWith('blob:backup-test');
  });
  it.each([409, 503])('keeps an HTTP %i failure visible and permits an explicit retry', async status => {
    await mount(); fetching.mockResolvedValueOnce(new Response(JSON.stringify({ error: '存档需要修复', code: 'save_corrupt' }), { status }));
    await exportNow(); expect(screen.getByRole('alert').textContent).toContain('导出失败');
    expect(screen.getByRole('alert').textContent).toContain('存档需要修复');
    expect(create).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled(); expect(document.querySelector('.tools-menu')).toBeTruthy();
    await exportNow(); expect(create).toHaveBeenCalledTimes(1); expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each([
    ['invalid JSON', '{', 'application/json'], ['HTML', '<h1>Error</h1>', 'text/html'],
    ['error envelope', '{"error":"失败"}', 'application/json'], ['empty', '', 'application/json'],
    ['too large', ' '.repeat(65537), 'application/json'], ['wrong type', 'null', 'application/json'],
  ])('does not download a successful response containing %s', async (_, text, mime) => {
    await mount(); fetching.mockResolvedValueOnce(new Response(text, { headers: { 'Content-Type': mime } }));
    await exportNow(); expect(screen.getByRole('alert').textContent).toContain('导出失败'); expect(create).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
  });
  it('reports a network failure without an uncertain-save warning', async () => {
    await mount(); fetching.mockRejectedValueOnce(new TypeError('Failed to fetch')); await exportNow();
    expect(screen.getByRole('alert').textContent).toContain('导出失败'); expect(screen.queryByText(/可能已经保存/)).toBeNull(); expect(create).not.toHaveBeenCalled();
  });
  it('locks duplicate downloads and destructive actions until the download request finishes', async () => {
    await mount(); const gate = deferred<Response>(); fetching.mockReturnValueOnce(gate.promise);
    await exportNow(); await exportNow(); expect(fetching).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '导入备份' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '重新开始' })).toHaveProperty('disabled', true);
    await act(async () => { gate.resolve(backup()); }); expect(create).toHaveBeenCalledTimes(1);
  });
  it('blocks reset confirmation while its backup is in flight', async () => {
    await mount(true); fireEvent.change(screen.getByRole("textbox", { name: "重新开始确认文字" }), { target: { value: saved.name } });
    const gate = deferred<Response>(); fetching.mockReturnValueOnce(gate.promise); await exportNow(true);
    const confirm = screen.getByRole('button', { name: '确认重新开始' }); expect(confirm).toHaveProperty('disabled', true); fireEvent.click(confirm);
    expect(api.mock.calls.some(([p]) => p === 'reset')).toBe(false);
    await act(async () => { gate.resolve(backup()); }); expect(confirm).toHaveProperty('disabled', false);
  });
  it('times out, permits retry and ignores a transport that resolves after cancellation', async () => {
    await mount(); const gate = deferred<Response>(); fetching.mockReturnValueOnce(gate.promise); await exportNow();
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(screen.getByRole('alert').textContent).toContain('导出失败');
    expect(fetching.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await exportNow(); expect(create).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(backup()); }); expect(create).toHaveBeenCalledTimes(1);
  });
  it('aborts on unmount without a late download', async () => {
    await mount(); const gate = deferred<Response>(); fetching.mockReturnValueOnce(gate.promise); await exportNow(); cleanup();
    expect(fetching.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { gate.resolve(backup()); }); expect(create).not.toHaveBeenCalled();
  });
});

describe('export cancellation and browser handoff failures', () => {
  it('does not fetch while recovery or another write disables export', async () => {
    const { result } = renderHook(() => useBackupExport(false));
    await act(async () => { await result.current.download(); });
    expect(fetching).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it('cancels a pending response when export becomes unavailable and ignores its late result', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useBackupExport(enabled), { initialProps: { enabled: true } });
    const gate = deferred<Response>(); fetching.mockReturnValueOnce(gate.promise);
    await act(async () => { void result.current.download(); });
    rerender({ enabled: false }); expect(fetching.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { gate.resolve(backup()); });
    expect(create).not.toHaveBeenCalled(); expect(result.current.pending).toBe(false); expect(result.current.feedback).toBeNull();
  });
  it('revokes the object URL on unmount before its grace timer expires', async () => {
    await mount(); await exportNow(); expect(revoke).not.toHaveBeenCalled(); cleanup();
    expect(revoke).toHaveBeenCalledWith('blob:backup-test');
    await act(async () => { vi.advanceTimersByTime(60000); }); expect(revoke).toHaveBeenCalledTimes(1);
  });
  it.each(['object URL', 'anchor'])('reports a browser %s handoff failure and permits retry', async which => {
    await mount();
    if (which === 'object URL') create.mockImplementationOnce(() => { throw new Error('浏览器无法创建下载'); });
    else click.mockImplementationOnce(() => { throw new Error('浏览器无法启动下载'); });
    await exportNow(); expect(screen.getByRole('alert').textContent).toContain('导出失败');
    expect(document.querySelector('a[download]')).toBeNull();
    await exportNow(); expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByRole('status').textContent).toContain('已交给浏览器');
  });
});
