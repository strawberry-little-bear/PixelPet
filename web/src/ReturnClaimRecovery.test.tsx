import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { emptyGrowth } from "./growth";
import type { Result, ReturnRecap } from "./types";

async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
for (const committed of [false, true]) {
  it.each(["date", "needs", "reversed"])(`reconciles an invalid %s in a recap claim without reclaiming it (committed=${committed})`, async field => {
    vi.useFakeTimers(); localStorage.clear(); const now = Date.now();
    const needs = { hunger: 50, mood: 70, clean: 60, energy: 80 };
    const snapshot = { needs, stage: "baby" as const, form: "" as const, points: 1, rest: 0, trackedHours: 1 };
    const recap: ReturnRecap = { id: "saved-return", from: now - 1800000, to: now, before: snapshot, after: snapshot };
    let pending = true, badRead = true; const calls: string[] = [];
    const reply = (): Result => ({ state: { schema: 12, revision: 1, species: 2, name: "回访核对", createdAt: now - 3600000,
      hatchedAt: now - 3600000, lastTick: now, needs, sleeping: false, careCount: 0, growth: emptyGrowth(), logs: [] },
      message: "", serverTime: now, returnRecap: structuredClone(recap), recapPending: pending });
    const damage = (r: Result) => field === "date" ? { ...r, returnRecap: { ...r.returnRecap, from: 8640000000000001 } }
      : field === "reversed" ? { ...r, returnRecap: { ...r.returnRecap, from: recap.to + 1 } }
      : { ...r, returnRecap: { ...r.returnRecap, after: { ...snapshot, needs: null } } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = url.replace("/api/", ""); calls.push(path);
      if (path === "recap/read") {
        if (committed) pending = false;
        return new Response(JSON.stringify(damage({ ...reply(), recapClaimed: committed })));
      }
      return new Response(JSON.stringify(path === "state" && badRead ? damage(reply()) : reply()));
    }));
    await act(async () => { render(<App />); });
    expect(calls).toEqual(["visit", "recap/read"]);
    expect(document.querySelector(".save-recovery")).not.toBeNull();
    expect(document.querySelector(".return-panel")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("可能已经保存");
    await key("a"); await key("c"); expect(calls).toHaveLength(2);
    await key("b"); expect(calls.at(-1)).toBe("state");
    expect(document.querySelector(".save-recovery")).not.toBeNull();
    badRead = false; await key("b");
    expect(document.querySelector(".save-recovery,.return-panel")).toBeNull();
    expect(document.querySelector(".pet-scene")?.getAttribute("data-motion")).toBe("idle");
    expect(calls.filter(path => path === "recap/read")).toHaveLength(1);
    expect(calls.filter(path => ["action", "import", "reset"].includes(path))).toHaveLength(0);
    expect(pending).toBe(!committed);
    // Manual history remains readable; looking at it does not re-claim/reward it.
    await key("a"); for (let i = 0; i < 7; i++) await key("a"); await key("b");
    expect(document.querySelector(".return-panel")).not.toBeNull();
    await key("a"); expect(document.querySelector(".return-panel header span")?.textContent).toBe("2 / 2");
    expect(calls.filter(path => path === "recap/read")).toHaveLength(1);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
  });
}
