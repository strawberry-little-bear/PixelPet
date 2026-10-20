const dayMillis = 86_400_000;

// The reward and greeting guards both refuse to move their saved UTC day
// backwards. A future saved timestamp must not promise an earlier refresh.
export function dailyRefreshAt(now: number, lastAt = 0): number | null {
  if (!Number.isFinite(now) || now < 0 || !Number.isFinite(lastAt) || lastAt < 0) return null;
  const at = (Math.floor(Math.max(now, lastAt) / dayMillis) + 1) * dayMillis;
  return Number.isNaN(new Date(at).getTime()) ? null : at;
}

export function DailyRefresh({ now, lastAt = 0 }: { now: number; lastAt?: number }) {
  const at = dailyRefreshAt(now, lastAt);
  if (at === null) return null;
  const date = new Date(at);
  // Use the browser's zone at the actual future instant, including its DST
  // offset. This is explanatory only: no local-clock reward or save mutation.
  const local = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
  return <p className="daily-refresh" aria-label="额度更新时间">下次更新：<time dateTime={date.toISOString()}>{local}</time><br />（本地；UTC 0 点）</p>;
}
