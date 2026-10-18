export type Needs = {
  hunger: number;
  mood: number;
  clean: number;
  energy: number;
};
export type GrowthStage = "egg" | "baby" | "growing" | "adult";
export type AdultForm = "balanced" | "lively" | "gentle" | "easygoing";
export type Growth = {
  stage: GrowthStage;
  points: number;
  form: AdultForm | "";
  trackedHours: number;
  wellbeing: number;
  growingAt: number;
  adultAt: number;
  care: {
    nutrition: number;
    play: number;
    clean: number;
    rest: number;
    lastFeed: number;
    lastPlay: number;
    lastClean: number;
  };
};
export type PetState = {
  schema: number;
  revision: number;
  species: number;
  name: string;
  createdAt: number;
  hatchedAt: number;
  lastTick: number;
  sleeping: boolean;
  needs: Needs;
  careCount: number;
  growth?: Growth;
  logs: { at: number; text: string }[];
  game?: { startedAt: number; round: number; score: number; lastBeat: number };
};
export type Result = { state: PetState; message: string; serverTime: number };
export const species = [
  "星星狸",
  "云朵雀",
  "草莓兔",
  "海豚宝",
  "蘑菇菇",
  "蜜桃熊",
  "柠檬蛙",
  "樱花喵",
  "银河龙",
  "焦糖犬",
];
export const personalities = [
  "把每一天都点亮的小太阳。",
  "把云朵揉成柔软的好心情。",
  "今天的心情，是草莓味的。",
  "想把一整片海的快乐送给你。",
  "慢一点，快乐也会长出来。",
  "像一颗蜜桃，软软地陪着你。",
  "有一点点酸，也有很多甜。",
  "把春天藏在耳朵边的小花里。",
  "小小的身体，装着整个银河。",
  "焦糖色的日子，有你就很甜。",
];
