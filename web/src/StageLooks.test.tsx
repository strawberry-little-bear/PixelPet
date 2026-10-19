import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GrowthPanel } from "./GrowthPanel";
import { PetArt } from "./PetArt";
import { emptyGrowth, growthPageCount } from "./growth";
import { stageLook, petStageLabel } from "./stageLooks";
import { species } from "./types";
import type { AdultForm } from "./types";

afterEach(cleanup);
const stages = ["baby", "growing", "adult"] as const;
const poses = [
  ["团坐抱尾", "探头踏步", "竖尾望星"], ["绒团收翼", "探脚试翼", "停栖梳羽"],
  ["团坐踢脚", "竖耳踏步", "舒展挥手"], ["团身拢鳍", "扬鳍试游", "舒身摆尾"],
  ["裹盖团坐", "歪盖探步", "展盖轻摇"], ["桃团抱爪", "探身踏步", "挺身揉颊"],
  ["团蹲拢蹼", "探身试跃", "舒蹼鸣唱"], ["团坐探爪", "侧耳试步", "端坐理毛"],
  ["抱尾拢翼", "探身试翼", "展翼望星"], ["趴团抱爪", "侧耳探步", "坐稳摇尾"],
];

describe("the handbook explains the actual species stages", () => {
  it.each(species.flatMap((name, index) => stages.map((stage, order) => ({ name, index, stage, order }))))("$name $stage uses the same stage pose in art and handbook", ({ name, index, stage, order }) => {
    const growth = emptyGrowth(stage); if (stage === "adult") growth.form = "gentle";
    const before = structuredClone(growth);
    const { container } = render(<><GrowthPanel growth={growth} index={index} page={5} /><PetArt index={index} stage={stage} /></>);
    expect(growthPageCount).toBe(6);
    expect(stageLook(index, stage).pose).toBe(poses[index][order]);
    expect(petStageLabel(index, stage)).toBe(`${name}，${poses[index][order]}`);
    expect(container.querySelector("svg[role=img]")?.getAttribute("aria-label")).toBe(petStageLabel(index, stage));
    const guide = container.querySelector(".growth-look-guide")!;
    expect(guide.textContent).toContain(`${name}的三阶段`);
    expect([...guide.querySelectorAll("[data-look-stage]")].map(el => el.getAttribute("data-look-stage"))).toEqual(stages);
    expect(guide.querySelector('[aria-current="step"]')?.getAttribute("data-look-stage")).toBe(stage);
    for (const s of stages) { expect(guide.textContent).toContain(stageLook(index, s).pose); expect(guide.textContent).toContain(stageLook(index, s).detail); }
    expect(guide.textContent).toContain("不是换一只宠物");
    expect(guide.textContent).toContain(stage === "adult" ? "成年形态已固定" : "成年形态仍以长大时的记录为准");
    expect(container.querySelector(".growth-page-dots")?.textContent).toBe("6 / 6");
    expect(container.querySelector("button,a,input")).toBeNull(); expect(growth).toEqual(before);
  });
  it.each(["balanced", "lively", "gentle", "easygoing"] as AdultForm[])("does not predict or replace a saved adult %s form", form => {
    const growth = { ...emptyGrowth("adult"), form }; const original = structuredClone(growth);
    const { container } = render(<GrowthPanel growth={growth} index={3} page={5} />);
    expect(container.textContent).toContain("成年形态已固定"); expect(container.textContent).not.toContain("已获得"); expect(growth).toEqual(original);
  });
  it.each([-1, 10, 2.5, NaN])("unknown index %s has generic copy, not another animal's anatomy", index => {
    expect(stageLook(index, "growing").pose).toBe("探索新模样");
    expect(petStageLabel(index, "adult")).toBe("小伙伴，舒展陪伴");
    const { container } = render(<GrowthPanel growth={emptyGrowth()} index={index} page={5} />);
    expect(container.textContent).not.toContain("undefined"); expect(container.textContent).toContain("小伙伴的三阶段");
  });
  it("egg descriptions never imply it is already hatched", () => {
    expect(petStageLabel(2, "egg")).toBe("草莓兔，等待孵化");
    const { container } = render(<GrowthPanel growth={emptyGrowth("egg")} index={2} page={5} />);
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect(container.textContent).toContain("孵化后开始三阶段旅程");
  });
});
