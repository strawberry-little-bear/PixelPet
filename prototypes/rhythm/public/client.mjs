// A standalone diagnostic client. No imports from the production game and no
// audio, database, service worker, or game API calls. Session storage holds
// only a same-tab lab-session pointer, never observations or timing authority.
const $ = id => document.getElementById(id);
const sessionKey = 'pixelpet.rhythm.session.v1';
function savedSession() {
  try {
    const value = sessionStorage.getItem(sessionKey);
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
  } catch { return null; }
}
function rememberSession(id) {
  try { if (id) sessionStorage.setItem(sessionKey, id); else sessionStorage.removeItem(sessionKey); } catch { /* Storage is optional; server state remains authoritative. */ }
}
let savedId = savedSession(), lease = null, needsRecovery = false;
let state = null, anchor = null, busy = false, epoch = 0, selected = 0;
let pendingKind = null, requestId = 0, confirmRestart = false;
let suspended = true, pendingPause = false, reason = '按 B 或 C 开始独立练习。', rtt = 0;
const maxRtt = 600;
const render = () => {
  const playing = !suspended && state?.status === 'playing';
  document.body.classList.toggle('active', false);
  $('round').textContent = `${state?.observations.length ?? 0} / 12`;
  $('status').textContent = busy ? '正在核对本拍… C 仍可暂停' : reason;
  $('pause').hidden = playing || !state || (state.status === 'done' && !confirmRestart);
  $('pause-title').textContent = confirmRestart ? '确认从头重开？' : '暂停选择';
  $('selection').textContent = confirmRestart ? `重开会清空本局 ${state.observations.length} 次观测，不可撤回。` : needsRecovery ? '▶ 核对本局并暂停（不重发输入）' : selected === 0 ? '▶ 继续练习' : '▶ 从头重开（清空本局观测）';
  $('pause-help').textContent = confirmRestart ? 'A / C 取消，保留观测 · B 确认重开' : needsRecovery ? 'A 不操作 · B / C 手动核对' : 'A 切换继续 / 重开 · B 确认 · C 继续';
  $('symbol').textContent = playing ? state.cue.key === 'A' ? '●' : '▲' : '◇';
  $('direction').textContent = playing ? state.cue.key === 'A' ? '左侧 · A' : '右侧 · B' : state?.status === 'done' ? '本次观测完成' : '已暂停';
  if (!playing) $('phase').textContent = state?.status === 'done' ? 'B 重开独立练习；不会收取奖励。' : '回来后须明确继续，不补跑旧拍。';
  $('progress').setAttribute('aria-valuenow', '0'); $('progress').firstElementChild.style.width = '0%';
  $('network').textContent = anchor ? `最近实测往返约 ${Math.round(rtt)}ms · 不是单程或成绩凭据` : '等待连接测量…';
  const last = state?.observations.at(-1);
  $('last').textContent = last ? `上次方向${last.directionMatches ? '一致' : '不同'}；收包${arrivalLabel(last.arrival)}（只做观测，不判失误）。` : '看形状和文字即可，不需要声音。';
  $('observations').replaceChildren(...(state?.observations ?? []).map((o, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. 提示 ${o.expected} / 回应 ${o.key} · 方向${o.directionMatches ? '一致' : '不同'} · ${arrivalLabel(o.arrival)}（相对目标 ${o.arrivalDeltaMs >= 0 ? '+' : ''}${o.arrivalDeltaMs}ms）`;
    return li;
  }));
};
function focusCue() { focusTarget('.cue'); }
function focusTarget(selector) {
  // Explicit input replies bring the whole cue (direction + timing) above the
  // small-screen key dock; ordinary animation frames never scroll the page.
  const cue = document.querySelector(selector).getBoundingClientRect();
  const keys = document.querySelector('.keys');
  const dock = getComputedStyle(keys).position === 'fixed' ? keys.getBoundingClientRect().height + 24 : 0;
  window.scrollTo({ top: Math.max(0, window.scrollY + cue.top - Math.max(8, (innerHeight - dock - cue.height) / 2)), behavior: 'instant' });
}
function arrivalLabel(value) { return { early: '早到', inside: '窗口内', late: '晚到' }[value]; }
async function request(input) {
  const sent = performance.now();
  const response = await fetch('/lab/command', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, lease, requestId: ++requestId }), signal: AbortSignal.timeout(7000) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || '连接未确认'), { code: result.code });
  const received = performance.now();
  return { ...result, rtt: received - sent, received };
}
function accept(result) {
  state = result.state; rtt = result.rtt; lease = result.lease;
  savedId = state.id; rememberSession(savedId); needsRecovery = false; pendingPause = false;
  // Midpoint is an estimate, not a latency proof. Asymmetric/jittery transport
  // remains deliberately observable, never an authority for awarding anything.
  anchor = { epoch: result.serverTime + result.rtt / 2, measured: result.received };
}
async function send(kind, extra = {}) {
  if (busy) return;
  confirmRestart = false;
  const mine = ++epoch; pendingKind = kind; busy = true; render();
  try {
    const result = await request({ kind, id: state?.id ?? savedId, ...extra });
    if (mine !== epoch) return;
    accept(result);
    if (result.rtt > maxRtt && state.status === 'playing') {
      suspended = true; reason = '连接往返较长，本拍中性暂停；不判玩家失误。';
      pendingPause = true;
    } else {
      suspended = state.status !== 'playing';
      if (state.status === 'done') reason = '12 次观测已完成，不是正式成绩。';
      else if (!suspended) reason = '跟着提示回应 A / B；C 暂停。';
      else reason = kind === 'recover' ? '已核对本局观测并暂停，旧拍不重放；按 B / C 明确继续。' : '按 B / C 明确继续。';
    }
  } catch (error) {
    if (mine !== epoch) return;
    suspended = true; pendingPause = true; needsRecovery = true;
    reason = `连接未确认，已停止提示：${error.message}。按 B / C 手动核对，不自动重发输入。`;
    if (error.code === 'session_expired') {
      state = null; savedId = null; lease = null; anchor = null; rememberSession(null);
      pendingPause = false; needsRecovery = false;
      reason = '实验会话已失效（闲置或服务重启），旧观测无法恢复。按 B / C 新建暂停练习，不会自动开局。';
    }
  } finally {
    if (mine === epoch) { busy = false; render(); if (!document.hidden) { if (!suspended) focusCue(); else if (kind !== 'create' && !$('pause').hidden) focusTarget('#pause'); } }
  }
  if (mine === epoch && kind !== 'recover' && pendingPause && state && navigator.onLine) {
    // One neutral pause, never a retry of the answer. If it fails, manual B/C
    // is required; there is no background reconnect or retry loop.
    pendingPause = false;
    await pause(reason);
  }
}
async function pause(message = '已暂停，回来后按 B / C 明确继续。') {
  // Consent is local and short-lived: interruption must never preserve it.
  confirmRestart = false; selected = 0;
  // Invalidate even an outstanding answer/resume before the next paint.
  if (!state) { suspended = true; reason = message; render(); return; }
  if (busy && pendingKind === 'pause') return;
  const mine = ++epoch; pendingKind = 'pause'; suspended = true; busy = true; reason = message; render();
  try {
    const result = await request({ kind: 'pause', id: state.id });
    if (mine !== epoch) return;
    accept(result); pendingPause = false;
  } catch { if (mine === epoch) { pendingPause = true; needsRecovery = true; reason = '暂停未确认，本地已停。按 B / C 手动核对，旧输入不会自动重发。'; } }
  finally { if (mine === epoch) { busy = false; render(); if (!document.hidden && !$('pause').hidden) focusTarget('#pause'); } }
}
// Recheck at the input boundary too: queued input can run before the next RAF.
// Use exactly the same neutral stop conditions as painting, never spend a stale cue.
function cueStopReason(measured, gap) {
  if (document.hidden || gap > 1000) return '页面停顿，本拍中性暂停；请手动继续。';
  const now = anchor.epoch + measured - anchor.measured;
  return now > state.cue.deadline - rtt / 2
    ? '本拍已停止提示，未回应不判失误；请手动继续。' : '';
}
function askRestart() {
  confirmRestart = true; reason = '请核对后再按 B 重开；A / C 取消，不会继续旧拍。';
  render(); focusTarget('#pause');
}
async function press(key) {
  if (document.hidden) return;
  if (key === 'C' && (!suspended || (busy && pendingKind === 'resume'))) { await pause(); return; }
  if (busy) return;
  if (!state) { if (key !== 'A') await send(savedId ? 'recover' : 'create'); return; }
  if (needsRecovery) { if (key !== 'A') await send('recover'); return; }
  if (confirmRestart) {
    confirmRestart = false; selected = 0;
    if (key === 'B') await send('restart');
    else {
      reason = '已取消重开，本局观测保留；没有继续旧拍。'; render();
      focusTarget(state.status === 'done' ? '.cue' : '#pause');
    }
    return;
  }
  if (state.status === 'done') {
    if (key === 'B') askRestart();
    return;
  }
  if (suspended) {
    if (key === 'A') { selected = 1 - selected; render(); focusTarget('#pause'); return; }
    if (pendingPause || state.status === 'playing') { await pause('已重新核对暂停；再按 B / C 才继续。'); return; }
    if (key === 'C' || selected === 0) await send('resume');
    else askRestart();
    return;
  }
  if (!anchor) return;
  const measured = performance.now(), stopped = cueStopReason(measured, measured - lastFrame);
  if (stopped) { await pause(stopped); return; }
  const now = anchor.epoch + measured - anchor.measured;
  if (now < state.cue.target) { reason = '还在预告，等到「现在回应」再按；没有消耗本拍。'; render(); return; }
  await send('answer', { sequence: state.cue.sequence, key });
}
const buttons = [...document.querySelectorAll('[data-key]')];
for (const button of buttons) button.addEventListener('click', () => void press(button.dataset.key));
document.addEventListener('keydown', event => {
  // Scope native activation to our three actual buttons. Enter/Space elsewhere
  // retain browser behavior, rather than becoming another global game shortcut.
  const nativeKey = buttons.includes(event.target) && (event.key === 'Enter' || event.key === ' ')
    ? event.target.dataset.key : null;
  if (nativeKey) event.preventDefault(); // Cancel native clicks, including held/IME/modifier activation.
  if (event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey) return;
  const key = nativeKey ?? event.key.toUpperCase();
  if (!['A', 'B', 'C'].includes(key)) return;
  event.preventDefault(); void press(key);
});
document.addEventListener('keyup', event => {
  // Chrome may still click on Space release after repeated keydowns. The action
  // already ran on the first down; never turn that release into another input.
  if (event.key === ' ' && buttons.includes(event.target)) event.preventDefault();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) void pause('离开页面已暂停；回来不自动继续。'); });
window.addEventListener('blur', event => { if (event.target === window) void pause('窗口失焦已暂停；回来不自动继续。'); });
window.addEventListener('offline', () => void pause('连接中断已暂停，不重发旧回应。'));
// A throttled/stalled frame must not silently spend a cue while hidden or stuck.
let lastFrame = performance.now();
function tick() {
  const measured = performance.now(), gap = measured - lastFrame; lastFrame = measured;
  if (!suspended && !busy && state?.status === 'playing' && anchor) {
    const stopped = cueStopReason(measured, gap);
    if (stopped) void pause(stopped);
    else {
      const now = anchor.epoch + measured - anchor.measured, cue = state.cue;
      const active = now >= cue.target;
      document.body.classList.toggle('active', active);
      $('phase').textContent = active ? '现在回应 · 这是本地估计提示' : '准备 · 先看方向，稍后再回应';
      const pct = Math.min(100, Math.max(0, (now - (cue.target - 1800)) / 1800 * 100));
      $('progress').setAttribute('aria-valuenow', String(Math.round(pct)));
      $('progress').firstElementChild.style.width = `${pct}%`;
    }
  }
  requestAnimationFrame(tick);
}
render(); requestAnimationFrame(tick); void send(savedId ? 'recover' : 'create');
