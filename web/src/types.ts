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
 pond?: {since:number;fish:FishDiscovery[]};
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
  album?: Album;
  economy?: Economy;
  logs: { at: number; text: string }[];
  game?: {
    kind?: "tiles" | "snake" | "tetris" | "fishing";
 fishing?: Fishing;
    tetris?: Tetris;
    snake?: Snake;
    tiles?: TileMatch;
    id?: string;
    startedAt: number;
    round: number;
    score: number;
    lastBeat: number;
  };
};
export type CareFeedback = {
  kind: "feed" | "clean" | "catch" | "tile-pick" | "snake-finish" | "tetris-finish" | "fish-finish" | "sleep";
  points: number;
  habit?: "nutrition" | "clean" | "play";
  habitGain: number;
  reason: "credited" | "not-needed" | "cooldown" | "resting" | "awake";
  retryAt?: number;
};
export type Result = {
  state: PetState;
  message: string;
  serverTime: number;
  careFeedback?: CareFeedback;
  tileLink?: TilePoint[];
  shop?: Shop;
  returnRecap?: ReturnRecap;
  recapPending?: boolean;
  recapClaimed?: boolean;
};
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

export type ReturnSnapshot = {
  needs: Needs;
  stage: GrowthStage;
  form: AdultForm | "";
  points: number;
  rest: number;
  trackedHours: number;
};
export type ReturnRecap = {
  id: string;
  from: number;
  to: number;
  before: ReturnSnapshot;
  after: ReturnSnapshot;
};

export type Memory = {
  kind:
    | "hatch"
    | "growing"
    | "adult"
    | "meal"
    | "bath"
    | "goodnight"
    | "stars"
    | "perfect-stars"
    | "days"
    | "outfit"
    | "decoration"
    | "wallpaper"
    | "floor"
    | "tiles"
    | "snake"
    | "tetris"
    | "fishing";
  at: number;
  source: "shared" | "saved" | "elapsed";
  form?: AdultForm;
  score?: number;
  days?: number;
  item?: string;
};
export type Album = { since: number; legacy: boolean; entries: Memory[] };

export type Equipment = { accessory: string; room: string; wallpaper?: string; floor?: string };
export type Economy = {
  coins: number;
  lastDailyAt: number;
  lastGameAt: number;
  gameCoins: number;
  owned: string[];
  equipped: Equipment;
};
export type ShopItem = {
  id: string;
  name: string;
  slot: "accessory" | "room" | "wallpaper" | "floor";
  price: number;
  description: string;
};
export type Shop = {
  catalog: ShopItem[];
  dailyCoins: number;
  gameDailyLimit: number;
  maxCoins?: number;
};

export type TilePoint = { x: number; y: number };
export type TileMatch = {
  board: number[];
  pick: number;
  pairs: number;
  shuffles: number;
};

export type Snake = {
 body: TilePoint[]; food: TilePoint; direction: number; eaten: number; step: number; lastMoveAt: number; paused: boolean; end?: "wall" | "body" | "won" | "limit";
};

export type Falling = {kind:number;rotation:number;x:number;y:number};
export type Tetris = {
 board:number[];active?:Falling;next:number;bag:number[];lines:number;pieces:number;step:number;lastFallAt:number;paused:boolean;end?:"won"|"stacked"|"limit";
};

export type FishDiscovery = {id:string;firstAt:number;lastAt:number;count:number};
export type Fishing = {spot:number;casts:number;catches:string[];phase:"ready"|"wait"|"bite"|"result"|"done";step:number;waitMs:number;elapsedMs:number;candidate:string;lastPulseAt:number;paused:boolean;outcome?:"caught"|"early"|"missed";lastFish?:string};
