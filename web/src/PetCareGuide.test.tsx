import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PetCareGuide } from "./PetCareGuide";
import type { CareRules } from "./types";
const rules: CareRules = { maxOfflineHours: 12, awake: { hunger: -3, mood: -2.5, clean: -2, energy: -2 }, sleeping: { hunger: -3, mood: 0, clean: -2, energy: 14 } };
afterEach(cleanup);
it.each([12, 6, .5, 24])("reads the actual per-settlement limit %s, never a whole-absence cap", cap => {
  render(<PetCareGuide rules={{ ...rules, maxOfflineHours: cap }} />);
  expect(screen.getByLabelText("照顾与成长入门").textContent).toContain(`单次最多 ${cap} 小时`);
  expect(screen.getByText(/该次多出的时间/).textContent).toContain("整段离开计入的时间可能超过单次上限");
});
it.each([undefined, null, {}, { ...rules, maxOfflineHours: 0 }, { ...rules, maxOfflineHours: -1 }, { ...rules, maxOfflineHours: NaN }, { ...rules, maxOfflineHours: Infinity }, { ...rules, maxOfflineHours: "12" }, { ...rules, awake: null }])("does not invent numbers with missing/invalid metadata: %j", value => {
  render(<PetCareGuide rules={value as CareRules} />);
  const text = screen.getByLabelText("照顾与成长入门").textContent!;
  expect(text).toContain("单次结算上限尚未读到"); expect(text).not.toMatch(/12|单次最多/);
});
it("explains care, stages, fixed adulthood and actual sleep recovery without new controls or forecasts", () => {
  const { container } = render(<PetCareGuide rules={rules} />);
  const text = container.textContent!;
  for (const wording of ["幼年 → 成长期 → 成年", "有效照顾留下习惯", "成年后形态固定", "按实际恢复量记录", "饱食和清洁仍会下降", "成长手册", "看看状态", "回访小结", "没有永久死亡", "存档盒"]) expect(text).toContain(wording);
  expect(text).not.toMatch(/\+1|\+0\.25|还需.*小时/); expect(container.querySelector("button,a,input,[role=button]")).toBeNull();
});
