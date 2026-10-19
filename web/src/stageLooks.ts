import { species } from "./types";
import type { GrowthStage } from "./types";

type StageLook = { pose: string; detail: string };
// Descriptions follow the independent rig drawings, not size scaling or gear.
// Keep the short pose shared with each rig's accessible label.
const looks: Record<Exclude<GrowthStage, "egg">, StageLook>[] = [
  {
    baby: { pose: "团坐抱尾", detail: "短尾贴在身边，小小的身体团坐着。" },
    growing: { pose: "探头踏步", detail: "身躯舒展开，向前探头、交替踏步。" },
    adult: { pose: "竖尾望星", detail: "蓬松环尾竖起，坐稳后抬头望星。" },
  },
  {
    baby: { pose: "绒团收翼", detail: "绒团般的身体，短翅收在两侧。" },
    growing: { pose: "探脚试翼", detail: "向前探脚，伸开小翅膀试着活动。" },
    adult: { pose: "停栖梳羽", detail: "站稳停栖，舒展翅膀、低头梳羽。" },
  },
  {
    baby: { pose: "团坐踢脚", detail: "短耳微折，团坐着轻轻踢脚。" },
    growing: { pose: "竖耳踏步", detail: "耳朵竖起，身躯展开、交替踏步。" },
    adult: { pose: "舒展挥手", detail: "长耳舒展，站稳后转头、举爪招呼。" },
  },
  {
    baby: { pose: "团身拢鳍", detail: "身体团起，小鳍收在身侧。" },
    growing: { pose: "扬鳍试游", detail: "身躯向前伸，扬起鳍试着游动。" },
    adult: { pose: "舒身摆尾", detail: "身体舒展开，摆动尾鳍与双鳍。" },
  },
  {
    baby: { pose: "裹盖团坐", detail: "菌盖罩着小小身躯，短脚团坐。" },
    growing: { pose: "歪盖探步", detail: "菌柄伸展，歪着菌盖向前探步。" },
    adult: { pose: "展盖轻摇", detail: "菌盖展开，舒展身躯、轻轻摇晃。" },
  },
  {
    baby: { pose: "桃团抱爪", detail: "桃团般的身体，短短双爪抱在身前。" },
    growing: { pose: "探身踏步", detail: "身躯向前探，伸爪、交替踏步。" },
    adult: { pose: "挺身揉颊", detail: "挺起身躯坐稳，举爪轻轻揉脸颊。" },
  },
  {
    baby: { pose: "团蹲拢蹼", detail: "团蹲着收起蹼足，身躯小而圆。" },
    growing: { pose: "探身试跃", detail: "向前探身，伸展后腿试着跳跃。" },
    adult: { pose: "舒蹼鸣唱", detail: "蹼足舒展，坐稳后轻轻鼓起喉部。" },
  },
  {
    baby: { pose: "团坐探爪", detail: "短耳、大头，短尾环抱着团坐的身躯。" },
    growing: { pose: "侧耳试步", detail: "耳朵竖起、尾巴伸长，侧头探脚。" },
    adult: { pose: "端坐理毛", detail: "端坐举爪理毛，尾尖卷起、轻轻摆动。" },
  },
  {
    baby: { pose: "抱尾拢翼", detail: "小翅收拢，团坐着抱住短尾。" },
    growing: { pose: "探身试翼", detail: "身躯向前伸展，张开小翼试着活动。" },
    adult: { pose: "展翼望星", detail: "双翼与尾巴舒展开，抬头望星。" },
  },
  {
    baby: { pose: "趴团抱爪", detail: "小身体团趴着，双爪收在身前。" },
    growing: { pose: "侧耳探步", detail: "侧耳观察，向前伸爪、探脚迈步。" },
    adult: { pose: "坐稳摇尾", detail: "挺身坐稳，双耳倾听、轻轻摇尾。" },
  },
];
const fallback = {
  egg: { pose: "等待孵化", detail: "孵化后开始三阶段旅程。" },
  baby: { pose: "幼年模样", detail: "幼年有自己的小小模样。" },
  growing: { pose: "探索新模样", detail: "成长后，身形和姿态会有变化。" },
  adult: { pose: "舒展陪伴", detail: "成年后仍能继续照顾、一起留下经历。" },
};
export function stageLook(index: number, stage: GrowthStage): StageLook {
  return stage === "egg" ? fallback.egg : looks[index]?.[stage] ?? fallback[stage];
}
export function petStageLabel(index: number, stage: GrowthStage): string {
  return `${species[index] ?? "小伙伴"}，${stageLook(index, stage).pose}`;
}
