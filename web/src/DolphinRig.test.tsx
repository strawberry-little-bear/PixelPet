import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PetArt, petRigKind } from "./PetArt";
import { PetScene } from "./PetScene";
import { GrowthPanel } from "./GrowthPanel";
import { act } from "@testing-library/react";
import { AlbumPanel } from "./AlbumPanel";
import { SnakeGame } from "./SnakeGame";
import { TileGame } from "./TileGame";
import { dolphinStages } from "./DolphinRig";
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

describe("independently drawn dolphin", () => {
  it("draws every stage independently, rather than scaling or masking the source image", () => {
    for (const part of [
      "head", "body", "belly", "dorsal", "snout", "gleam",
      "flipperLeft", "flipperRight", "flipperLightLeft", "flipperLightRight", "tail", "flukes",
    ] as const) {
      expect(
        new Set(stages.map((stage) => dolphinStages[stage][part])).size,
        part,
      ).toBe(3);
    }
    for (const stage of stages) {
      const { container, unmount } = render(<PetArt index={3} stage={stage} />);
      const svg = container.querySelector(".dolphin-rig")!;
      expect(svg.getAttribute("viewBox")).toBe("0 0 64 68");
      expect(svg.getAttribute("data-rig-stage")).toBe(stage);
      expect(svg.getAttribute("transform")).toBeNull();
      expect(svg.querySelector("image")).toBeNull();
      expect(svg.querySelectorAll(".dolphin-flipper")).toHaveLength(2);
      expect(svg.querySelector(".dolphin-foot,.dolphin-ear,.need-paw")).toBeNull();
      for (const mark of ["dorsal", "belly", "flukes", "snout", "cheeks"])
        expect(svg.querySelector(`.dolphin-${mark}`)).not.toBeNull();
      expect(svg.getAttribute("aria-label")).toContain("海豚宝");
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
              index={3}
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
          ).toBe("dolphin");
          expect(
            container.querySelector(
              `.has-dolphin-rig .dolphin-${stage}.rig-motion-${motion}`,
            ),
          ).not.toBeNull();
          expect(container.querySelectorAll(".dolphin-flipper")).toHaveLength(2);
          if (motion === "idle") {
            const label = container.querySelector(".pet-scene")!.getAttribute("aria-label")!;
            expect(label).not.toMatch(/揉眼|挠头|挥手/);
            expect(label).toContain("鳍");
          }
          expect(container.querySelector(".need-paw,.dolphin-ear,.cat-rig,.rabbit-rig")).toBeNull();
          expect(container.querySelector(".need-gesture .need-paw")).toBeNull();
          expect(
            container.querySelector(".pet-scene")!.getAttribute("data-need"),
          ).toBe(motion === "idle" ? need : "none");
          expect(
            container
              .querySelector(".dolphin-rig")!
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
        <PetArt index={3} stage="adult" expression={expression} />,
      );
      expect(
        container.querySelector(`.dolphin-rig.expression-${expression}`),
      ).not.toBeNull();
      for (const face of ["open", "closed", "happy", "tired"])
        expect(
          container.querySelectorAll(`.sprite-eyes-${face} > *`),
        ).toHaveLength(2);
      expect(container.querySelector(".dolphin-mouth-open")).not.toBeNull();
    },
  );

  it.each(["balanced", "lively", "gentle", "easygoing"] as const)(
    "keeps saved %s form through the handbook and scene",
    (form) => {
      const saved = { ...growth, form };
      const { container, unmount } = render(
        <GrowthPanel growth={saved} index={3} page={0} />,
      );
      for (const stage of stages)
        expect(
          container.querySelector(
            `.growth-${stage} .has-dolphin-rig .dolphin-${stage}`,
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
          index={3}
          stage="adult"
          form={form}
          motion="idle"
          clipId={0}
          dirty={false}
        />,
      );
      expect(
        scene.container.querySelector(`.form-${form} .dolphin-adult`),
      ).not.toBeNull();
    },
  );

  it.each(stages)(
    "participates in tile collecting with real equipped flippers at %s",
    (stage) => {
      const pet = {
        species: 3,
        name: "海豚宝",
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
          `.tile-companion.collecting .dolphin-${stage}.rig-motion-celebrating`,
        ),
      ).not.toBeNull();
      expect(container.querySelectorAll(".dolphin-flipper")).toHaveLength(2);
      expect(
        container.querySelector(
          '.dolphin-rig .equipped-accessory[data-item="berry-scarf"]',
        ),
      ).not.toBeNull();
      expect(
        container.querySelector("button,a,input,[role=button]"),
      ).toBeNull();
    },
  );

  it.each(stages)("uses equipped fins for snake fruit celebrations at %s", (stage) => {
    const pet = {
      species: 3, name: "海豚宝", hatchedAt: 1, growth: { ...growth, stage },
      economy: { equipped: { accessory: "star-badge" } },
      game: {
        kind: "snake", snake: {
          body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
          food: { x: 8, y: 5 }, eaten: 0, step: 0, direction: 0, paused: false, lastMoveAt: 1
        }
      },
    } as PetState;
    const { container, rerender } = render(<SnakeGame pet={pet} active turn={0} />);
    expect(container.querySelector(`.snake-pet .dolphin-${stage}.rig-motion-idle`)).not.toBeNull();
    const next = { ...pet, game: { ...pet.game!, snake: { ...pet.game!.snake!, eaten: 1 } } };
    act(() => rerender(<SnakeGame pet={next} active turn={0} />));
    expect(container.querySelector(`.snake-companion.collecting .dolphin-${stage}.rig-motion-celebrating`)).not.toBeNull();
    expect(container.querySelectorAll(".dolphin-flipper")).toHaveLength(2);
    expect(container.querySelector('.dolphin-rig .equipped-accessory[data-item="star-badge"]')).not.toBeNull();
    expect(container.querySelector(".need-paw,button,a,input,[role=button]")).toBeNull();
  });

  it.each(stages)("keeps %s memory portraits and stage-aligned accessories", (stage) => {
    const kind = { baby: "hatch", growing: "growing", adult: "adult" }[stage];
    const pet = {
      species: 3, name: "海豚宝", hatchedAt: 1, growth,
      album: { entries: [{ kind, at: 1, source: "shared", form: "balanced" }], legacy: false },
    } as PetState;
    const before = structuredClone(pet);
    const portrait = render(<AlbumPanel pet={pet} now={1000} page={1} />);
    expect(portrait.container.querySelector(`.album-portrait .dolphin-${stage}`)).not.toBeNull();
    expect(pet).toEqual(before);
    portrait.unmount();
    for (const accessory of ["leaf-pin", "berry-scarf", "star-badge"]) {
      const { container, unmount } = render(<PetArt index={3} stage={stage} accessory={accessory} />);
      const mark = container.querySelector(`.dolphin-rig .equipped-accessory[data-item="${accessory}"]`)!;
      expect(mark).not.toBeNull();
      expect(mark.getAttribute("transform")).toBe(`translate(32 ${dolphinStages[stage].accessoryY})`);
      expect(container.querySelectorAll(".equipped-accessory")).toHaveLength(1);
      unmount();
    }
  });

  it("ignores stale need poses during direct care and game previews", () => {
    for (const motion of motions.filter(m => m !== "idle")) {
      const { container, unmount } = render(<PetArt index={3} stage="adult" motion={motion} need="hungry" />);
      expect(container.querySelector(".gesture-hungry")).toBeNull();
      expect(container.querySelector(`.dolphin-rig.rig-motion-${motion}`)).not.toBeNull();
      unmount();
    }
  });

  it("leaves eggs and the four undrawn species on the original artwork", () => {
    expect(petRigKind(3, "egg")).toBe("original");
    for (const index of [5, 6, 8, 9])
      for (const stage of stages)
        expect(petRigKind(index, stage)).toBe("original");
    expect(petRigKind(2, "adult")).toBe("rabbit");
    expect(petRigKind(7, "adult")).toBe("cat");
    expect(petRigKind(0, "adult")).toBe("tanuki");
  });
});
