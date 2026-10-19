import { validGrowthBasis } from "./growth";
import type { CareRules, Growth } from "./types";

// Shared by the read-only menu preview and the confirmed bedtime message.
// Missing response metadata is not a license to substitute client defaults.
export function sleepGrowthGuidance(growth: Pick<Growth, "stage"> | null | undefined, rules?: CareRules | null): string {
  if (!growth || growth.stage === "egg") return "成长记录尚未读到；只按实际恢复量记录休息，结果以服务端为准。";
  const basis = rules?.growth;
  if (!validGrowthBasis(basis)) return `成长基准尚未读到；休息习惯按实际恢复量记录，数字以服务端为准。${growth.stage === "adult" ? "成年形态不变。" : ""}`;
  return growth.stage === "adult"
    ? `每恢复 ${basis.restEnergyPerHabit} 体力，休息习惯 +1；成年形态不变。`
    : `每恢复 ${basis.restEnergyPerHabit} 体力，休息习惯 +1、成长 +${basis.restPointsPerHabit}；按实际恢复比例记录。`;
}
