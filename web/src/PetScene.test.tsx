import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PetScene } from "./PetScene";
import { PetArt } from "./PetArt";
import type { NeedKind } from "./needs";
import type { SceneMotion } from "./motion";
import type { GrowthStage } from "./types";

afterEach(cleanup);

const signals: NeedKind[] = ["hungry", "tired", "dirty", "playful", "content", "quiet"];

describe("need gestures respect the scene's higher priority actions", () => {
  it.each(signals)("expresses %s with a face and articulated paws, not extra controls", need => {
    for (const index of [0, 2, 7]) {
      const { container, unmount } = render(
        <PetScene index={index} motion="idle" clipId={0} dirty={false} need={need} />,
      );
      expect(container.querySelector(".pet-scene")?.getAttribute("data-need")).toBe(need);
      expect(container.querySelector(`.expression-${need}`)).not.toBeNull();
      expect(container.querySelector(`.need-gesture.gesture-${need}`)).not.toBeNull();
      // Rig limbs are anatomical parts, not a second pair overlaid on top.
      expect(container.querySelectorAll(".need-paw")).toHaveLength(2);
      expect(container.querySelector("button")).toBeNull();
      unmount();
    }
  });

  it.each([
    ["eating", "chewing"], ["bathing", "content"], ["sleeping", "asleep"],
    ["waking", "waking"], ["celebrating", "content"],
  ] as const)("%s suppresses every proactive signal", (motion, expression) => {
    for (const index of [2, 7]) for (const need of signals) {
      const { container, unmount } = render(
        <PetScene index={index} motion={motion as SceneMotion} clipId={1} dirty need={need} />,
      );
      expect(container.querySelector(".pet-scene")?.getAttribute("data-need")).toBe("none");
      expect(container.querySelector(".need-gesture")).toBeNull();
      expect(container.querySelector("[class*='gesture-']")).toBeNull();
      expect(container.querySelector(`.${index === 2 ? "rabbit" : "cat"}-rig.expression-${expression}`)).not.toBeNull();
      unmount();
    }
  });
});

describe("independently drawn strawberry rabbit growth sample", () => {
  it("uses distinct anatomy on the same canvas with real articulated parts", () => {
    const silhouettes: string[] = [];
    const bodies: string[] = [];
    const ears: string[] = [];
    for (const stage of ["baby", "growing", "adult"] as GrowthStage[]) {
      const { container, unmount } = render(<PetArt index={2} stage={stage} expression="awake" />);
      const rig = container.querySelector(".rabbit-rig")!;
      expect(rig.getAttribute("viewBox")).toBe("0 0 64 68");
      expect(rig.getAttribute("data-rig-stage")).toBe(stage);
      expect(rig.querySelector("image")).toBeNull();
      expect(rig.querySelectorAll(".rabbit-ear")).toHaveLength(2);
      expect(rig.querySelectorAll(".rabbit-foot")).toHaveLength(2);
      expect(rig.querySelectorAll(".rabbit-arm")).toHaveLength(2);
      expect(rig.querySelector(".rabbit-strawberry")).not.toBeNull();
      silhouettes.push(rig.querySelector(".rabbit-head-shape")!.getAttribute("d")!);
      bodies.push(rig.querySelector(".rabbit-body-shape")!.getAttribute("d")!);
      ears.push(rig.querySelector(".ear-left path")!.getAttribute("d")!);
      unmount();
    }
    expect(new Set(silhouettes).size).toBe(3);
    expect(new Set(bodies).size).toBe(3);
    expect(new Set(ears).size).toBe(3);
  });

  it("keeps the source sheet for the remaining three pets until their own rigs are drawn", () => {
    for (const index of [6, 8, 9]) {
      const { container, unmount } = render(<PetArt index={index} stage="growing" expression="tired" />);
      expect(container.querySelector(".rabbit-rig")).toBeNull();
      expect(container.querySelector(".expression-tired image")?.getAttribute("href"))
        .toBe("/pets/characters.png");
      unmount();
    }
  });
});
