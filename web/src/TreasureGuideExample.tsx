import { treasureClue } from "./treasure";

// Fictional complete maps: exactly one of each object, with an empty clue cell.
// Never take a live session here: the lesson must not reveal hidden objects.
const examples = [
  { title: "中央空地示例", source: 4, layout: [1, 0, 2, 0, 0, 0, 0, 0, 3],
    text: "中央数周围八格，包含斜角：三件都计入。" },
  { title: "角落空地示例", source: 0, layout: [0, 0, 0, 0, 1, 2, 0, 0, 3],
    text: "角落只数相邻三格，斜角也算；范围外两件不计入。" },
];

export function TreasureGuideExample() {
  return <div className="treasure-guide-example" aria-label="森林寻宝数字线索示例">
    <strong>数字线索示例</strong>
    <small>示意图，不是本局地图</small>
    <small>◆ 小物 · 数字是已探索空地 · 虚线框是计数范围</small>
    <div className="treasure-example-pair">
      {examples.map(example => {
        const clue = treasureClue({ layout: example.layout, opened: [example.source], step: 1, paused: true })!;
        return <figure key={example.source}>
          <div className="treasure-example-grid" role="img"
            aria-label={`${example.title}：数字 ${clue.nearby}，范围内 ${clue.nearby} 件。${example.text}`}>
            {example.layout.map((item, index) => <span key={index} aria-hidden="true"
              data-source={index === example.source} data-neighbor={clue.neighbors.includes(index)} data-object={item > 0}>
              {index === example.source ? clue.nearby : item ? "◆" : "·"}
            </span>)}
          </div>
          <figcaption>{example.text}</figcaption>
        </figure>;
      })}
    </div>
  </div>;
}
