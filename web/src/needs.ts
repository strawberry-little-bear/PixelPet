import type { PetState } from "./types";

export type NeedKind = "hungry" | "tired" | "dirty" | "playful" | "content" | "quiet";
export type NeedSignal = { kind: NeedKind; text: string; urgent: boolean };
const messages: Record<NeedKind, string> = {
  hungry: "小肚子咕噜咕噜，想吃点东西",
  tired: "揉揉眼睛，想睡个软软的觉",
  dirty: "挠挠小脑袋，想洗个泡泡澡",
  playful: "把小球推给你，一起玩一会儿？",
  content: "眯眯眼、挥挥手，有你在真好",
  quiet: "靠近一点，想和你安静待一会儿",
};

// Anatomical wording follows the dolphin's actual fin poses, without changing
// shared priority, thresholds or rewards.
const dolphinMessages: Record<NeedKind, string> = {
  hungry: "小鳍贴贴肚子，想吃点东西",
  tired: "垂下小鳍，想睡个软软的觉",
  dirty: "小鳍蹭蹭身侧，想洗个泡泡澡",
  playful: "扬起小鳍，一起玩一会儿？",
  content: "眯眯眼、挥挥小鳍，有你在真好",
  quiet: "收拢小鳍，想和你安静待一会儿",
};

const mushroomMessages: Record<NeedKind, string> = {
  hungry: "小手贴贴肚子，想吃点东西",
  tired: "菌盖低低垂下，想睡个软软的觉",
  dirty: "拂拂菌盖，想洗个泡泡澡",
  playful: "举起小手，一起玩一会儿？",
  content: "摇摇菌盖、挥挥手，有你在真好",
  quiet: "轻靠着菌盖，想和你安静待一会儿",
};

const bearMessages: Record<NeedKind, string> = {
  hungry: "小爪摸摸肚子，想吃点东西",
  tired: "揉揉眼睛，想抱着软枕休息",
  dirty: "挠挠圆耳，想洗个泡泡澡",
  playful: "伸出小爪，陪我推推球？",
  content: "轻轻招爪，嫩芽也跟着开心",
  quiet: "把小爪抱在身前，想静静陪着你",
};

const frogMessages: Record<NeedKind, string> = {
  hungry: "前蹼摸摸肚子，想吃点东西",
  tired: "前蹼揉揉眼睛，想收蹼休息",
  dirty: "前蹼擦擦脸，想洗个泡泡澡",
  playful: "伸出前蹼，陪我滚滚球？",
  content: "轻轻挥蹼，开心得喉咙轻轻一鼓",
  quiet: "收拢蹼足，想和你安静待一会儿",
};

const dragonMessages: Record<NeedKind, string> = {
  hungry: "小爪摸摸肚子，想吃点东西",
  tired: "收起小翼、揉揉眼睛，想休息了",
  dirty: "挠挠星角，想洗个泡泡澡",
  playful: "伸出小爪，陪我推推球？",
  content: "微笑挥挥爪，星角也亮晶晶",
  quiet: "拢起小翼、抱好小爪，想静静陪着你",
};

// No timer, randomness, network request or reward: a saved state has exactly
// one expression. Body needs take priority over an invitation to play.
export function petNeed(pet: PetState | null): NeedSignal | null {
  if (!pet?.hatchedAt || pet.sleeping || pet.game) return null;
  const { hunger, energy, clean, mood } = pet.needs;
  const body = [
    { kind: "hungry" as const, value: hunger, threshold: 55 },
    { kind: "tired" as const, value: energy, threshold: 40 },
    { kind: "dirty" as const, value: clean, threshold: 45 },
  ];
  // Lowest critical value wins. Fixed ordering breaks ties, so polling won't
  // alternate competing messages. Eating/cleaning immediately recompute this.
  const urgent = body.filter(n => n.value <= 25).sort((a, b) => a.value - b.value)[0];
  const needed = urgent ?? body.filter(n => n.value <= n.threshold)
    .sort((a, b) => a.value / a.threshold - b.value / b.threshold)[0];
  const kind = needed?.kind ?? (mood <= 60
    ? (energy >= 45 ? "playful" : "quiet") : "content");
  return { kind, text: (pet.species === 3 ? dolphinMessages : pet.species === 4 ? mushroomMessages : pet.species === 5 ? bearMessages : pet.species === 6 ? frogMessages : pet.species === 8 ? dragonMessages : messages)[kind], urgent: !!urgent };
}
