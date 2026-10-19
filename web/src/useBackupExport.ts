import { useEffect, useRef, useState } from 'react';
import { backupSizeLimit, previewBackup } from './backup';

async function readBackup(signal: AbortSignal): Promise<Blob> {
  const response = await fetch('/api/backup', { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      if (typeof body?.error === 'string' && body.error.trim().length <= 240) detail = body.error.trim();
    } catch { /* A proxy error page is not a portable backup or a user-facing error message. */ }
    throw new Error(detail || `服务返回 ${response.status}，请检查小窝服务后重试。`);
  }
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new Error('服务没有返回 JSON 存档，请检查小窝服务后重试。');
  }
  const blob = await response.blob();
  if (!blob.size || blob.size > backupSizeLimit) throw new Error('备份内容为空或超过 64 KiB，未生成下载文件。');
  // Reuse the import envelope check, not a new, competing schema validator.
  // Download the original bytes, preserving fields and server formatting.
  previewBackup(await blob.text());
  return blob;
}

export function useBackupExport(enabled: boolean) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const flight = useRef<AbortController | null>(null);
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => {
    flight.current?.abort(); flight.current = null;
    for (const [url, timer] of urls.current) { clearTimeout(timer); URL.revokeObjectURL(url); }
    urls.current.clear();
  }, []);
  useEffect(() => {
    if (enabled) return;
    flight.current?.abort(); flight.current = null;
    setPending(false); setFeedback(null);
  }, [enabled]);

  async function download() {
    if (!enabled || flight.current) return;
    const controller = new AbortController(); flight.current = controller;
    setPending(true); setFeedback(null);
    const timer = setTimeout(() => {
      if (flight.current !== controller) return;
      controller.abort(); flight.current = null; setPending(false);
      setFeedback({ error: true, text: '导出失败：等待服务超时，请检查连接后重试。本次未生成下载文件。' });
    }, 10000);
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    try {
      const blob = await readBackup(controller.signal);
      if (flight.current !== controller || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      // A short grace period lets the browser consume the download before revocation.
      urls.current.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 60000));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'pixelpet-backup.json'; anchor.hidden = true;
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); }
      setFeedback({ error: false, text: '备份已交给浏览器下载，请确认文件已保存，再继续后续操作。' });
    } catch (error) {
      if (flight.current === controller && !controller.signal.aborted) setFeedback({ error: true,
        text: `导出失败：${error instanceof Error && !(error instanceof TypeError) ? error.message : '暂时无法连接小窝服务，请稍后重试。'} 本次未完成下载。` });
    } finally {
      clearTimeout(timer);
      if (flight.current === controller) { flight.current = null; setPending(false); }
    }
  }
  return { pending, feedback, download };
}
