import { GrowthOutfit, FormEmblem } from "./GrowthOutfit";
import { PetArt, petRigClass } from "./PetArt";
import { formNames, stageNames } from "./growth";
import type { GrowthStage, PetState } from "./types";

export function StatusIdentity({ pet, stage, days }: {
  pet: PetState; stage: GrowthStage; days: number;
}) {
  const growth = pet.growth;
  // Legacy stage estimates are useful, but do not invent a saved adult form.
  const form = stage === "adult" && growth?.stage === "adult" ? growth.form : "";
  const accessory = pet.economy?.equipped.accessory;
  return <div className="status-name">
    <div className="status-portrait" aria-hidden="true">
      <div className={`status-portrait-canvas growth-${stage} form-${form || "none"} motion-${pet.sleeping ? "sleeping" : "idle"}`}>
        <div className={`growth-size ${petRigClass(pet.species, stage)}`}>
          <PetArt index={pet.species} stage={stage} accessory={accessory}
            expression={pet.sleeping ? "asleep" : "awake"}
            motion={pet.sleeping ? "sleeping" : "idle"} />
          {growth && stage !== "egg" && !accessory && <GrowthOutfit stage={stage} form={form} />}
        </div>
        {form && <FormEmblem form={form} />}
      </div>
    </div>
    <div className="status-identity-copy">
      <strong>{pet.name}</strong>
      <small>{stageNames[stage]}{form ? ` · ${formNames[form]}` : ""} · 相识第 {days} 天</small>
      {pet.sleeping && <small>正在睡觉</small>}
    </div>
  </div>;
}
