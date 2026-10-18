import { stageNames } from "./growth";
import { species } from "./types";
import type { GrowthStage } from "./types";

export const backupSizeLimit = 64 * 1024;
export type BackupPreview = {
  data: Record<string, unknown>;
  name: string;
  speciesName: string;
  stage: string;
  lastTick: number;
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;

// This is a safe summary, NOT a duplicate of the authoritative server validator.
// Keep the original object (including unknown fields) for the server to validate.
export function previewBackup(text: string): BackupPreview {
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { throw new Error("文件不是有效的 JSON 备份。"); }
  if (!record(data) || !Number.isSafeInteger(data.schema) || Number(data.schema) < 1 ||
      !Number.isSafeInteger(data.species) || Number(data.species) < 0 || Number(data.species) >= species.length ||
      typeof data.name !== "string" || !data.name.trim() ||
      !timestamp(data.lastTick) || !timestamp(data.hatchedAt)) {
    throw new Error("无法识别这份备份，请选择 PixelPet 导出的 JSON 存档。");
  }
  const stage = record(data.growth) && typeof data.growth.stage === "string" &&
    Object.hasOwn(stageNames, data.growth.stage) ? stageNames[data.growth.stage as GrowthStage] : "由服务端校验与迁移";
  return {
    data,
    name: data.name,
    speciesName: species[Number(data.species)],
    stage: data.hatchedAt === 0 ? stageNames.egg : stage,
    lastTick: data.lastTick,
  };
}
