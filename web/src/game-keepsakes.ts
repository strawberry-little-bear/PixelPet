// Display metadata only. Ownership and dates come exclusively from saved memories.
export const gameKeepsakes = [
  { game: "stars", item: "star-ribbon", title: "接星星的小缎带", story: "一起收好星光后留下的小缎带。它不代表分数，只记得你们一起抬头、一起接住那一刻。", reply: "它抬头看了看小缎带：一起接过的星光，收在这条缎带里了。" },
  { game: "tiles", item: "tile-basket", title: "连连看的小篮子", story: "把图案一对对收好后留下的小篮子。以后还可以慢慢玩，完成一次就已经值得记下。", reply: "它轻轻碰了碰小篮子：一对对找出来的图案，也装着一起想办法的耐心。" },
  { game: "snake", item: "fruit-leaf", title: "果园里的叶子", story: "一起吃到三颗果子后留下的叶子。转过的弯、差一点撞上的墙，都变成了一起玩的记号。", reply: "它望着那片叶子：果园里一起转过的弯，想起来还是甜甜的。" },
  { game: "tetris", item: "block-garden", title: "积木花园的小方块", story: "一起消除两行积木后留下的小方块。每一块都不急，和小伙伴一起想办法就好。", reply: "它把小方块摆正：记得我们一起看落点，慢慢把积木花园拼起来。" },
  { game: "fishing", item: "pond-shell", title: "池塘边的小贝壳", story: "三竿结束、带着鱼获回家时收好的小贝壳。等待没有被浪费，岸边的安静也被好好收进来了。", reply: "它靠近小贝壳：岸边等浮漂的安静时光，也想和你再记起一次。" },
  { game: "walk", item: "path-button", title: "散步路上的小纽扣", story: "走完公园后收好的小纽扣。避开多少障碍都不是考试，走到终点就是一起走过的路。", reply: "它轻轻拨了拨小纽扣：一起走到终点的小路，不用走得很快也值得记住。" },
  { game: "treasure", item: "forest-token", title: "森林里的小木牌", story: "收好森林探索后留下的小木牌。不必找齐，愿意一起看看路边的小事，就已经很好。", reply: "它看了看小木牌：森林里一起翻找的小发现，不必找齐也很开心。" },
] as const;
export type GameKeepsakeItem = (typeof gameKeepsakes)[number]["item"];
export const gameKeepsake = (item: string | undefined) => gameKeepsakes.find(entry => entry.item === item);
