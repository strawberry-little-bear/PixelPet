import { DragonRig } from "./DragonRig";
import { FrogRig } from "./FrogRig";
import { BearRig } from "./BearRig";
import { MushroomRig } from "./MushroomRig";
import { DolphinRig } from "./DolphinRig";
import { BirdRig } from "./BirdRig";
import { TanukiRig } from "./TanukiRig";
import { CatRig } from "./CatRig";
import { RabbitRig } from "./RabbitRig";
import { Sprite } from "./Sprite";
import type { Expression } from "./Sprite";
import type { GrowthStage } from "./types";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";

// A single registry keeps scenes, handbook previews and future rigs in sync.
export function petRigKind(
  index: number,
  stage: GrowthStage,
): "rabbit" | "cat" | "tanuki" | "bird" | "dolphin" | "mushroom" | "bear" | "frog" | "dragon" | "original" {
  if (stage === "egg") return "original";
  return index === 0
    ? "tanuki"
    : index === 1
      ? "bird"
      : index === 2
        ? "rabbit"
        : index === 3
          ? "dolphin"
          : index === 4
            ? "mushroom"
            : index === 5
              ? "bear"
              : index === 6
                ? "frog"
                : index === 7
                  ? "cat"
                  : index === 8
                    ? "dragon"
                    : "original";
}
export function petRigClass(index: number, stage: GrowthStage): string {
  const kind = petRigKind(index, stage);
  return kind === "original" ? "" : `has-${kind}-rig`;
}

export function PetArt({
  index,
  stage,
  expression,
  motion,
  need,
  className,
  accessory,
}: {
  index: number;
  stage: GrowthStage;
  expression?: Expression;
  motion?: SceneMotion;
  need?: NeedKind;
  className?: string;
  accessory?: string;
}) {
  const Rig = {
    rabbit: RabbitRig,
    cat: CatRig,
    tanuki: TanukiRig,
    bird: BirdRig,
    dolphin: DolphinRig,
    mushroom: MushroomRig,
    bear: BearRig,
    frog: FrogRig,
    dragon: DragonRig,
    original: null,
  }[petRigKind(index, stage)];
  return Rig ? (
    <Rig
      stage={stage}
      expression={expression}
      motion={motion}
      need={need}
      className={className}
      accessory={accessory}
    />
  ) : (
    <Sprite
      index={index}
      expression={expression}
      className={className}
      accessory={accessory}
    />
  );
}
