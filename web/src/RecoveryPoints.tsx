import { useEffect, useRef, useState } from "react";
import { backupSizeLimit, previewBackup } from "./backup";
import { stageNames } from "./growth";
import { species } from "./types";
import "./recovery-points.css";

export type RecoveryPointSource = { id: string; createdAt: number };
type RecoveryPoint = RecoveryPointSource & {
  status: "available" | "unreadable" | "clock-ahead" | "too-large";
  pet?: { name: string; species: number; stage: string; lastTick: number };
};
const moment = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function recoveryPoints(value: unknown): RecoveryPoint[] {
  if (!record(value) || !Array.isArray(value.snapshots) || value.snapshots.length > 10) throw new Error("无法识别恢复点列表，请重新读取。");
  const ids = new Set<string>();
  return value.snapshots.map((point: unknown) => {
    if (!record(point) || typeof point.id !== "string" || !/^[1-9]\d{0,18}$/.test(point.id) || ids.has(point.id) || !moment(point.createdAt) ||
        !["available", "unreadable", "clock-ahead", "too-large"].includes(String(point.status))) throw new Error("恢复点信息不完整，请重新读取。");
    ids.add(point.id);
    if (point.status === "available") {
      const pet = point.pet;
      if (!record(pet) || typeof pet.name !== "string" || !pet.name.trim() || [...pet.name].length > 12 ||
          typeof pet.species !== "number" || !Number.isInteger(pet.species) || !species[pet.species] || !moment(pet.lastTick) ||
          typeof pet.stage !== "string" || !["egg", "baby", "growing", "adult", "unknown"].includes(pet.stage)) throw new Error("恢复点中的伙伴信息不完整，请重新读取。");
    }
    return point as RecoveryPoint;
  });
}
const time = (at: number) => new Date(at).toLocaleString("zh-CN", { hour12: false });
const unavailable = {
  unreadable: "原始内容已保留，未通过当前校验，暂不能恢复。",
  "clock-ahead": "记录时间晚于服务时间；先校准服务时钟，再重新读取。",
  "too-large": "内容超过 64 KiB，暂不能通过备份导入恢复。",
};
async function read(path: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", redirect: "error", signal });
  if (!response.ok) {
    let detail = "";
    try { const body = await response.json(); if (typeof body?.error === "string" && body.error.trim().length <= 240) detail = body.error.trim(); } catch { /* Do not display a proxy's HTML. */ }
    throw new Error(detail || `服务返回 ${response.status}，请检查连接后重新读取。`);
  }
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("服务没有返回 JSON 恢复点，请检查连接。");
  const text = await response.text();
  if (!text || new TextEncoder().encode(text).length > backupSizeLimit) throw new Error("恢复点内容为空或超过 64 KiB，未打开预览。");
  return text;
}

// This tool only reads immutable recovery points. The LCD's existing A/B/C
// import preview owns the sole replacement decision and generation guard.
export function RecoveryPoints({ enabled, onPreview }: {
  enabled: boolean; onPreview: (text: string, source: RecoveryPointSource) => void;
}) {
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState<RecoveryPoint[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const flight = useRef<AbortController | null>(null);
  const cancel = () => { flight.current?.abort(); flight.current = null; };
  useEffect(() => () => cancel(), []);
  useEffect(() => {
    if (enabled) return;
    cancel(); setPending(false); setOpen(false); setPoints(null); setError("");
  }, [enabled]);
  async function load(point?: RecoveryPoint) {
    if (!enabled || flight.current || point && point.status !== "available") return;
    const controller = new AbortController(); flight.current = controller;
    setPending(true); setError("");
    const timer = setTimeout(() => {
      if (flight.current !== controller) return;
      cancel(); setPending(false); setError("读取恢复点超时，请检查连接后重新读取。没有替换当前存档。");
    }, 10000);
    controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    try {
      const text = await read(point ? `/api/snapshots/${point.id}` : "/api/snapshots", controller.signal);
      if (flight.current !== controller || controller.signal.aborted) return;
      if (point) {
        previewBackup(text);
        onPreview(text, { id: point.id, createdAt: point.createdAt });
      } else setPoints(recoveryPoints(JSON.parse(text)));
    } catch (failure) {
      if (flight.current === controller && !controller.signal.aborted) setError(failure instanceof Error && !(failure instanceof TypeError)
        ? failure.message : "暂时无法连接小窝服务，请稍后重新读取。");
    } finally {
      clearTimeout(timer);
      if (flight.current === controller) { flight.current = null; setPending(false); }
    }
  }
  return <section className={`recovery-points${open ? " recovery-points-open" : ""}`} aria-label="自动恢复点">
    <button disabled={!enabled} aria-expanded={open} onClick={() => {
      if (open) { cancel(); setPending(false); setOpen(false); }
      else { setOpen(true); void load(); }
    }}>自动恢复点{open ? " · 收起" : " · 查看"}</button>
    {open && <div className="recovery-point-list" aria-busy={pending}>
      <p>保留最近 10 份迁移、导入或重置前的存档，不是定时备份；仅保存在这台服务的数据库中。选择后先预览，B 才确认替换。</p>
      {pending && <p role="status">正在读取恢复点，尚未替换存档…</p>}
      {error && <p role="alert">{error}</p>}
      {points?.length === 0 && <p role="status">还没有自动恢复点。建议先导出一份备份，自己留好。</p>}
      {points && points.length > 0 && <ol>{points.map(point => <li key={point.id}>
        <strong>恢复点 #{point.id}</strong>
        <span>生成于 <time dateTime={new Date(point.createdAt).toISOString()}>{time(point.createdAt)}</time>（本地时间）</span>
        {point.status === "available" && point.pet ? <>
          <span>{point.pet.name} · {species[point.pet.species]} · {point.pet.stage === "unknown" ? "旧档阶段待迁移" : stageNames[point.pet.stage as keyof typeof stageNames]}</span>
          <span>存档记录至 <time dateTime={new Date(point.pet.lastTick).toISOString()}>{time(point.pet.lastTick)}</time></span>
          <button disabled={pending || !enabled} onClick={() => void load(point)} aria-label={`预览恢复点 #${point.id}：${point.pet!.name}`}>预览这份恢复点</button>
        </> : <span>{unavailable[point.status as keyof typeof unavailable]}</span>}
      </li>)}</ol>}
      <button disabled={pending || !enabled} onClick={() => void load()}>重新读取恢复点</button>
    </div>}
  </section>;
}
