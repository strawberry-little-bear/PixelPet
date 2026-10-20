import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WalkDiscoveries } from "./WalkDiscoveries";
import type { Walking } from "./types";

const walk = (beat: number, souvenirs = ["leaf", "shell", "leaf"]): Walking => ({
  route: Array(12).fill("rock"), souvenirs, beat, step: beat, cleared: 0,
  pose: "", poseUntil: 0, lastPulseAt: 1, lastInputAt: 0, paused: true,
});
afterEach(cleanup);

describe("this walk's acknowledged discoveries", () => {
  it.each([0, 23, 24, 27, 28, 47, 48, 71, 72])("shows only reached stops at beat %i", beat => {
    const n = walk(beat), before = structuredClone(n);
    render(<WalkDiscoveries walking={n} />);
    const region = screen.getByRole("region", { name: "本次沿途发现" });
    const count = Math.floor(beat / 24);
    expect(within(region).queryAllByRole("listitem")).toHaveLength(count);
    expect(within(region).queryByText("水边贝壳") !== null).toBe(beat >= 48);
    expect(within(region).queryAllByText("银杏叶")).toHaveLength(beat >= 72 ? 2 : beat >= 24 ? 1 : 0);
    expect(region.textContent).not.toMatch(/首次|新物种|金币 \+/);
    expect(n).toEqual(before);
    expect(region.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
  });
  it("keeps repeated finds in route order instead of pretending they are three species", () => {
    render(<WalkDiscoveries walking={walk(72)} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map(el => el.querySelector("strong")?.textContent)).toEqual(["银杏叶", "水边贝壳", "银杏叶"]);
    expect(rows.map(el => el.querySelector("span")?.textContent)).toEqual(["第 24 步", "第 48 步", "第 72 步"]);
    expect(screen.getAllByText("小路旁捡到的扇形叶片。")).toHaveLength(2);
  });
  it("offers a native reading stop without treating unknown details as a leaf", () => {
    render(<WalkDiscoveries walking={walk(48, ["old-unknown", "shell", "flower"])} />);
    const region = screen.getByRole("region", { name: "本次沿途发现" });
    expect(region.tabIndex).toBe(0);
    expect(region.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("发现详情尚未读到")).toBeTruthy();
    expect(screen.queryByText("银杏叶")).toBeNull();
    expect(screen.queryByText("落花")).toBeNull();
    expect(screen.getByText(/发现已经保存，放弃也保留/)).toBeTruthy();
  });
});
