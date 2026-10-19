import type { PetState } from "./types";

// Catalog text is descriptive only: the server owns species selection and catches.
export const fishingSpots = ["芦苇湾", "荷叶池", "卵石岸"] as const;
export const fishCatalog = [
  { id: "reed-minnow", name: "青苇小鲦", spots: [0, 2], color: "#718a79", shape: "slim", story: "沿着芦苇影子，游出一条细细的银线。" },
  { id: "sun-carp", name: "暖阳小鲤", spots: [0, 1], color: "#b18c52", shape: "round", story: "像把一小片暖阳，轻轻藏在了鳞片里。" },
  { id: "ribbon-loach", name: "丝带泥鳅", spots: [0], color: "#927b64", shape: "long", story: "绕着水草转一个弯，尾巴像柔软的小丝带。" },
  { id: "lotus-fish", name: "荷花小鱼", spots: [1], color: "#a87d80", shape: "petal", story: "从荷叶下面探出头，鱼鳍像一片小花瓣。" },
  { id: "moon-perch", name: "月纹小鲈", spots: [1, 2], color: "#8285a0", shape: "striped", story: "身上弯弯的纹路，让人想起安静的月亮。" },
  { id: "pebble-goby", name: "石斑虾虎", spots: [2], color: "#9b8d68", shape: "spotted", story: "在圆圆的石头旁，发现了圆圆的小邻居。" },
  { id: "rain-koi", name: "雨珠小鲤", spots: [0, 1, 2], color: "#718f9b", shape: "rain", story: "把虚构雨景里的小水珠，悄悄藏进了银蓝色的鳞片。" },
] as const;
// Older servers cannot catch the new fish: do not advertise an impossible page.
export const fishCatalogFor = (pet: Pick<PetState, "schema">) => pet.schema >= 15 ? fishCatalog : fishCatalog.slice(0, 6);
export const fishInfo = (id?: string) => fishCatalog.find(f => f.id === id);
export const fishingMenu = ["继续钓鱼", "看看鱼图鉴", "放弃本局", "风景手记", "玩法说明"];
// Different real limb groups take part; birds/fins use a rod rest rather than
// inventing hands. The matching CSS animates their own anatomy, not an overlay arm.
export const fishingCompanions = [
  { rig: "tanuki", method: "paw", waiting: "小爪扶好竿，尾巴替你打着慢拍。", bite: "爪子握稳啦，B 一起提竿！" },
  { rig: "bird", method: "rest", waiting: "翅尖轻碰竿架，歪头看着鱼漂。", bite: "翅膀指向鱼漂，B 一起收鱼！" },
  { rig: "rabbit", method: "paw", waiting: "两只小爪扶着竿，耳朵听水声。", bite: "耳朵竖起来啦，B 一起提竿！" },
  { rig: "dolphin", method: "rest", waiting: "鳍轻扶竿架，在浅水边陪你等。", bite: "鳍尖拍了拍竿架，B 收鱼啦！" },
  { rig: "mushroom", method: "rest", waiting: "小短臂扶住竿架，菌盖遮点太阳。", bite: "菌盖轻点一下，B 一起收鱼！" },
  { rig: "bear", method: "paw", waiting: "厚厚的熊掌把鱼竿稳稳扶住。", bite: "熊掌握稳啦，B 慢慢提竿！" },
  { rig: "frog", method: "paw", waiting: "蹼掌搭着竿，蹲在岸边看涟漪。", bite: "蹼掌抬起来啦，B 收鱼！" },
  { rig: "cat", method: "paw", waiting: "小爪扶竿，耳朵追着鱼漂转。", bite: "尾巴翘起来啦，B 一起提竿！" },
  { rig: "dragon", method: "paw", waiting: "小龙爪扶着竿，翅膀安静收好。", bite: "龙爪握稳，翅膀张开，B 提竿！" },
  { rig: "dog", method: "paw", waiting: "前爪轻扶鱼竿，尾巴轻轻扫岸边。", bite: "耳朵抖一下，B 一起提竿！" },
] as const;

// Visual flavor only: cycle on confirmed elapsed time, not waitMs/candidate.
// No urgency, bite prediction, resource effects or independent timers.
export const fishingWaitNotes = [
  "水纹一圈圈散开，不急着提竿。",
  "风掠过水面，小伙伴还在陪你等。",
  "静静听一会儿水声，等明确的咬钩提示。",
] as const;
