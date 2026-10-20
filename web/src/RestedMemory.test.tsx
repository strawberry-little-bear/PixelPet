import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AlbumPanel, albumMemories, memoryWords } from "./AlbumPanel";
import { validCoreResponse } from "./response";
import type { PetState } from "./types";
const now = Date.UTC(2026, 9, 21);
const pet = (): PetState => ({ schema: 18, revision: 1, species: 2, name: "好梦伙伴", createdAt: now, hatchedAt: now,
  lastTick: now, needs: { hunger: 80, mood: 80, clean: 80, energy: 100 }, sleeping: false, careCount: 0, logs: [],
  album: { since: now, legacy: false, entries: [{ kind: "hatch", at: now, source: "shared" }, { kind: "rested", at: now, source: "shared" }] } });
afterEach(cleanup);
it.each([false, true])("renders a factual rested card in daily care, including legacy albums (%s)", legacy => {
  const p = pet(); p.album!.legacy = legacy;
  const before = structuredClone(p);
  expect(albumMemories(p, "care").map(m => m.kind)).toEqual(["rested"]);
  render(<AlbumPanel pet={p} now={now} page={1} category="care" />);
  expect(screen.getByText("睡饱后的小小伸展")).toBeTruthy();
  expect(screen.getByText(/真正恢复了体力/)).toBeTruthy();
  expect(screen.getByText(/不用每次都等到满格/)).toBeTruthy();
  expect(screen.getByText(/来自已保存的真实经历/)).toBeTruthy();
  expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
  expect(document.querySelector(".album-panel")!.textContent).not.toMatch(/解锁|领取|签到|奖励|第一次/);
  expect(p).toEqual(before);
});
it("accepts the new display-safe record without modifying history", () => {
  const reply = { state: pet(), serverTime: now, message: "" }, before = structuredClone(reply);
  expect(validCoreResponse(reply)).toBe(true);
  expect(reply).toEqual(before);
});
it.each([undefined, 17])("never fabricates a card from full energy or an older schema (%s)", schema => {
  const p = pet(); if (schema) p.schema = schema;
  p.album!.entries = p.album!.entries.filter(m => m.kind !== "rested");
  expect(albumMemories(p, "care")).toEqual([]);
  render(<AlbumPanel pet={p} now={now} page={1} category="care" />);
  expect(screen.queryByText("睡饱后的小小伸展")).toBeNull();
  expect(screen.getByText(/这里还没有留下回忆/)).toBeTruthy();
});
it.each([false, true])("does not claim an unrecorded first-ever wake (%s)", legacy => {
  const words = memoryWords({ kind: "rested", at: now, source: "shared" }, legacy);
  expect(words.story).not.toMatch(/第一次|首个|开启前/);
});
it("keeps a historical rested card after energy has fallen again", () => {
  const p = pet(); p.needs.energy = 10;
  expect(albumMemories(p, "care")).toHaveLength(1);
  render(<AlbumPanel pet={p} now={now} page={1} category="care" />);
  expect(screen.getByText("睡饱后的小小伸展")).toBeTruthy();
});
