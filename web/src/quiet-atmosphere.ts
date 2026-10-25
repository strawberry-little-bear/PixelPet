import type { AdultForm, GrowthStage } from "./types";

export type QuietSeason = "spring" | "summer" | "autumn" | "winter";

export type QuietAtmosphere = {
  period: "late-night" | "dawn" | "day" | "afternoon" | "dusk" | "night";
  label: string;
  season: QuietSeason;
  seasonLabel: string;
  text: string;
  event: string;
};

type AtmosphereSeed = {
  period: QuietAtmosphere["period"];
  label: string;
  variants: readonly string[];
};

type SeasonSeed = {
  season: QuietSeason;
  label: string;
  events: readonly string[];
};

const atmosphereSeeds: readonly AtmosphereSeed[] = [
  { period: "late-night", label: "深夜", variants: [
    "夜很安静，连小窝里的呼吸都变得轻轻的。",
    "窗外没有急着经过的声音，陪它把这一刻放慢。",
    "灯影安安静静地落着，谁也不用赶着睡意离开。",
  ] },
  { period: "dawn", label: "晨光", variants: [
    "窗边的光刚刚亮起来，和它一起慢慢醒着。",
    "清晨的风从小窝旁边经过，带来一点新鲜的气息。",
    "天色还很柔和，今天可以从一小会儿陪伴开始。",
  ] },
  { period: "day", label: "白天", variants: [
    "白天的光落在小窝里，陪它看看窗外就很好。",
    "窗外有轻快的动静经过，它也安静听了一会儿。",
    "小窝里亮堂堂的，平常的一刻也值得一起待着。",
  ] },
  { period: "afternoon", label: "午后", variants: [
    "一小片云影慢慢经过，陪它看完也不必急着做什么。",
    "午后的光变得软软的，小窝也跟着安静下来。",
    "风把叶子的影子摇了摇，它抬头看了一会儿。",
  ] },
  { period: "dusk", label: "晚霞", variants: [
    "晚霞把小窝染成暖色，今天也可以慢慢收尾。",
    "天边的颜色变柔了，和它一起看一小会儿晚光。",
    "风里有一天结束前的温柔，陪它安静坐着就好。",
  ] },
  { period: "night", label: "月夜", variants: [
    "月光落在屏幕边，安静陪它待一会儿。",
    "夜色把窗外收得很远，小窝里只留下柔和的光。",
    "星光不急着说话，它也把动作放得轻轻的。",
  ] },
];

const seasonSeeds: readonly SeasonSeed[] = [
  { season: "spring", label: "春日", events: [
    "窗边的新叶晃了晃，它跟着抬头看了一眼。",
    "一小点花香飘过来，它把这阵风安静收进了今天。",
    "柔软的春风经过，它轻轻晃了晃身子。",
  ] },
  { season: "summer", label: "夏日", events: [
    "窗外的蝉声远远响着，它找到了最舒服的阴影。",
    "一阵凉风掠过小窝，它舒展了一下身子。",
    "窗边的帘影轻轻摇了一下，它安静地看了一会儿。",
  ] },
  { season: "autumn", label: "秋日", events: [
    "一片叶影慢慢落下，它安静地看完了。",
    "风里有淡淡的果实香，它朝窗边靠近了一点。",
    "树影换了新的颜色，它在小窝里多看了一会儿。",
  ] },
  { season: "winter", label: "冬日", events: [
    "窗边的光暖暖的，它往亮处挪近了一点。",
    "冷风在窗外经过，它把自己团成了舒服的一小团。",
    "冬日的安静落在小窝里，它轻轻眨了眨眼。",
  ] },
];

const stageIndex: Record<GrowthStage, number> = { egg: 0, baby: 1, growing: 2, adult: 3 };
const formIndex: Record<AdultForm, number> = { balanced: 0, lively: 1, gentle: 2, easygoing: 3 };

function validTimestamp(at: number): boolean {
  return Number.isSafeInteger(at) && at > 0 && at <= 8.64e15;
}

function periodForHour(hour: number): AtmosphereSeed {
  if (hour < 5) return atmosphereSeeds[0];
  if (hour < 9) return atmosphereSeeds[1];
  if (hour < 13) return atmosphereSeeds[2];
  if (hour < 17) return atmosphereSeeds[3];
  if (hour < 20) return atmosphereSeeds[4];
  return atmosphereSeeds[5];
}

// One-based local month; the presentation uses March–May for spring.
function seasonForMonth(month: number): SeasonSeed {
  if (month >= 3 && month <= 5) return seasonSeeds[0];
  if (month >= 6 && month <= 8) return seasonSeeds[1];
  if (month >= 9 && month <= 11) return seasonSeeds[2];
  return seasonSeeds[3];
}

/**
 * A small present-tense environmental cue for quiet company.
 * It is derived from the local clock and saved presentation fields only:
 * no randomness, persistence, reward, or claim about a past event.
 */
export function quietAtmosphere(
  species: number,
  stage: GrowthStage | undefined,
  form: AdultForm | "" | undefined,
  at = Date.now(),
): QuietAtmosphere | null {
  if (!Number.isInteger(species) || species < 0 || !validTimestamp(at)) return null;
  if (!stage || !(stage in stageIndex)) return null;
  const date = new Date(at);
  const period = periodForHour(date.getHours());
  const season = seasonForMonth(date.getMonth() + 1);
  const day = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const formOffset = form && form in formIndex ? formIndex[form as AdultForm] : 0;
  const seed = Math.abs(species * 7 + stageIndex[stage] * 3 + formOffset + day);
  return {
    period: period.period,
    label: period.label,
    season: season.season,
    seasonLabel: season.label,
    text: period.variants[seed % period.variants.length],
    event: season.events[Math.floor(seed / period.variants.length) % season.events.length],
  };
}
