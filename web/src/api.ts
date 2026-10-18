import type { Result } from "./types";
import { RequestFailure } from "./requestFailure";

export async function request(path: string, body?: unknown): Promise<Result> {
  const writing = body !== undefined;
  let encoded: string | undefined;
  try {
    if (writing) encoded = JSON.stringify(body);
  } catch {
    throw new RequestFailure("操作内容无效，还没有发送到小窝。", "rejected");
  }
  try {
    const response = await fetch(`/api/${path}`, {
      cache: "no-store",
      ...(writing
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: encoded }
        : {}),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = text.trim() || "服务暂时无法连接";
      let code: "save_corrupt" | "clock_ahead" | undefined;
      try {
        const data = JSON.parse(text);
        if (response.status === 409 && (data?.code === "save_corrupt" || data?.code === "clock_ahead")) code = data.code;
        if (typeof data?.error === "string" && data.error.trim()) message = data.error;
      } catch { /* Non-JSON error responses are still not successful saves. */ }
      const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
      throw new RequestFailure(message, writing ? (rejected ? "rejected" : "unknown") : "unavailable", code);
    }
    const result = await response.json();
    // Do not announce a saved game after an HTML/proxy/invalid JSON response.
    if (!result?.state || !Number.isSafeInteger(result.state.revision) || result.state.revision < 0 ||
        !Number.isFinite(result.state.lastTick) || !Number.isFinite(result.serverTime)) {
      throw new Error("Invalid save response");
    }
    return result;
  } catch (error) {
    if (error instanceof RequestFailure) throw error;
    throw new RequestFailure(
      writing ? "这次操作的结果还未确认，可能已经保存。" : "暂时无法读取小窝存档。",
      writing ? "unknown" : "unavailable",
    );
  }
}
