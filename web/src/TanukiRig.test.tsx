import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PetArt, petRigKind } from "./PetArt";
import { PetScene } from "./PetScene";
import { GrowthPanel } from "./GrowthPanel";
import { TileGame } from "./TileGame";
import { tanukiStages } from "./TanukiRig";
import type { Growth, PetState } from "./types";

afterEach(cleanup);
const stages = ["baby", "growing", "adult"] as const;
const motions = [
  "idle",
  "eating",
  "bathing",
  "sleeping",
  "waking",
  "celebrating",
] as const;
const needs = [
  "hungry",
  "tired",
  "dirty",
  "playful",
  "content",
  "quiet",
] as const;
const growth: Growth = {
  stage: "adult",
  points: 72,
  form: "balanced",
  trackedHours: 72,
  wellbeing: 60,
  growingAt: 1,
  adultAt: 2,
  care: {
    nutrition: 2,
    play: 1,
    clean: 2,
    rest: 3,
    lastFeed: 0,
    lastClean: 0,
    lastPlay: 0,
  },
};

describe("independently drawn star tanuki", () => {
  it("draws every stage independently, rather than scaling or masking the source image", () => {
    for (const part of [
      "head",
      "body",
      "earLeft",
      "earRight",
      "innerLeft",
      "innerRight",
      "mask",
      "muzzle",
      "bib",
      "tail",
      "rings",
      "footLeft",
      "footRight",
      "pawLeft",
      "pawRight",
    ] as const) {
      expect(
        new Set(stages.map((stage) => tanukiStages[stage][part])).size,
        part,
      ).toBe(3);
    }
    for (const stage of stages) {
      const { container, unmount } = render(<PetArt index={0} stage={stage} />);
      const svg = container.querySelector(".tanuki-rig")!;
      expect(svg.getAttribute("viewBox")).toBe("0 0 64 68");
      expect(svg.getAttribute("data-rig-stage")).toBe(stage);
      expect(svg.getAttribute("transform")).toBeNull();
      expect(svg.querySelector("image")).toBeNull();
      for (const part of ["ear", "paw", "foot"])
        expect(svg.querySelectorAll(`.tanuki-${part}`)).toHaveLength(2);
      for (const mark of ["star", "mask", "bib", "rings"])
        expect(svg.querySelector(`.tanuki-${mark}`)).not.toBeNull();
      expect(svg.getAttribute("aria-label")).toContain("星星狸");
      unmount();
    }
  });

  it.each(stages)(
    "uses anatomical limbs, equipment and action priority at %s",
    (stage) => {
      for (const motion of motions)
        for (const need of needs) {
          const { container, unmount } = render(
            <PetScene
              index={0}
              stage={stage}
              motion={motion}
              clipId={1}
              dirty
              need={need}
              equipped={{ accessory: "leaf-pin", room: "clover-pot" }}
            />,
          );
          expect(
            container.querySelector(".pet-scene")!.getAttribute("data-rig"),
          ).toBe("tanuki");
          expect(
            container.querySelector(
              `.has-tanuki-rig .tanuki-${stage}.rig-motion-${motion}`,
            ),
          ).not.toBeNull();
          expect(container.querySelectorAll(".need-paw")).toHaveLength(2);
          expect(container.querySelector(".need-gesture .need-paw")).toBeNull();
          expect(
            container.querySelector(".pet-scene")!.getAttribute("data-need"),
          ).toBe(motion === "idle" ? need : "none");
          expect(
            container
              .querySelector(".tanuki-rig")!
              .classList.contains(`gesture-${need}`),
          ).toBe(motion === "idle");
          expect(
            container.querySelector(
              '.equipped-accessory[data-item="leaf-pin"]',
            ),
          ).not.toBeNull();
          expect(
            container.querySelector('.room-decoration[data-item="clover-pot"]'),
          ).not.toBeNull();
          expect(
            container.querySelector("button,a,input,[role=button]"),
          ).toBeNull();
          unmount();
        }
    },
  );

  it.each(["awake", "still", "asleep", "chewing", "waking", ...needs] as const)(
    "retains facial expression groups for %s",
    (expression) => {
      const { container } = render(
        <PetArt index={0} stage="adult" expression={expression} />,
      );
      expect(
        container.querySelector(`.tanuki-rig.expression-${expression}`),
      ).not.toBeNull();
      for (const face of ["open", "closed", "happy", "tired"])
        expect(
          container.querySelectorAll(`.sprite-eyes-${face} > *`),
        ).toHaveLength(2);
      expect(container.querySelector(".tanuki-mouth-chew")).not.toBeNull();
    },
  );

  it.each(["balanced", "lively", "gentle", "easygoing"] as const)(
    "keeps saved %s form through the handbook and scene",
    (form) => {
      const saved = { ...growth, form };
      const { container, unmount } = render(
        <GrowthPanel growth={saved} index={0} page={0} />,
      );
      for (const stage of stages)
        expect(
          container.querySelector(
            `.growth-${stage} .has-tanuki-rig .tanuki-${stage}`,
          ),
        ).not.toBeNull();
      expect(
        container
          .querySelector('.growth-preview[data-preview-stage="adult"]')!
          .getAttribute("data-preview-form"),
      ).toBe(form);
      expect(saved.form).toBe(form);
      unmount();
      const scene = render(
        <PetScene
          index={0}
          stage="adult"
          form={form}
          motion="idle"
          clipId={0}
          dirty={false}
        />,
      );
      expect(
        scene.container.querySelector(`.form-${form} .tanuki-adult`),
      ).not.toBeNull();
    },
  );

  it.each(stages)(
    "participates in tile collecting with real equipped paws at %s",
    (stage) => {
      const pet = {
        species: 0,
        name: "星星狸",
        hatchedAt: 1,
        growth: { ...growth, stage },
        economy: { equipped: { accessory: "berry-scarf", room: "clover-pot" } },
        game: {
          kind: "tiles",
          tiles: {
            board: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8],
            pick: -1,
            pairs: 0,
            shuffles: 0,
          },
        },
      } as PetState;
      const { container } = render(
        <TileGame
          pet={pet}
          cursor={0}
          now={Date.now()}
          message=""
          link={{
            id: 1,
            tile: 1,
            path: [
              { x: 1, y: 1 },
              { x: 2, y: 1 },
            ],
          }}
        />,
      );
      expect(
        container.querySelector(
          `.tile-companion.collecting .tanuki-${stage}.rig-motion-celebrating`,
        ),
      ).not.toBeNull();
      expect(container.querySelectorAll(".tanuki-paw")).toHaveLength(2);
      expect(
        container.querySelector(
          '.tanuki-rig .equipped-accessory[data-item="berry-scarf"]',
        ),
      ).not.toBeNull();
      expect(
        container.querySelector("button,a,input,[role=button]"),
      ).toBeNull();
    },
  );

  it("leaves eggs and unknown species on the original artwork", () => {
    expect(petRigKind(0, "egg")).toBe("original");
    for (const index of [-1, 10])
      for (const stage of stages)
        expect(petRigKind(index, stage)).toBe("original");
    expect(petRigKind(2, "adult")).toBe("rabbit");
    expect(petRigKind(7, "adult")).toBe("cat");
  });
});
