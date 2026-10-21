import { games } from "./games";
import { treasureFound } from "./treasure";
import type { PetState } from "./types";

// Read only acknowledged progress, never future fish, souvenirs or hidden cells.
// This is not a reward estimate or a second copy of the game state.
export function abandonProgress(game: PetState["game"]) {
  if (!game) return null;
  let text: string;
  switch (game.kind) {
    case "tiles":
      if (!game.tiles) return null;
      text = `已配对 ${game.tiles.pairs} / 8 对`; break;
    case "snake":
      if (!game.snake) return null;
      text = `已吃 ${game.snake.eaten} / 8 颗果子`; break;
    case "tetris":
      if (!game.tetris) return null;
      text = `已消除 ${game.tetris.lines} / 8 行 · 放下 ${game.tetris.pieces} 块`; break;
    case "fishing":
      if (!game.fishing) return null;
      text = `已使用 ${game.fishing.casts} / 3 竿 · 钓到 ${game.fishing.catches?.length ?? 0} 条鱼`; break;
    case "walk":
      if (!game.walking) return null;
      text = `已走 ${game.walking.beat} / 72 步 · 已遇见 ${Math.floor(game.walking.beat / 24)} / 3 次发现`; break;
    case "treasure":
      if (!game.treasure) return null;
      text = `已探索 ${game.treasure.opened.length} / 6 格 · 实际找到 ${treasureFound(game.treasure)} / 3 件`; break;
    default:
      text = `已完成 ${game.round} / 5 轮 · 接住 ${game.score} 颗`;
  }
  return { title: games.find(info => info.id === (game.kind ?? "stars"))!.title, text };
}
