// Shared by the menu and its read-only guidance so instructions name the
// choice the player can actually find. This does not determine availability.
export type CareMenuKind = "feed" | "clean" | "sleep" | "arcade";
const labels: Record<CareMenuKind, string> = {
  feed: "吃点东西",
  clean: "洗个澡澡",
  sleep: "睡个好觉",
  arcade: "一起玩耍",
};
export function careMenuLabel(kind: CareMenuKind, sleeping = false): string {
  return kind === "sleep" && sleeping ? "起床啦" : labels[kind];
}
