import type { AdultForm, GrowthStage } from "./types";

// Present-tense companionship, not a claimed memory, event or care reward.
// Only use a recorded stage; legacy saves without growth keep their old cue.
type LivingStage = Exclude<GrowthStage, "egg">;
type Voice = { content: string; quiet: string };
const voices: readonly Record<LivingStage, Voice>[] = [
  {
    baby: { content: "尾巴还是小小一团，坐你身边刚刚好", quiet: "抱着短短的尾巴，想安静靠你一会儿" },
    growing: { content: "尾巴蓬起来啦，想和你看看窗外", quiet: "蓬尾巴收在身旁，今天想慢一点" },
    adult: { content: "大尾巴暖暖的，陪你坐着也很好", quiet: "把大尾巴圈好，我们安静待一会儿吧" },
  },
  {
    baby: { content: "小翅还裹着绒绒，和你待着真安心", quiet: "小翅收进绒绒里，想安静挨着你" },
    growing: { content: "小翅舒展开啦，想和你看看云朵", quiet: "试翼也可以慢慢来，先收翅歇一会儿" },
    adult: { content: "羽翼舒舒服服，停在你身边也很好", quiet: "收好羽翼，今天想安静停一会儿" },
  },
  {
    baby: { content: "短耳软软垂着，团坐在你身边真好", quiet: "短耳轻轻垂着，想和你安静团坐" },
    growing: { content: "耳朵竖起来啦，想和你听听小窝的声音", quiet: "竖耳听听风，今天不用急着往前跳" },
    adult: { content: "长耳舒展开，陪你听听风也很好", quiet: "长耳轻轻歇着，我们安静待一会儿吧" },
  },
  {
    baby: { content: "小鳍贴着圆圆身体，挨着你真安心", quiet: "收好短短的小鳍，想安静陪你一会儿" },
    growing: { content: "小鳍舒展开啦，想和你看看水面的光", quiet: "试游也可以慢慢来，先收鳍歇一会儿" },
    adult: { content: "尾鳍舒展开，陪你看看水光也很好", quiet: "把双鳍放轻，今天想安静待一会儿" },
  },
  {
    baby: { content: "小菌盖罩着团团身体，挨着你真安心", quiet: "躲在小菌盖下，想和你安静团坐" },
    growing: { content: "菌柄长高一点啦，想和你看看窗外", quiet: "歪着菌盖歇一会儿，长大不用着急" },
    adult: { content: "菌盖舒展开，陪你慢慢待着也很好", quiet: "把菌盖放稳，今天想安静陪着你" },
  },
  {
    baby: { content: "短爪抱着桃团身体，坐你身边真安心", quiet: "把短短的小爪抱好，想安静挨着你" },
    growing: { content: "小爪能伸远一点啦，想和你看看窗外", quiet: "把探出的小爪收好，今天想慢一点" },
    adult: { content: "坐稳了挥挥爪，陪你待着就很甜", quiet: "小爪轻贴脸颊，今天想安静陪着你" },
  },
  {
    baby: { content: "短蹼收成小小一团，挨着你真安心", quiet: "收好短短的蹼足，想安静蹲一会儿" },
    growing: { content: "后腿舒展开啦，想和你看看绿叶", quiet: "试跳也可以慢慢来，先收蹼歇一会儿" },
    adult: { content: "蹼足舒舒服服，陪你看看绿叶也很好", quiet: "把蹼足放松，今天想安静待一会儿" },
  },
  {
    baby: { content: "短尾巴圈着小爪，团坐你身边真好", quiet: "短尾巴轻轻圈好，想安静挨着你" },
    growing: { content: "尾巴伸长一点啦，想和你看看窗外", quiet: "侧耳听听风，今天想收爪歇一会儿" },
    adult: { content: "卷起尾尖坐稳，陪你看看光也很好", quiet: "尾尖轻轻卷好，今天想安静陪着你" },
  },
  {
    baby: { content: "小翼裹着短尾巴，挨着你真安心", quiet: "抱好短尾、收起小翼，想安静靠一会儿" },
    growing: { content: "小翼舒展开啦，想和你看看远处的光", quiet: "试翼也可以慢慢来，先抱爪歇一会儿" },
    adult: { content: "双翼舒展开，陪你看看天空也很好", quiet: "拢好双翼和长尾，今天想安静陪着你" },
  },
  {
    baby: { content: "短爪收在身前，团趴你身边真安心", quiet: "抱好短短的小爪，想安静趴一会儿" },
    growing: { content: "前爪能探远一点啦，想和你听听风", quiet: "侧耳听听小窝，今天想慢一点" },
    adult: { content: "坐稳了摇摇尾，陪你待着就很甜", quiet: "软耳和尾巴都放松，今天想安静陪着你" },
  },
];

// A present-tense style for the saved adult form, never a care verdict or a
// newly inferred personality. Low-energy quiet cues keep their neutral wording.
const adultVoices: readonly Record<AdultForm, string>[] = [
  {
    balanced: "大尾巴轻轻圈好，陪你看光也听听风",
    lively: "蓬尾巴轻快地晃晃，想和你看看新风景",
    gentle: "大尾巴暖暖围在身旁，静静陪你歇一会儿",
    easygoing: "把大尾巴随意铺好，我们慢慢待着就好",
  },
  {
    balanced: "羽翼轻轻舒展开，陪你看云也听听风",
    lively: "羽翼精神地扬起来，想和你看看远处",
    gentle: "羽翼柔柔收在身旁，安静停着陪你",
    easygoing: "羽翼松松地拢好，我们不赶着飞远",
  },
  {
    balanced: "长耳轻轻转向你，陪你听风也看看光",
    lively: "长耳精神地竖起来，想和你听听新声音",
    gentle: "长耳软软歇在身侧，安静陪你听风",
    easygoing: "长耳随意舒展开，我们慢慢待着就好",
  },
  {
    balanced: "双鳍轻轻舒展开，陪你看光也听听水声",
    lively: "小鳍精神地扬扬，想和你看看闪亮水光",
    gentle: "双鳍柔柔贴在身侧，静静陪你看水光",
    easygoing: "尾鳍松松地摆好，我们慢慢看水光吧",
  },
  {
    balanced: "菌盖轻轻转向你，陪你看光也看看叶子",
    lively: "菌盖轻快地摇摇，想和你看看新绿叶",
    gentle: "菌盖稳稳停下来，安静陪你看一会儿光",
    easygoing: "菌盖随意歪一点，我们慢慢待着就好",
  },
  {
    balanced: "小爪舒舒服服放好，陪你看光也听听风",
    lively: "小爪精神地挥挥，想和你看看新风景",
    gentle: "小爪软软抱在身前，安静陪着你就好",
    easygoing: "把小爪随意搭好，我们慢慢待着就好",
  },
  {
    balanced: "蹼足轻轻收好，陪你看叶子也听听风",
    lively: "后腿精神地撑好，想和你看看远处绿叶",
    gentle: "蹼足柔柔歇下来，安静陪你看看叶子",
    easygoing: "蹼足松松地放好，我们慢慢看叶子吧",
  },
  {
    balanced: "尾尖轻轻圈好，陪你看光也听听风",
    lively: "尾尖轻快地翘起来，想和你看看新风景",
    gentle: "小爪软软收在身前，安静陪你看一会儿光",
    easygoing: "尾尖随意卷一卷，我们慢慢待着就好",
  },
  {
    balanced: "双翼轻轻舒展开，陪你看云也看看星光",
    lively: "双翼精神地扬起来，想和你看看远方",
    gentle: "双翼柔柔拢在身侧，安静陪你看一会儿光",
    easygoing: "抱好小爪、放松双翼，我们慢慢待着就好",
  },
  {
    balanced: "前爪舒舒服服放好，陪你听风也看看光",
    lively: "尾巴轻快地摇摇，想和你听听新声音",
    gentle: "软耳轻轻垂在身侧，安静陪你听风",
    easygoing: "小爪随意搭在身前，我们慢慢待着就好",
  },
];

export function homeVoice(species: number, stage: GrowthStage | undefined, kind: string, form?: AdultForm | ""): string | null {
  if (!Number.isInteger(species) || species < 0 || !["baby", "growing", "adult"].includes(stage ?? "") ||
      (kind !== "content" && kind !== "quiet")) return null;
  if (stage === "adult" && kind === "content" &&
      (form === "balanced" || form === "lively" || form === "gentle" || form === "easygoing")) {
    return adultVoices[species]?.[form] ?? null;
  }
  return voices[species]?.[stage as LivingStage]?.[kind] ?? null;
}
