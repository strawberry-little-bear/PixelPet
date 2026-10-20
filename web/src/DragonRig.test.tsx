import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PetArt, petRigKind } from "./PetArt";
import { PetScene } from "./PetScene";
import { GrowthPanel } from "./GrowthPanel";
import { act } from "@testing-library/react";
import { AlbumPanel } from "./AlbumPanel";
import { SnakeGame } from "./SnakeGame";
import { TileGame } from "./TileGame";
import { dragonStages } from "./DragonRig";
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

describe("independently drawn dragon", () => {
  it("draws every stage independently, rather than scaling or masking the source image", () => {
    for (const part of [
      "head", "body", "muzzle", "belly", "hornLeft", "hornRight", "starLeft", "starRight", "crest",
      "wingLeft", "wingRight", "membraneLeft", "membraneRight", "tail", "tailSpines", "handLeft", "handRight", "footLeft", "footRight",
    ] as const) {
      expect(
        new Set(stages.map((stage) => dragonStages[stage][part])).size,
        part,
      ).toBe(3);
    }
    for (const stage of stages) {
      const { container, unmount } = render(<PetArt index={8} stage={stage} />);
      const svg = container.querySelector(".dragon-rig")!;
      expect(svg.getAttribute("viewBox")).toBe("0 0 64 68");
      expect(svg.getAttribute("data-rig-stage")).toBe(stage);
      expect(svg.getAttribute("transform")).toBeNull();
      expect(svg.querySelector("image")).toBeNull();
      expect(svg.querySelectorAll(".dragon-hand")).toHaveLength(2);
      expect(svg.querySelectorAll(".dragon-foot")).toHaveLength(2);
      expect(svg.querySelectorAll(".dragon-wing")).toHaveLength(2);
      expect(svg.querySelectorAll(".dragon-horn")).toHaveLength(2);
      expect(svg.querySelectorAll(".dragon-tail")).toHaveLength(1);
      expect(svg.querySelector(".dragon-head .sprite-face")).not.toBeNull();
      expect(svg.querySelector(".dragon-torso .sprite-face")).toBeNull();
      expect(svg.querySelector(".dragon-torso .dragon-belly")).not.toBeNull();
      expect(svg.querySelector(".dragon-head .dragon-belly")).toBeNull();
      expect(svg.querySelector(".dragon-ear,.cat-whiskers,.need-paw,.paw-left,.paw-right")).toBeNull();
      for (const mark of ["head", "horns", "stars", "crest", "muzzle", "belly", "cheeks", "nostrils", "tail-spines"])
        expect(svg.querySelector(`.dragon-${mark}`)).not.toBeNull();
      expect(svg.getAttribute("aria-label")).toContain("银河龙");
      unmount();
    }
  });

  it.each(stages)(
    "uses articulated wings, tail and claws, equipment and action priority at %s",
    (stage) => {
      for (const motion of motions)
        for (const need of needs) {
          const { container, unmount } = render(
            <PetScene
              index={8}
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
          ).toBe("dragon");
          expect(
            container.querySelector(
              `.has-dragon-rig .dragon-${stage}.rig-motion-${motion}`,
            ),
          ).not.toBeNull();
          expect(container.querySelectorAll(".dragon-hand")).toHaveLength(2);
          if (motion === "idle") {
            const label = container.querySelector(".pet-scene")!.getAttribute("aria-label")!;
            expect(label).toContain({ hungry: "小爪摸肚子", tired: "收翼揉眼", dirty: "挠挠星角", playful: "伸爪推球", content: "微笑挥爪", quiet: "拢翼抱爪安静" }[need]);
            expect(label).not.toMatch(/鳍|菌盖|蹼|耳/);
          }
          expect(container.querySelector(".need-paw,.cat-rig,.rabbit-rig")).toBeNull();
          expect(container.querySelector(".need-gesture .need-paw")).toBeNull();
          expect(
            container.querySelector(".pet-scene")!.getAttribute("data-need"),
          ).toBe(motion === "idle" ? need : "none");
          expect(
            container
              .querySelector(".dragon-rig")!
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
        <PetArt index={8} stage="adult" expression={expression} />,
      );
      expect(
        container.querySelector(`.dragon-rig.expression-${expression}`),
      ).not.toBeNull();
      for (const face of ["open", "closed", "happy", "tired"])
        expect(
          container.querySelectorAll(`.sprite-eyes-${face} > *`),
        ).toHaveLength(2);
      expect(container.querySelector(".dragon-mouth-open")).not.toBeNull();
    },
  );

  it.each(["balanced", "lively", "gentle", "easygoing"] as const)(
    "keeps saved %s form through the handbook and scene",
    (form) => {
      const saved = { ...growth, form };
      const { container, unmount } = render(
        <GrowthPanel growth={saved} index={8} page={0} />,
      );
      for (const stage of stages)
        expect(
          container.querySelector(
            `.growth-${stage} .has-dragon-rig .dragon-${stage}`,
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
          index={8}
          stage="adult"
          form={form}
          motion="idle"
          clipId={0}
          dirty={false}
        />,
      );
      expect(
        scene.container.querySelector(`.form-${form} .dragon-adult`),
      ).not.toBeNull();
    },
  );

  it.each(stages)(
    "participates in tile collecting with real equipped claws at %s",
    (stage) => {
      const pet = {
        species: 8,
        name: "银河龙",
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
          `.tile-companion.collecting .dragon-${stage}.rig-motion-celebrating`,
        ),
      ).not.toBeNull();
      expect(container.querySelectorAll(".dragon-hand")).toHaveLength(2);
      expect(
        container.querySelector(
          '.dragon-rig .equipped-accessory[data-item="berry-scarf"]',
        ),
      ).not.toBeNull();
      expect(
        container.querySelector("button,a,input,[role=button]"),
      ).toBeNull();
    },
  );

  it.each(stages)("uses equipped claws for snake fruit celebrations at %s", (stage) => {
    const pet = {
      species: 8, name: "银河龙", hatchedAt: 1, growth: { ...growth, stage },
      economy: { equipped: { accessory: "star-badge" } },
      game: {
        kind: "snake", snake: {
          body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
          food: { x: 8, y: 5 }, eaten: 0, step: 0, direction: 0, paused: false, lastMoveAt: 1
        }
      },
    } as PetState;
    const { container, rerender } = render(<SnakeGame pet={pet} now={pet.lastTick} active turn={0} />);
    expect(container.querySelector(`.snake-pet .dragon-${stage}.rig-motion-idle`)).not.toBeNull();
    const next = { ...pet, game: { ...pet.game!, snake: { ...pet.game!.snake!, eaten: 1 } } };
    act(() => rerender(<SnakeGame pet={next} now={next.lastTick} active turn={0} />));
    expect(container.querySelector(`.snake-companion.collecting .dragon-${stage}.rig-motion-celebrating`)).not.toBeNull();
    expect(container.querySelectorAll(".dragon-hand")).toHaveLength(2);
    expect(container.querySelector('.dragon-rig .equipped-accessory[data-item="star-badge"]')).not.toBeNull();
    expect(container.querySelector(".need-paw,button,a,input,[role=button]")).toBeNull();
  });

  it.each(stages)("keeps %s memory portraits and stage-aligned accessories", (stage) => {
    const kind = { baby: "hatch", growing: "growing", adult: "adult" }[stage];
    const pet = {
      species: 8, name: "银河龙", hatchedAt: 1, growth,
      album: { entries: [{ kind, at: 1, source: "shared", form: "balanced" }], legacy: false },
    } as PetState;
    const before = structuredClone(pet);
    const portrait = render(<AlbumPanel pet={pet} now={1000} page={1} />);
    expect(portrait.container.querySelector(`.album-portrait .dragon-${stage}`)).not.toBeNull();
    expect(pet).toEqual(before);
    portrait.unmount();
    for (const accessory of ["leaf-pin", "berry-scarf", "star-badge"]) {
      const { container, unmount } = render(<PetArt index={8} stage={stage} accessory={accessory} />);
      const mark = container.querySelector(`.dragon-rig .equipped-accessory[data-item="${accessory}"]`)!;
      expect(mark).not.toBeNull();
      expect(mark.getAttribute("transform")).toBe(`translate(32 ${dragonStages[stage].accessoryY}) scale(${dragonStages[stage].accessoryScale})`);
      expect(container.querySelectorAll(".equipped-accessory")).toHaveLength(1);
      unmount();
    }
  });

  it("ignores stale need poses during direct care and game previews", () => {
    for (const motion of motions.filter(m => m !== "idle")) {
      const { container, unmount } = render(<PetArt index={8} stage="adult" motion={motion} need="hungry" />);
      expect(container.querySelector(".gesture-hungry")).toBeNull();
      expect(container.querySelector(`.dragon-rig.rig-motion-${motion}`)).not.toBeNull();
      unmount();
    }
  });

  it("leaves eggs and unknown species on the original artwork", () => {
    expect(petRigKind(8, "egg")).toBe("original");
    for (const index of [-1, 10])
      for (const stage of stages)
        expect(petRigKind(index, stage)).toBe("original");
    expect(petRigKind(2, "adult")).toBe("rabbit");
    expect(petRigKind(7, "adult")).toBe("cat");
    expect(petRigKind(0, "adult")).toBe("tanuki");
  });
});
