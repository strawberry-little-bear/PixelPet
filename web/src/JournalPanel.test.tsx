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

it("keeps sleep settlement numbers secondary to the diary sentence", () => {
  const text = "早安！这一觉睡得很踏实，醒来后感觉更有精神了。结算记录：体力恢复 +14.00，休息习惯 +0.50，睡梦里的成长 +1.18 点。";
  const logs = [{ at: Date.parse("2026-10-20T01:20:00Z"), text }];
  render(<JournalPanel logs={logs} cursor={startJournal(logs)} />);
  const diary = screen.getByRole("region", { name: "成长日记" });
  expect(diary.querySelector(".journal-primary")?.textContent)
    .toBe("早安！这一觉睡得很踏实，醒来后感觉更有精神了。");
  expect(diary.querySelector(".journal-detail")?.textContent)
    .toContain("结算记录：体力恢复 +14.00");
  expect(diary.textContent).toContain(text);
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

it.each([
  ["本次成长 +0.25 点，喂食习惯 +1.00。本次习惯已计入。不含操作前的时间成长。", "这次照顾推动进入成长期。"],
  ["本次成长 +<0.01 点，清洁习惯 +1.00。本次习惯已计入。不含操作前的时间成长。", "这次照顾推动进入成年期，恬静型已定型。"],
  ["本次成长 +0.00 点，陪玩习惯 +0.00。记录时同类习惯仍在间隔内，本次不计习惯。不含操作前的时间成长。", "成年后形态不变。"],
])("keeps the complete saved care explanation and stage history in separate reading blocks: %s", (learning, stage) => {
  const needs = "即时需求：饱食+<0.01、清洁−1.00（不含时间结算）。";
  const text = "一起度过了一小会儿。" + needs + learning + stage;
  const logs = [{ at: Date.parse("2026-10-25T01:20:00Z"), text }];
  render(<JournalPanel logs={logs} cursor={startJournal(logs)} />);
  const diary = screen.getByRole("region", { name: "成长日记" });
  expect(diary.querySelector("p")?.textContent).toBe(text);
  expect(Array.from(diary.querySelectorAll(".journal-detail-part"), part => part.textContent)).toEqual([needs, learning, stage]);
  expect(diary.querySelector("time")?.getAttribute("datetime")).toBe(new Date(logs[0].at).toISOString());
  expect(logs[0].text).toBe(text);
  expect(diary.querySelector("button,input,a")).toBeNull();
});

it.each([
  "旧版留下的说明没有固定格式，不含操作前的时间成长。",
  "即时需求：原样文字 <0.01，<script>保留为文本</script>。未识别的说明不会丢失。",
])("leaves unfamiliar saved detail intact without inventing numbers or sections: %s", detail => {
  const text = "一份回忆。即时需求：" + detail;
  const logs = [{ at: Date.parse("2026-10-25T01:20:00Z"), text }];
  render(<JournalPanel logs={logs} cursor={startJournal(logs)} />);
  const diary = screen.getByRole("region", { name: "成长日记" });
  expect(diary.querySelector("p")?.textContent).toBe(text);
  expect(diary.querySelectorAll(".journal-detail-part")).toHaveLength(1);
  expect(diary.querySelector("script")).toBeNull();
});
