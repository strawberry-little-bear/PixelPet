import type { BackupPreview } from "./backup";
import type { PetState } from "./types";
import "./import-preview.css";

export type PendingImport = { fileName: string; backup?: BackupPreview; error?: string };
export function ImportPreview({ pending, pet, busy }: { pending: PendingImport; pet: PetState; busy: boolean }) {
  return <section className="import-preview" aria-label="备份导入确认" aria-busy={busy || (!pending.backup && !pending.error)}>
    <h3>先看看，再替换</h3>
    <p className="import-file">文件：{pending.fileName}</p>
    {pending.backup ? <>
      <dl>
        <div><dt>备份中的伙伴</dt><dd>{pending.backup.name} · {pending.backup.speciesName}</dd></div>
        <div><dt>文件记录的阶段</dt><dd>{pending.backup.stage}</dd></div>
        <div><dt>备份记录时间</dt><dd><time dateTime={new Date(pending.backup.lastTick).toISOString()}>{new Date(pending.backup.lastTick).toLocaleString("zh-CN", { hour12: false })}</time></dd></div>
      </dl>
      <p>将替换当前「{pet.name}」的全部存档，不会合并。建议先从存档盒导出当前存档。</p>
      <small>这里只预览文件内容，不代表已经通过校验。确认后由服务端校验、迁移与结算；离线最多结算 12 小时；未完成游戏会结束，不发完成奖励。</small>
      <strong role="status">{busy ? "正在导入，请稍候…" : "尚未导入 · B 确认替换，A / C 取消"}</strong>
    </> : pending.error ? <>
      <p role="alert">{pending.error}</p>
      <strong>没有发送导入请求，当前存档未被替换。</strong>
      <small>A / C 返回，再从存档盒选择文件。</small>
    </> : <>
      <p role="status">正在读取文件，尚未发送导入请求。</p>
      <small>A / C 取消 · B 暂不可用</small>
    </>}
  </section>;
}
