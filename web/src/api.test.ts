import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";

const result = {
  state: {
    schema: 1, revision: 2, species: 2, name: "草莓兔", createdAt: 100,
    hatchedAt: 110, lastTick: 123, sleeping: false,
    needs: { hunger: 60, mood: 70, clean: 80, energy: 90 }, careCount: 0,
    logs: [{ at: 110, text: "初次见面" }],
  },
  serverTime: 123, message: "",
};
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

describe("save generation preconditions", () => {
  const generation = "a".repeat(32);
  it.each(["action", "import", "reset", "recap/read"])("scopes %s intent with a header without changing its portable body", async path => {
    respond(new Response(JSON.stringify({ ...result, saveGeneration: generation })));
    await request(path, { kind: "feed" }, generation);
    expect(fetch).toHaveBeenCalledWith(`/api/${path}`, expect.objectContaining({
      method: "POST", body: '{"kind":"feed"}', headers: { "Content-Type": "application/json", "X-PixelPet-Generation": generation },
    }));
  });
  it("classifies the typed generation conflict as a known rejection, with no retry", async () => {
    respond(new Response(JSON.stringify({ error: "存档已替换", code: "save_changed", saveGeneration: generation }), { status: 409 }));
    await expect(request("action", { kind: "feed" }, "b".repeat(32))).rejects.toMatchObject({ outcome: "rejected", code: "save_changed", saveGeneration: generation });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([400, 500, 503])("does not trust generation diagnosis on status %s", async status => {
    respond(new Response(JSON.stringify({ code: "save_changed", saveGeneration: generation }), { status }));
    await expect(request("state")).rejects.toMatchObject({ code: undefined, saveGeneration: undefined });
  });
  it.each(["short", "A".repeat(32), null, 42])("does not treat an invalid token as a successful current save: %s", async saveGeneration => {
    respond(new Response(JSON.stringify({ ...result, saveGeneration })));
    await expect(request("action", { kind: "feed" })).rejects.toMatchObject({ outcome: "unknown" });
  });
  it("retains corrupt-repair metadata from a typed diagnosis", async () => {
    respond(new Response(JSON.stringify({ error: "坏档", code: "save_corrupt", saveGeneration: generation }), { status: 409 }));
    await expect(request("state")).rejects.toMatchObject({ code: "save_corrupt", saveGeneration: generation });
  });
});

describe("unfinished-game cancellation conflict", () => {
  it("combines both preconditions without changing portable action JSON", async () => {
    const generation = "a".repeat(32);
    const action = { kind: "cancel-play", gameId: "session", requestId: "discard" };
    respond(new Response(JSON.stringify(result)));
    await request("action", action, generation);
    expect(fetch).toHaveBeenCalledWith("/api/action", expect.objectContaining({
      body: JSON.stringify(action), headers: { "Content-Type": "application/json", "X-PixelPet-Generation": generation, "X-PixelPet-Cancel-If": "unfinished" },
    }));
  });
  it.each(["snake-finish", "play-snake", "feed"])("does not guard an unrelated %s action", async kind => {
    respond(new Response(JSON.stringify(result)));
    await request("action", { kind });
    expect(fetch).toHaveBeenCalledWith("/api/action", expect.objectContaining({ headers: { "Content-Type": "application/json" } }));
  });
  it("preserves a typed 409 as a known refusal and never retries", async () => {
    respond(new Response(JSON.stringify({ error: "本局已经结束", code: "game_finished", saveGeneration: "a".repeat(32) }), { status: 409 }));
    await expect(request("action", { kind: "cancel-play", gameId: "b".repeat(32) })).rejects.toMatchObject({ code: "game_finished", outcome: "rejected" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/action", expect.objectContaining({ body: JSON.stringify({ kind: "cancel-play", gameId: "b".repeat(32) }), headers: { "Content-Type": "application/json", "X-PixelPet-Cancel-If": "unfinished" } }));
  });
  it.each([400, 500, 503])("does not trust a game-finished diagnosis on HTTP %s", async status => {
    respond(new Response('{"error":"本局已经结束","code":"game_finished"}', { status }));
    await expect(request("action", { kind: "cancel-play" })).rejects.toMatchObject({ code: undefined, outcome: status === 400 ? "rejected" : "unknown" });
  });
  it("does not infer a typed conflict from error text", async () => {
    respond(new Response('{"error":"本局已经结束"}', { status: 409 }));
    await expect(request("action", { kind: "cancel-play" })).rejects.toMatchObject({ code: undefined, outcome: "rejected" });
  });
});

describe("sleep-state transport precondition", () => {
 it.each([false,true])("sends %s with the save guard without changing action JSON", async expectedSleeping => {
  const action={kind:"sleep",requestId:"bedtime"},generation="a".repeat(32);
  respond(new Response(JSON.stringify(result)));await request("action",action,generation,expectedSleeping);
  expect(fetch).toHaveBeenCalledWith("/api/action",expect.objectContaining({body:JSON.stringify(action),headers:{"Content-Type":"application/json","X-PixelPet-Generation":generation,"X-PixelPet-Sleep-If":expectedSleeping?"sleeping":"awake"}}));
 });
 it("keeps unguarded legacy callers unchanged", async () => {
  respond(new Response(JSON.stringify(result)));await request("action",{kind:"sleep"});
  const headers=(vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers;
  expect(headers).not.toHaveProperty("X-PixelPet-Sleep-If");
 });
 it("classifies a sleep conflict as known refusal, without retry", async () => {
  respond(new Response(JSON.stringify({code:"sleep_changed",error:"changed"}),{status:409}));
  await expect(request("action",{kind:"sleep"},undefined,false)).rejects.toMatchObject({outcome:"rejected",code:"sleep_changed"});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([400,500,503])("does not trust sleep conflict diagnosis on HTTP %s", async status => {
  respond(new Response(JSON.stringify({code:"sleep_changed",error:"changed"}),{status}));
  await expect(request("action",{kind:"sleep"},undefined,false)).rejects.toMatchObject({code:undefined,outcome:status===400?"rejected":"unknown"});
 });
});

// A plausible revision/time envelope alone does not make a pet safe to render.
describe("required pet response fields", () => {
  const invalidFields: [string, unknown][] = [
    ["needs", undefined], ["needs", null], ["needs", []],
    ["needs", { hunger: 60, mood: 70, clean: 80 }],
    ...["hunger", "mood", "clean", "energy"].flatMap(key =>
      [null, "60", -1, 101].map(value => ["needs", { ...result.state.needs, [key]: value }] as [string, unknown])),
    ["logs", {}],
    ["logs", [null]], ["logs", [{ at: 123 }]],
    ["logs", [{ at: "123", text: "hello" }]], ["logs", [{ at: 123, text: {} }]],
    ["name", null], ["name", {}], ["species", "2"], ["species", -1], ["species", 0.5],
    ["sleeping", "false"], ["sleeping", null], ["careCount", -1], ["careCount", "0"],
    ["schema", 0], ["schema", "1"], ["createdAt", -1], ["hatchedAt", null],
    ["lastTick", -1], ["lastTick", 0.5], ["lastTick", 8640000000000001],
  ];
  it.each(invalidFields)("rejects malformed %s=%j on writes without retry", async (field, value) => {
    respond(new Response(JSON.stringify({ ...result, state: { ...result.state, [field]: value } })));
    await expect(request("action", { kind: "feed" })).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["state", "visit"])("keeps an incomplete %s response out of the renderer", async path => {
    respond(new Response(JSON.stringify({ state: { revision: 2, lastTick: 123 }, serverTime: 123, message: "" })));
    await expect(request(path, path === "visit" ? {} : undefined)).rejects.toMatchObject({ outcome: path === "visit" ? "unknown" : "unavailable" });
  });
  it.each([null, {}, 42])("rejects a non-text success message %j", async message => {
    respond(new Response(JSON.stringify({ ...result, message })));
    await expect(request("action", { kind: "feed" })).rejects.toMatchObject({ outcome: "unknown" });
  });
  it("accepts core legacy data without optional modern fields or rewriting it", async () => {
    respond(new Response(JSON.stringify(result)));
    expect(await request("state")).toEqual(result);
  });
  it.each([null, undefined])("preserves a legacy empty log slice %j without inventing entries", async logs => {
    const legacy = { ...result, state: { ...result.state, logs } };
    respond(new Response(JSON.stringify(legacy)));
    expect(await request("state")).toEqual(JSON.parse(JSON.stringify(legacy)));
  });
  it("preserves future fields and zero-valued egg data", async () => {
    const egg = { ...result, futureMetadata: { retained: true }, state: { ...result.state, hatchedAt: 0, needs: { hunger: 0, mood: 100, clean: 0, energy: 100 }, logs: [], futurePetData: "keep" } };
    respond(new Response(JSON.stringify(egg)));
    expect(await request("state")).toEqual(egg);
  });
});
