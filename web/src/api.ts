import type { Result } from "./types";

export async function request(path: string, body?: unknown): Promise<Result> {
  const response = await fetch(`/api/${path}`, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      throw new Error(data.error || "保存失败，请重试");
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new Error(text.trim() || "服务暂时无法连接");
      throw error;
    }
  }
  return response.json();
}
