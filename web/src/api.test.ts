import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";

const result = { state: { revision: 2, lastTick: 123 }, serverTime: 123, message: "" };
afterEach(() => vi.unstubAllGlobals());
const respond = (response: Response) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

describe("save response classification", () => {
  it("uses one POST with a timeout and never retries a successful action", async () => {
    respond(new Response(JSON.stringify(result)));
    expect(await request("action", { kind: "feed" })).toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/action", expect.objectContaining({
      method: "POST", body: '{"kind":"feed"}', cache: "no-store", signal: expect.any(AbortSignal),
    }));
  });
  it.each([400, 403, 409, 413, 429])("recognizes HTTP %s as explicit rejection, not a saved action", async status => {
    respond(new Response('{"error":"金币还不够"}', { status }));
    await expect(request("action", { kind: "buy" })).rejects.toMatchObject({ outcome: "rejected", message: "金币还不够" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([408, 500, 502, 503])("does not assert a write failed to commit after HTTP %s", async status => {
    respond(new Response("connection unavailable", { status }));
    await expect(request("action", { kind: "feed" })).rejects.toMatchObject({ outcome: "unknown" });
  });
  it.each([new TypeError("Failed to fetch"), new DOMException("timeout", "TimeoutError")])("keeps network/timeout write outcomes unknown", async error => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(request("action", { kind: "feed" })).rejects.toBeInstanceOf(RequestFailure);
    await expect(request("action", { kind: "feed" })).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetch).toHaveBeenCalledTimes(2); // one request per call, no retry
  });
  it.each(["<html>proxy error</html>", "{}", '{"state":{"revision":2},"serverTime":123}',
    '{"state":{"revision":-1,"lastTick":123},"serverTime":123}'])
  ("does not announce a save after a malformed success response: %s", async body => {
    respond(new Response(body));
    await expect(request("action", { kind: "feed" })).rejects.toMatchObject({ outcome: "unknown" });
  });
  it("treats an interrupted success body as unknown, not rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new TypeError("body interrupted"); } }));
    await expect(request("action", { kind: "feed" })).rejects.toMatchObject({ outcome: "unknown" });
  });
  it("uses a GET for reconciliation and distinguishes a read failure", async () => {
    respond(new Response("unavailable", { status: 503 }));
    await expect(request("state")).rejects.toMatchObject({ outcome: "unavailable" });
    expect(fetch).toHaveBeenCalledWith("/api/state", expect.not.objectContaining({ method: "POST" }));
  });
  it("does not send a nonserializable request", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const body: Record<string, unknown> = {}; body.self = body;
    await expect(request("action", body)).rejects.toMatchObject({ outcome: "rejected" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("explicit save-corruption diagnosis", () => {
  it.each(["state", "visit"])("retains the code from a typed 409 for %s", async path => {
    respond(new Response('{"error":"存档校验失败","code":"save_corrupt"}', { status: 409 }));
    await expect(request(path, path === "visit" ? {} : undefined)).rejects.toMatchObject({ code: "save_corrupt" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([400, 500, 503])("does not enable repair from an error code with HTTP %s", async status => {
    respond(new Response('{"error":"服务异常","code":"save_corrupt"}', { status }));
    await expect(request("state")).rejects.toMatchObject({ outcome: "unavailable", code: undefined });
  });
  it("does not infer a repair diagnosis from error text or an unknown code", async () => {
    respond(new Response('{"error":"现有存档校验失败","code":"something_else"}', { status: 409 }));
    await expect(request("state")).rejects.toMatchObject({ code: undefined });
  });
});

describe("explicit clock diagnosis", () => {
  it.each(["state", "action"]) ("retains only a typed 409 for %s", async path => {
    respond(new Response('{"error":"请校准服务电脑时间","code":"clock_ahead"}', { status: 409 }));
    await expect(request(path, path === "action" ? { kind: "feed" } : undefined)).rejects.toMatchObject({
      code: "clock_ahead", outcome: path === "action" ? "rejected" : "unavailable",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([400, 500, 503]) ("ignores clock code on HTTP %s", async status => {
    respond(new Response('{"error":"clock_ahead","code":"clock_ahead"}', { status }));
    await expect(request("state")).rejects.toMatchObject({ code: undefined });
  });
  it("does not infer clock state from error wording", async () => {
    respond(new Response('{"error":"服务时间早于存档时间"}', { status: 409 }));
    await expect(request("state")).rejects.toMatchObject({ code: undefined });
  });
});
