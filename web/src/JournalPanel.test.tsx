import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { JournalPanel } from "./JournalPanel";
import { startJournal } from "./journal";

afterEach(cleanup);

it("keeps the diary sentence primary and presents numeric detail as secondary text", () => {
  const logs = [{ at: Date.parse("2026-10-20T01:20:00Z"), text: "饭团已吃好。即时需求：饱食+20.00、清洁−1.00（不含时间结算）。本次成长 +0.25 点。" }];
  render(<JournalPanel logs={logs} cursor={startJournal(logs)} />);
  const diary = screen.getByRole("region", { name: "成长日记" });
  expect(diary.querySelector(".journal-primary")?.textContent).toBe("饭团已吃好。");
  expect(diary.querySelector(".journal-detail")?.textContent).toContain("即时需求：饱食+20.00");
  expect(diary.textContent).toContain(logs[0].text);
  expect(diary.querySelector(".journal-detail")?.tagName).toBe("SMALL");
});

it.each([
  "今天一起在小窝里发了一会儿呆。",
  "即时需求：饱食+20.00。",
  "饭团已吃好。即时需求记录还在这里。",
])("keeps an older or unprefixed diary unchanged: %s", text => {
  const logs = [{ at: Date.parse("2026-10-20T01:20:00Z"), text }];
  render(<JournalPanel logs={logs} cursor={startJournal(logs)} />);
  const diary = screen.getByRole("region", { name: "成长日记" });
  expect(diary.querySelector(".journal-primary")?.textContent).toBe(text);
  expect(diary.querySelector(".journal-detail")).toBeNull();
});
