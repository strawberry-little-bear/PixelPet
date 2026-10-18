export const clipDurations = {
  feed: 3000,
  clean: 4000,
  hatch: 1500,
  play: 1500,
  wake: 1400,
  evolve: 2400,
} as const;
export type ClipKind = keyof typeof clipDurations;
export type MotionClip = { kind: ClipKind; id: number };
export type SceneMotion =
  "idle" | "eating" | "bathing" | "sleeping" | "waking" | "celebrating";

export function sceneMotion(
  sleeping: boolean,
  clip: MotionClip | null,
): SceneMotion {
  if (sleeping) return "sleeping";
  if (!clip) return "idle";
  switch (clip.kind) {
    case "feed":
      return "eating";
    case "clean":
      return "bathing";
    case "wake":
      return "waking";
    default:
      return "celebrating";
  }
}

export function careClip(kind: string, sleeping: boolean): ClipKind | null {
  if (kind === "sleep") return sleeping ? null : "wake";
  return kind === "feed" || kind === "clean" || kind === "hatch" ? kind : null;
}
