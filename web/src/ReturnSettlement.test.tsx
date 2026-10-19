import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReturnPanel } from "./ReturnPanel";
import { GrowthPanel } from "./GrowthPanel";
import { emptyGrowth } from "./growth";
import type { ReturnRecap } from "./types";

function history(absence: number, settled: number): ReturnRecap {
  const to = Date.parse("2026-10-19T08:00:00Z");
  const snapshot = { needs: { hunger: 80, clean: 90, mood: 80, energy: 85 }, stage: "baby" as const, form: "" as const,
    points: 0, rest: 0, trackedHours: 0, sleeping: false };
  return { id: "cumulative", from: to - absence * 3600000, to, before: snapshot,
    after: { ...snapshot, trackedHours: settled, points: 10 } };
}
afterEach(cleanup);
it.each([[24, 12], [24, 24], [48, 20]])("distinguishes %s hours absent from %s accumulated hours", (absence, settled) => {
  const recap = history(absence, settled), original = structuredClone(recap);
  const { rerender } = render(<ReturnPanel recap={recap} page={0} />);
  expect(screen.getByLabelText("回访小结").textContent).toContain(`离开了 ${absence} 小时`);
  rerender(<ReturnPanel recap={recap} page={1} />);
  expect(screen.getByLabelText("回访小结").textContent).toContain(`${settled.toFixed(2)} 小时`);
  expect(screen.getByLabelText("结算时长说明").textContent).toContain("累计结算，不等同于离开时长");
  expect(screen.getByLabelText("结算时长说明").textContent).toContain("可能分多次结算");
  expect(screen.getByLabelText("回访小结").textContent).not.toContain("单次离线最多结算 12 小时");
  expect(recap).toEqual(original);
});
it("does not infer missing hours or a historical numeric cap", () => {
  render(<ReturnPanel recap={history(48, 0)} page={1} />);
  const text = screen.getByLabelText("回访小结").textContent;
  expect(text).toContain("0.00 小时"); expect(text).toContain("具体见状态页时间说明");
  expect(text).toContain("无额外奖励"); expect(text).not.toMatch(/12 小时|48\.00 小时/);
});
it("keeps the explanation on the growth page and adds no gameplay controls", () => {
  const { rerender } = render(<ReturnPanel recap={history(24, 24)} page={0} />);
  expect(screen.queryByLabelText("结算时长说明")).toBeNull();
  rerender(<ReturnPanel recap={history(24, 24)} page={1} />);
  expect(screen.getByLabelText("结算时长说明")).toBeTruthy();
  expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
});

it.each(["baby", "growing", "adult"] as const)("%s handbook explains a per-settlement limit, not a whole-absence limit", stage => {
  render(<GrowthPanel growth={emptyGrowth(stage)} index={2} page={4} />);
  const guide = screen.getByLabelText("离线与成长说明").textContent;
  expect(guide).toContain("每次结算有上限"); expect(guide).toContain("多次读取可能累计更多");
  expect(guide).not.toContain("从上次保存到回来，状态与成长最多结算 12 小时");
});
