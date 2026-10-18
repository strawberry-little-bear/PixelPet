import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PetArt, petRigClass, petRigKind } from "./PetArt";
import { PetScene } from "./PetScene";
import { GrowthPanel } from "./GrowthPanel";
import type { Growth, GrowthStage } from "./types";

afterEach(cleanup);
const stages = ["baby", "growing", "adult"] as const;
const motions = ["idle", "eating", "bathing", "sleeping", "waking", "celebrating"] as const;
const growth: Growth = { stage: "adult", points: 72, form: "gentle", trackedHours: 72, wellbeing: 60,
  growingAt: 1, adultAt: 2, care: { nutrition: 2, play: 1, clean: 2, rest: 3, lastFeed: 0, lastClean: 0, lastPlay: 0 } };

describe("independently drawn sakura cat", () => {
  it("drafts three different heads, bodies, ears, paws, feet and tails on one canvas", () => {
    for (const part of [".cat-head-shape", ".cat-body-shape", ".ear-left path", ".ear-right path", ".cat-tail", ".foot-left path", ".foot-right path", ".paw-left", ".paw-right"]) {
      const paths = stages.map(stage => {
        const { container, unmount } = render(<PetArt index={7} stage={stage} />);
        const rig = container.querySelector(".cat-rig")!;
        expect(rig.getAttribute("viewBox")).toBe("0 0 64 68");
        expect(rig.getAttribute("data-rig-stage")).toBe(stage);
        expect(rig.getAttribute("transform")).toBeNull();
        expect(rig.querySelector("image")).toBeNull();
        expect(rig.querySelectorAll(".cat-ear")).toHaveLength(2);
        expect(rig.querySelectorAll(".cat-paw")).toHaveLength(2);
        expect(rig.querySelectorAll(".cat-foot")).toHaveLength(2);
        expect(rig.querySelector(".cat-blossom")).not.toBeNull();
        const path = rig.querySelector(part)!.getAttribute("d");
        unmount();
        return path;
      });
      expect(new Set(paths).size, part).toBe(3);
    }
  });

  it.each(stages)("uses anatomical limbs in all %s actions, with no extra paws or needs", stage => {
    for (const motion of motions) {
      const { container, unmount } = render(<PetScene index={7} stage={stage} motion={motion} clipId={1} dirty={false} need="hungry" />);
      expect(container.querySelector(".pet-scene")!.getAttribute("data-rig")).toBe("cat");
      expect(container.querySelector(`.cat-${stage}.rig-motion-${motion}`)).not.toBeNull();
      expect(container.querySelector(".growth-size.has-cat-rig")).not.toBeNull();
      expect(container.querySelectorAll(".need-paw")).toHaveLength(2);
      expect(container.querySelector(".need-gesture .need-paw")).toBeNull();
      expect(container.querySelector(".cat-blossom")).not.toBeNull();
      expect(container.querySelector("button")).toBeNull();
      expect(container.querySelector(".pet-scene")!.getAttribute("data-need")).toBe(motion === "idle" ? "hungry" : "none");
      unmount();
    }
  });

  it.each(["awake", "asleep", "chewing", "tired", "content", "playful", "waking", "still"] as const)("retains animated facial groups for %s", expression => {
    const { container } = render(<PetArt index={7} stage="baby" expression={expression} className="portrait" />);
    expect(container.querySelector(`.cat-rig.expression-${expression}.portrait`)).not.toBeNull();
    for (const face of ["open", "closed", "happy", "tired"]) {
      expect(container.querySelectorAll(`.sprite-eyes-${face} > *`)).toHaveLength(2);
    }
    expect(container.querySelector(".cat-mouth-chew")).not.toBeNull();
  });

  it("uses the same rig registry for every handbook stage and the current portrait", () => {
    const { container } = render(<GrowthPanel growth={growth} index={7} page={0} />);
    expect(container.querySelector(".growth-panel-title .cat-adult")).not.toBeNull();
    for (const stage of stages) {
      expect(container.querySelector(`.growth-${stage} .has-cat-rig .cat-${stage}`)).not.toBeNull();
    }
    expect(container.querySelector(".growth-preview[data-preview-stage='adult']")!.getAttribute("data-preview-form")).toBe("gentle");
    expect(growth.form).toBe("gentle");
  });

  it("shares registry routing, without inventing rigs for eggs or the remaining pets", () => {
    for (let index = 0; index < 10; index++) for (const stage of ["egg", ...stages] as GrowthStage[]) {
      const kind = stage === "egg" ? "original" : index === 2 ? "rabbit" : index === 7 ? "cat" : "original";
      expect(petRigKind(index, stage)).toBe(kind);
      expect(petRigClass(index, stage)).toBe(kind === "original" ? "" : `has-${kind}-rig`);
      const { container, unmount } = render(<PetArt index={index} stage={stage} />);
      expect(!!container.querySelector(".cat-rig")).toBe(kind === "cat");
      expect(!!container.querySelector(".rabbit-rig")).toBe(kind === "rabbit");
      expect(!!container.querySelector("image")).toBe(kind === "original");
      unmount();
    }
  });
});
