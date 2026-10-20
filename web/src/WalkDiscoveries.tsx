import { CareReadingRegion } from "./CareReadingRegion";
import { parkCatalog } from "./walk";
import type { Walking } from "./types";

/** Read only the acknowledged route. Never reveal the remaining souvenirs,
 * infer first-ever finds from the album, or reconstruct a past completed walk. */
export function WalkDiscoveries({ walking }: { walking: Walking }) {
  const count = Math.floor(walking.beat / 24);
  return <CareReadingRegion className="walk-discoveries" label="本次沿途发现"
    hint="Tab 聚焦：↑/↓ 或空格滚动；Enter 不操作，A/B/C 不变。">
    <h3>本次沿途发现</h3>
    {count === 0 ? <p>还没走到发现点。每走过 24 步，才会留下这次遇见的小东西。</p> : <ol>
      {Array.from({ length: count }, (_, index) => {
        const item = parkCatalog.find(item => item.id === walking.souvenirs[index]);
        return <li key={index}>
          <span>第 {(index + 1) * 24} 步</span>
          <strong>{item?.name ?? "发现详情尚未读到"}</strong>
          {item && <p>{item.story}</p>}
        </li>;
      })}
    </ol>}
    <p className="walk-discoveries-note">{count > 0 ? "发现已经保存，放弃也保留；" : "实际走到发现点才保存发现；"}陪伴与金币仍需走完并收好，按原条件结算。</p>
  </CareReadingRegion>;
}
