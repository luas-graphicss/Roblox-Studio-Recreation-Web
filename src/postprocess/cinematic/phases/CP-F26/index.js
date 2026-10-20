import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installPostProcessMaterials } from "./installPostProcessMaterials.js";

export { createPostProcessMaterialSession } from "./materialSession.js";
export { installPostProcessMaterials } from "./installPostProcessMaterials.js";
export { MATERIAL_LOCATIONS, MATERIAL_SESSION_KEY, MATERIAL_QUALITY_TIERS } from "./materialContract.js";
export { createMaterialPlan } from "./materialPlan.js";
export { createMaterialWeightProperties } from "./materialVolumeBridge.js";
export { createFilmicMaterialReplacement } from "./filmicReplacementProvider.js";

export function createPostProcessMaterialsPhase({ session, tonemapperOwner = "CP-F26" } = {}) {
  return Object.freeze({ id: "CP-F26", contractVersion: CONTRACT_VERSION, status: "implemented", install: (services) => installPostProcessMaterials(services, session, { tonemapperOwner }) });
}

export default createPostProcessMaterialsPhase();
