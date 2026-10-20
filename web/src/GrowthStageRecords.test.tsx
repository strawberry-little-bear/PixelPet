import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GrowthPanel } from "./GrowthPanel";
import { emptyGrowth, stageNames } from "./growth";
import type { GrowthStage, PetState } from "./types";

const at = Date.parse("2026-10-20T06:00:00Z"), hour = 3600000;
const stages = ["baby", "growing", "adult"] as const;
const names = { baby: "孵化", growing: "进入成长期", adult: "成年定型" };
const kind = { baby: "hatch", growing: "growing", adult: "adult" } as const;
function state(stage: GrowthStage = "adult"): PetState {
  const g = emptyGrowth(stage);
  Object.assign(g, { points: stage === "adult" ? 72 : stage === "growing" ? 40 : 8,
    growingAt: ["growing", "adult"].includes(stage) ? at - 60 * hour : 0,
    adultAt: stage === "adult" ? at - hour : 0, form: stage === "adult" ? "gentle" : "" });
  const pet: PetState = {schema:17,revision:10,species:2,name:"成长足迹",createdAt:at-100*hour,
    hatchedAt:stage==="egg"?0:at-99*hour,lastTick:at,sleeping:false,
    needs:{hunger:60,mood:80,clean:60,energy:40},careCount:0,growth:g,logs:[],
    album:{since:at-99*hour,legacy:false,entries:[]}};
  for (const s of stages) {
    const stamp = s==="baby"?pet.hatchedAt:s==="growing"?g.growingAt:g.adultAt;
    if (stamp) pet.album!.entries.push({kind:kind[s],at:stamp,source:"shared",...(s==="adult"?{form:"gentle" as const}:{})});
  }
  return pet;
}
function show(pet: PetState, page = 5) {
  return render(<GrowthPanel growth={pet.growth ?? {...emptyGrowth("adult"),points:72,form:"balanced"}} pet={pet} index={pet.species} page={page} />);
}
function record(stage: typeof stages[number]) { return screen.getByRole("group", {name:`${stageNames[stage]}时间`}); }
afterEach(cleanup);

it.each(stages)("shows the accepted %s timestamp beside the existing species pose, not a browser date", stage => {
  const pet = state(), before = structuredClone(pet); show(pet);
  const item = record(stage), stamp = stage==="baby"?pet.hatchedAt:stage==="growing"?pet.growth!.growingAt:pet.growth!.adultAt;
  expect(item.textContent).toContain(names[stage]); expect(item.textContent).toContain("成长经历记录");
  expect(item.querySelector("time")?.dateTime).toBe(new Date(stamp).toISOString());
  expect(item.querySelector("time")?.textContent).toBe(new Date(stamp).toLocaleString("zh-CN", {
    year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,
  }));
  expect(item.closest("[data-look-stage]")?.getAttribute("data-look-stage")).toBe(stage);
  expect(pet).toEqual(before); expect(document.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
  expect(document.querySelectorAll("[tabindex='0']")).toHaveLength(1);
  expect(document.querySelector(".growth-page-dots")?.textContent).toBe("6 / 6");
});
it.each(["baby", "growing", "adult"] as const)("a %s save never schedules a future stage or claims all stages completed", stage => {
  show(state(stage)); const reached = stages.indexOf(stage);
  for (const [i,s] of stages.entries()) {
    expect(record(s).querySelectorAll("time")).toHaveLength(i<=reached?1:0);
    if (i>reached) expect(record(s).textContent).toContain(`尚未${names[s]}`);
  }
  expect(screen.getByText(/不预测未来阶段/)).toBeTruthy();
});
it("an egg has no invented hatch time or claim of having grown", () => {
  show(state("egg")); expect(record("baby").textContent).toContain("等待孵化");
  expect(document.querySelectorAll(".growth-stage-record time")).toHaveLength(0);
});
it.each(stages)("labels saved %s history as legacy without changing the date", stage => {
  const pet = state(); pet.album!.legacy = true; pet.album!.entries.forEach(m => {m.source="saved";}); show(pet);
  expect(record(stage).textContent).toContain("旧档记录"); expect(record(stage).textContent).not.toContain("成长经历记录");
  expect(record(stage).querySelector("time")).toBeTruthy();
  expect(screen.getByText(/旧档迁移日期不代表实际长大时刻/)).toBeTruthy();
});
it.each([undefined, {since:at,legacy:true,entries:[]}])("keeps dates but leaves provenance unknown when matching memories are absent: %j", album => {
  const pet = state(); pet.album = album; show(pet);
  for (const stage of stages) { expect(record(stage).textContent).toContain("存档记录（来源未注明）"); expect(record(stage).querySelector("time")).toBeTruthy(); }
});
it.each(["time", "source", "form"])("does not borrow a mismatched adult memory's %s provenance", mismatch => {
  const pet = state(), memory = pet.album!.entries.find(m => m.kind==="adult")!;
  if (mismatch==="time") memory.at--; else if (mismatch==="source") memory.source="elapsed"; else memory.form="lively";
  show(pet); expect(record("adult").textContent).toContain("存档记录（来源未注明）");
  expect(record("adult").querySelector("time")?.dateTime).toBe(new Date(pet.growth!.adultAt).toISOString());
});
it.each([0, NaN, -1, Infinity, 8640000000000001])("does not replace missing/unsafe reached-stage timestamps %s with now or album history", stamp => {
  const pet = state(); pet.growth!.growingAt = stamp; pet.growth!.adultAt = stamp; show(pet);
  for (const stage of ["growing","adult"] as const) {
    expect(record(stage).textContent).toContain("这一阶段的时间未记录"); expect(record(stage).querySelector("time")).toBeNull();
  }
});
it("does not promote the legacy age-based preview into dated stage history", () => {
  const pet = state(); delete pet.growth; show(pet);
  expect(record("baby").querySelector("time")).toBeTruthy();
  for (const stage of ["growing","adult"] as const) {
    expect(record(stage).textContent).toContain("成长记录尚未读到"); expect(record(stage).querySelector("time")).toBeNull();
  }
});
it("updates only from accepted snapshot props, and does not retain replaced-save dates", () => {
  const old = state(), {rerender} = show(old), text = record("adult").textContent;
  rerender(<GrowthPanel growth={old.growth!} pet={old} index={2} page={5}/>); expect(record("adult").textContent).toBe(text);
  const next = state("baby"); next.hatchedAt += hour; next.album!.entries=[];
  rerender(<GrowthPanel growth={next.growth!} pet={next} index={2} page={5}/>);
  expect(record("adult").querySelector("time")).toBeNull();
  expect(record("baby").querySelector("time")?.dateTime).toBe(new Date(next.hatchedAt).toISOString());
});
it("does not add date panels to other pages or when no pet snapshot was provided", () => {
  const pet = state(), {rerender} = show(pet,0); expect(screen.queryByRole("group",{name:"成年期时间"})).toBeNull();
  rerender(<GrowthPanel growth={pet.growth!} index={2} page={5}/>); expect(screen.queryByRole("group",{name:"成年期时间"})).toBeNull();
});
