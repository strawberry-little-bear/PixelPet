import "./status-reading.css";

// lastTick belongs to the accepted state, not the response's arrival time or
// the browser clock. A missing/invalid legacy timestamp is unknown, never now.
export function StatusReading({ at }: { at: number }) {
  const valid = Number.isSafeInteger(at) && at > 0 && at <= 8.64e15;
  return <section className="status-reading" aria-label="状态记录时间">
    {valid ? <>
      <strong>状态记录截至（本地时间）</strong>
      <time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString("zh-CN", {
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      })}</time>
      <p>四项需求按已保存状态显示，不是按浏览器时间推算。</p>
    </> : <p>状态记录时间尚未读到，不按本机时间补写。</p>}
  </section>;
}
