import type { Walking } from "./types";

export const parkCatalog = [
 {id:"leaf", name:"银杏叶", color:"#afad58", story:"小路旁捡到的扇形叶片。"},
 {id:"pinecone", name:"小松果", color:"#967456", story:"树荫下遇见的一颗松果。"},
 {id:"feather", name:"落羽", color:"#c3c8ac", story:"风吹来的一根轻轻的羽毛。"},
 {id:"flower", name:"落花", color:"#c39796", story:"留在小路上的一朵落花。"},
 {id:"shell", name:"水边贝壳", color:"#b4a78c", story:"浅水道边发现的小贝壳。"},
 {id:"pebble", name:"圆石子", color:"#91a18e", story:"公园里一颗圆圆的小石子。"},
] as const;
export const walkMenu = ["继续散步", "沿途发现", "放弃本次", "风景手记", "玩法说明"];
export const walkingCompanions = [
 "小爪迈步，跳起时收爪，低头通过树枝。",
 "小脚走路，展翅越石，收翅低头穿过树枝。",
 "后脚轻跳，收前爪越石，低头收耳通过。",
 "沿并行浅水道游动，A 跃水，B 下潜。",
 "小脚慢走，抬起菌柄越石，低下菌盖通过。",
 "厚脚掌迈步，收熊掌越石，低头通过。",
 "后足蹬地，收前掌跳起，伏低通过树枝。",
 "脚掌轻踩，收爪跳起，低头通过。",
 "小脚前进，张翼越石，收翼低头通过。",
 "脚掌交替，收爪越石，低耳通过树枝。",
];

/** Only explain the current visible obstacle and acknowledged pose. No local
 * clock, history reconstruction, hidden route preview or automatic input. */
export function walkingTimingHint(walking: Walking, dolphin: boolean): string {
 const rock = walking.route[Math.floor(walking.beat / 6)] === "rock";
 const input = rock ? "A" : "B";
 const action = rock ? dolphin ? "跃水" : "跳跃" : dolphin ? "下潜" : "蹲下";
 const remaining = 6 - walking.beat % 6;
 if (walking.pose === (rock ? "jump" : "duck")) {
  return walking.poseUntil >= walking.beat + remaining
   ? `${action}可覆盖本处 · 不必连按。`
   : `动作会先结束 · 近 3 步再按 ${input} ${action}。`;
 }
 return remaining > 3
  ? `近 3 步再按 ${input} ${action} · 动作保持 3 步。`
  : `现在按 ${input} ${action} · 动作保持 3 步。`;
}
