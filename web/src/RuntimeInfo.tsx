import { useEffect, useRef, useState } from "react";
import "./runtime-info.css";

type BuildVersion = { revision?: string; modified?: boolean; development?: boolean };
type Runtime = { schema: number; build: BuildVersion };
declare const __PIXELPET_WEB_BUILD__: BuildVersion;
const webBuild: BuildVersion = typeof __PIXELPET_WEB_BUILD__ === "undefined" ? {} : __PIXELPET_WEB_BUILD__;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function runtimeReport(value: unknown): Runtime {
  if (!record(value) || !Number.isSafeInteger(value.schema) || (value.schema as number) < 1 || !record(value.build)) throw new Error("无法识别运行信息");
  const { revision, modified } = value.build;
  if (revision !== undefined && (typeof revision !== "string" || !/^[0-9a-f]{40,64}$/.test(revision)) ||
    modified !== undefined && typeof modified !== "boolean") throw new Error("无法识别构建信息");
  return { schema: value.schema as number, build: { revision: revision as string | undefined, modified: modified as boolean | undefined } };
}
function Build({ value }: { value: BuildVersion }) {
  if (value.development) return <>开发模式（内容可热更新）</>;
  if (!value.revision) return <>未记录提交标识</>;
  return <><code title={value.revision}>{value.revision.slice(0, 12)}</code> · {value.modified === true ? "构建时含未提交改动" : value.modified === false ? "构建时工作区干净" : "构建时改动状态未知"}</>;
}
export type SyncHealth = "connecting" | "ready" | "unavailable" | "uncertain" | "corrupt" | "clock-ahead";
const healthText: Record<SyncHealth, [string, string]> = {
  connecting: ["尚未读到存档", "请等待当前页面的连接结果。"],
  ready: ["最近同步正常", "以最近一次成功读取或保存为准。"],
  unavailable: ["暂时连接不上", "确认运行游戏的电脑与本地服务仍在，先按 C 收起存档盒，再按机身 B 重新连接。连接失败不代表存档损坏。"],
  uncertain: ["保存结果待核对", "先按 C 收起存档盒，再按机身 B 读取当前存档；原操作不会自动重发。"],
  corrupt: ["存档需要修复", "服务已明确报告存档无法读取。可在存档盒预览备份或恢复点，再确认替换。"],
  "clock-ahead": ["服务时间待校准", "校准运行 Go 服务的电脑时间后，先按 C 收起存档盒，再按机身 B 检查。"],
};
export function RuntimeInfo({ health, syncedAt }: { health: SyncHealth; syncedAt: number | null }) {
  const [open, setOpen] = useState(false);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const flight = useRef<AbortController | null>(null);
  const cancel = () => { flight.current?.abort(); flight.current = null; };
  useEffect(() => () => cancel(), []);
  async function load() {
    if (flight.current) return;
    const controller = new AbortController(); flight.current = controller;
    setPending(true); setError(""); setRuntime(null);
    const timer = setTimeout(() => {
      if (flight.current !== controller) return;
      cancel(); setPending(false); setError("读取运行版本超时；存档状态仍以上方同步结果为准。");
    }, 10000);
    controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    try {
      const response = await fetch("/api/runtime", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 ? "这版服务未提供运行版本信息。" : "暂时无法读取运行版本。");
      const report = runtimeReport(await response.json());
      if (flight.current === controller && !controller.signal.aborted) setRuntime(report);
    } catch (failure) {
      if (flight.current === controller && !controller.signal.aborted) setError(failure instanceof Error && !(failure instanceof TypeError) && !(failure instanceof SyntaxError)
        ? failure.message : "暂时无法读取运行版本。");
    } finally {
      clearTimeout(timer);
      if (flight.current === controller) { flight.current = null; setPending(false); }
    }
  }
  const time = syncedAt !== null && Number.isFinite(syncedAt) && syncedAt > 0 && syncedAt <= 8.64e15 ? new Date(syncedAt) : null;
  return <section className={`runtime-info${open ? " runtime-info-open" : ""}`} aria-label="运行信息">
    <button aria-expanded={open} onClick={() => {
      if (open) { cancel(); setPending(false); setOpen(false); }
      else { setOpen(true); void load(); }
    }}>运行信息{open ? " · 收起" : " · 查看"}</button>
    {open && <div className="runtime-info-content">
      <p>向下滚动查看详情 · C 收起存档盒</p>
      <dl>
        <dt>存档连接</dt><dd>{healthText[health][0]}</dd>
        <dt>最近成功同步</dt><dd>{time ? <time dateTime={time.toISOString()}>{time.toLocaleString("zh-CN", { hour12: false })}（本机接收时间）</time> : "本页还没有成功同步"}</dd>
        <dt>网页地址</dt><dd><code>{window.location.origin}</code></dd>
        <dt>API 入口</dt><dd><code>{window.location.origin}/api</code></dd>
        <dt>网页构建</dt><dd><Build value={webBuild}/></dd>
        {runtime && <><dt>后端构建</dt><dd><Build value={runtime.build}/></dd><dt>支持的存档格式</dt><dd>schema {runtime.schema}</dd></>}
      </dl>
      <p>{healthText[health][1]}</p>
      {pending && <p role="status">正在读取运行版本…</p>}
      {error && <p role="status">{error}这不会替换存档，也不改变上方同步结果。</p>}
      <p>网页与后端分别构建，提交标识不代表 GitHub 最新版本。开发代理下，API 入口是浏览器访问地址。</p>
      <button disabled={pending} onClick={() => void load()}>重新读取运行版本</button>
    </div>}
  </section>;
}
