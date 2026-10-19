import { Sprout } from "lucide-react";
import { journalView } from "./journal";
import type { JournalCursor, JournalLogs } from "./journal";

export function JournalPanel({ logs, cursor }: { logs: JournalLogs; cursor: JournalCursor }) {
  const { entry, index, cursor: current } = journalView(logs, cursor);
  return <section className="screen-journal" aria-label="成长日记">
    <Sprout size={26} aria-hidden="true" />
    {entry ? <>
      <time data-care-reading-start dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString("zh-CN", {
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
      })}</time>
      <p>{entry.text}</p>
      <span>{index + 1} / {logs?.length ?? 0}</span>
    </> : <>
      <p data-care-reading-start>还没有日记，之后的照顾和成长会慢慢记在这里。</p>
      <span>0 条记录</span>
    </>}
    {current.trimmed && <small role="status" className="journal-trimmed">刚才那条已不在最近日记中{entry ? "，已移到当前最早一条。" : "。"}</small>}
    <small className="journal-note">日记只保留最近 30 条；纪念册另记重要经历，并非逐条备份。</small>
  </section>;
}
