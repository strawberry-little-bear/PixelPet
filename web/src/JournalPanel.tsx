import { Sprout } from "lucide-react";
import { journalView } from "./journal";
import type { JournalCursor, JournalLogs } from "./journal";

function splitDiaryText(text: string) {
  // Only add visual breaks to saved prose; never reconstruct historical
  // amounts, reasons or milestones from the current pet. Unknown text stays whole.
  const marker = text.includes("即时需求：") ? "即时需求：" : "结算记录：";
  const splitAt = text.indexOf(marker);
  if (splitAt <= 0) return { primary: text, detail: [] };
  const detail = text.slice(splitAt), parts: string[] = [];
  let start = 0;
  for (const match of detail.matchAll(/。(?:本次成长 |这次照顾推动进入(?:成长|成年)期|成年后形态不变。)/gu)) {
    const boundary = match.index + 1;
    parts.push(detail.slice(start, boundary));
    start = boundary;
  }
  parts.push(detail.slice(start));
  return { primary: text.slice(0, splitAt), detail: parts };
}

export function JournalPanel({ logs, cursor }: { logs: JournalLogs; cursor: JournalCursor }) {
  const { entry, index, cursor: current } = journalView(logs, cursor);
  const diary = entry ? splitDiaryText(entry.text) : null;
  return <section className="screen-journal" aria-label="成长日记">
    <Sprout size={26} aria-hidden="true" />
    {entry ? <>
      <time data-care-reading-start dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString("zh-CN", {
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
      })}</time>
      <p>
        <span className="journal-primary">{diary?.primary}</span>
        {!!diary?.detail.length && <small className="journal-detail">
          {diary.detail.map((part, index) => <span className="journal-detail-part" key={index}>{part}</span>)}
        </small>}
      </p>
      <span>{index + 1} / {logs?.length ?? 0}</span>
    </> : <>
      <p data-care-reading-start>还没有日记，之后的照顾和成长会慢慢记在这里。</p>
      <span>0 条记录</span>
    </>}
    {current.trimmed && <small role="status" className="journal-trimmed">刚才那条已不在最近日记中{entry ? "，已移到当前最早一条。" : "。"}</small>}
    <small className="journal-note">由新到旧排列，首尾循环。日记只保留最近 30 条；纪念册另记重要经历，并非逐条备份。</small>
  </section>;
}
