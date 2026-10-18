import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PetArt, petRigKind } from "./PetArt";
import { PetScene } from "./PetScene";
import { GrowthPanel } from "./GrowthPanel";
import { act } from "@testing-library/react";
import { AlbumPanel } from "./AlbumPanel";
import { SnakeGame } from "./SnakeGame";
import { TileGame } from "./TileGame";
import { frogStages } from "./FrogRig";
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

describe("independently drawn frog", () => {
  it("draws every stage independently, rather than scaling or masking the source image", () => {
    for (const part of [
      "head", "body", "eyeLeft", "eyeRight", "lemonLeft", "lemonRight",
      "belly", "throat", "handLeft", "handRight", "thighLeft", "thighRight", "footLeft", "footRight",
    ] as const) {
      expect(
        new Set(stages.map((stage) => frogStages[stage][part])).size,
        part,
      ).toBe(3);
    }
    for (const stage of stages) {
      const { container, unmount } = render(<PetArt index={6} stage={stage} />);
      const svg = container.querySelector(".frog-rig")!;
      expect(svg.getAttribute("viewBox")).toBe("0 0 64 68");
      expect(svg.getAttribute("data-rig-stage")).toBe(stage);
      expect(svg.getAttribute("transform")).toBeNull();
      expect(svg.querySelector("image")).toBeNull();
      expect(svg.querySelectorAll(".frog-hand")).toHaveLength(2);
      expect(svg.querySelectorAll(".frog-foot")).toHaveLength(2);
      expect(svg.querySelectorAll(".frog-thigh")).toHaveLength(2);
      expect(svg.querySelectorAll(".frog-eye-pod")).toHaveLength(2);
      expect(svg.querySelector(".frog-head .sprite-face")).not.toBeNull();
      expect(svg.querySelector(".frog-torso .sprite-face")).toBeNull();
      expect(svg.querySelector(".frog-torso .frog-throat")).not.toBeNull();
      expect(svg.querySelector(".frog-head .frog-throat")).toBeNull();
      expect(svg.querySelector(".frog-tail,.frog-ear,.cat-whiskers,.need-paw,.paw-left,.paw-right")).toBeNull();
      for (const mark of ["head", "eye-pods", "lemon-marks", "throat", "belly", "cheeks"])
        expect(svg.querySelector(`.frog-${mark}`)).not.toBeNull();
      expect(svg.getAttribute("aria-label")).toContain("柠檬蛙");
      unmount();
    }
  });

  it.each(stages)(
    "uses webbed hands and hind limbs, equipment and action priority at %s",
    (stage) => {
      for (const motion of motions)
        for (const need of needs) {
          const { container, unmount } = render(
            <PetScene
              index={6}
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
          ).toBe("frog");
          expect(
            container.querySelector(
              `.has-frog-rig .frog-${stage}.rig-motion-${motion}`,
            ),
          ).not.toBeNull();
          expect(container.querySelectorAll(".frog-hand")).toHaveLength(2);
          if (motion === "idle") {
            const label = container.querySelector(".pet-scene")!.getAttribute("aria-label")!;
            expect(label).toContain({ hungry: "前蹼摸肚子", tired: "前蹼揉眼", dirty: "前蹼擦脸", playful: "伸蹼滚球", content: "微笑挥蹼", quiet: "收蹼安静" }[need]);
            expect(label).not.toMatch(/鳍|菌盖|翼|耳|爪/);
          }
          expect(container.querySelector(".need-paw,.frog-tail,.cat-rig,.rabbit-rig")).toBeNull();
          expect(container.querySelector(".need-gesture .need-paw")).toBeNull();
          expect(
            container.querySelector(".pet-scene")!.getAttribute("data-need"),
          ).toBe(motion === "idle" ? need : "none");
          expect(
            container
              .querySelector(".frog-rig")!
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
        <PetArt index={6} stage="adult" expression={expression} />,
      );
      expect(
        container.querySelector(`.frog-rig.expression-${expression}`),
      ).not.toBeNull();
      for (const face of ["open", "closed", "happy", "tired"])
        expect(
          container.querySelectorAll(`.sprite-eyes-${face} > *`),
        ).toHaveLength(2);
      expect(container.querySelector(".frog-mouth-open")).not.toBeNull();
    },
  );

  it.each(["balanced", "lively", "gentle", "easygoing"] as const)(
    "keeps saved %s form through the handbook and scene",
    (form) => {
      const saved = { ...growth, form };
      const { container, unmount } = render(
        <GrowthPanel growth={saved} index={6} page={0} />,
      );
      for (const stage of stages)
        expect(
          container.querySelector(
            `.growth-${stage} .has-frog-rig .frog-${stage}`,
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
          index={6}
          stage="adult"
          form={form}
          motion="idle"
          clipId={0}
          dirty={false}
        />,
      );
      expect(
        scene.container.querySelector(`.form-${form} .frog-adult`),
      ).not.toBeNull();
    },
  );

  it.each(stages)(
    "participates in tile collecting with real equipped webbed hands at %s",
    (stage) => {
      const pet = {
        species: 6,
        name: "柠檬蛙",
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
          `.tile-companion.collecting .frog-${stage}.rig-motion-celebrating`,
        ),
      ).not.toBeNull();
      expect(container.querySelectorAll(".frog-hand")).toHaveLength(2);
      expect(
        container.querySelector(
          '.frog-rig .equipped-accessory[data-item="berry-scarf"]',
        ),
      ).not.toBeNull();
      expect(
        container.querySelector("button,a,input,[role=button]"),
      ).toBeNull();
    },
  );

  it.each(stages)("uses equipped webbed hands for snake fruit celebrations at %s", (stage) => {
    const pet = {
      species: 6, name: "柠檬蛙", hatchedAt: 1, growth: { ...growth, stage },
      economy: { equipped: { accessory: "star-badge" } },
      game: {
        kind: "snake", snake: {
          body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
          food: { x: 8, y: 5 }, eaten: 0, step: 0, direction: 0, paused: false, lastMoveAt: 1
        }
      },
    } as PetState;
    const { container, rerender } = render(<SnakeGame pet={pet} active turn={0} />);
    expect(container.querySelector(`.snake-pet .frog-${stage}.rig-motion-idle`)).not.toBeNull();
    const next = { ...pet, game: { ...pet.game!, snake: { ...pet.game!.snake!, eaten: 1 } } };
    act(() => rerender(<SnakeGame pet={next} active turn={0} />));
    expect(container.querySelector(`.snake-companion.collecting .frog-${stage}.rig-motion-celebrating`)).not.toBeNull();
    expect(container.querySelectorAll(".frog-hand")).toHaveLength(2);
    expect(container.querySelector('.frog-rig .equipped-accessory[data-item="star-badge"]')).not.toBeNull();
    expect(container.querySelector(".need-paw,button,a,input,[role=button]")).toBeNull();
  });

  it.each(stages)("keeps %s memory portraits and stage-aligned accessories", (stage) => {
    const kind = { baby: "hatch", growing: "growing", adult: "adult" }[stage];
    const pet = {
      species: 6, name: "柠檬蛙", hatchedAt: 1, growth,
      album: { entries: [{ kind, at: 1, source: "shared", form: "balanced" }], legacy: false },
    } as PetState;
    const before = structuredClone(pet);
    const portrait = render(<AlbumPanel pet={pet} now={1000} page={1} />);
    expect(portrait.container.querySelector(`.album-portrait .frog-${stage}`)).not.toBeNull();
    expect(pet).toEqual(before);
    portrait.unmount();
    for (const accessory of ["leaf-pin", "berry-scarf", "star-badge"]) {
      const { container, unmount } = render(<PetArt index={6} stage={stage} accessory={accessory} />);
      const mark = container.querySelector(`.frog-rig .equipped-accessory[data-item="${accessory}"]`)!;
      expect(mark).not.toBeNull();
      expect(mark.getAttribute("transform")).toBe(`translate(32 ${frogStages[stage].accessoryY}) scale(${frogStages[stage].accessoryScale})`);
      expect(container.querySelectorAll(".equipped-accessory")).toHaveLength(1);
      unmount();
    }
  });

  it("ignores stale need poses during direct care and game previews", () => {
    for (const motion of motions.filter(m => m !== "idle")) {
      const { container, unmount } = render(<PetArt index={6} stage="adult" motion={motion} need="hungry" />);
      expect(container.querySelector(".gesture-hungry")).toBeNull();
      expect(container.querySelector(`.frog-rig.rig-motion-${motion}`)).not.toBeNull();
      unmount();
    }
  });

  it("leaves eggs and the two undrawn species on the original artwork", () => {
    expect(petRigKind(6, "egg")).toBe("original");
    for (const index of [8, 9])
      for (const stage of stages)
        expect(petRigKind(index, stage)).toBe("original");
    expect(petRigKind(2, "adult")).toBe("rabbit");
    expect(petRigKind(7, "adult")).toBe("cat");
    expect(petRigKind(0, "adult")).toBe("tanuki");
  });
});
