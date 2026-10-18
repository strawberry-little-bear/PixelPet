import { describe, expect, it } from "vitest";
import { previewBackup } from "./backup";
import { stageNames } from "./growth";
const data = () => ({ schema:1, revision:0, name:"小草莓", species:2, hatchedAt:1000, lastTick:2000 });
describe("backup preview envelope (not full server validation)", () => {
  it("keeps the whole original backup, including unknown fields, for authoritative validation", () => {
    const backup = {...data(), extra: { invalidForServer: true }};
    const before=JSON.stringify(backup),preview=previewBackup(before);
    expect(preview.data).toEqual(backup);
    expect(preview.name).toBe("小草莓");expect(preview.speciesName).toBe("草莓兔");
    expect(preview.stage).toContain("迁移");expect(preview.lastTick).toBe(2000);
    expect(JSON.stringify(backup)).toBe(before);
  });
  it.each(Object.entries(stageNames))("reads stage %s without recalculating growth", (stage,label) => {
    expect(previewBackup(JSON.stringify({...data(),hatchedAt:stage==="egg"?0:1000,growth:{stage}})).stage).toBe(label);
  });
  it("does not treat object prototype properties as growth labels", () => {
    expect(previewBackup(JSON.stringify({...data(),growth:{stage:"constructor"}})).stage).toContain("校验");
  });
  it("treats a zero hatch time as an egg without inventing an adult", () => {
    expect(previewBackup(JSON.stringify({...data(),hatchedAt:0,growth:{stage:"adult"}})).stage).toBe("等待孵化");
  });
  it.each(["", "{", "{}{}"])("rejects invalid JSON %j", text => expect(()=>previewBackup(text)).toThrow(/有效的 JSON/));
  it.each([null,[],"hello",42,{}, {...data(),species:-1},{...data(),species:10},{...data(),schema:0},{...data(),schema:1.5},{...data(),name:""},{...data(),lastTick:"2000"},{...data(),lastTick:1e20},{...data(),hatchedAt:-1},{...data(),species:"2"}])("rejects unsafe summary input %j", value => {
    expect(()=>previewBackup(JSON.stringify(value))).toThrow(/无法识别/);
  });
  it("leaves future schemas and invalid growth internals to the server rather than losing fields", () => {
    const body={...data(),schema:999,growth:{stage:"future",points:-1}};
    expect(previewBackup(JSON.stringify(body)).data).toEqual(body);
  });
});
