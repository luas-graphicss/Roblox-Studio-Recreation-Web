import { installOnMaterial } from "../lighting/megalights/runtime/megaLightsPatchRegistry.js";
import { isFlagActive } from "../lighting/megalights/runtime/megaLightsFlagRegistry.js";
import {
  MASTER_BASELINE_FLAG_ID,
  MASTER_ENABLE_FLAG_ID,
} from "../lighting/megalights/runtime/megaLightsMasterSwitchCore.js";
import { mlQa } from "../lighting/megalights/runtime/megaLightsTelemetry.js";


export const FUTURE_TECHNOLOGY = "Future";


export const MEGALIGHTS_MATERIAL_FLAG = "__rswMgl";


export const MEGALIGHTS_INSTALLED_MARKER = "__mglInstalled";
export const MEGALIGHTS_MATERIAL_PATH_MARKER = "__mglMaterialPath";

const DEFAULT_MATERIAL_PATH = "standard";

let subscribedMaterialCount = 0;
let unsubscribedMaterialCount = 0;
let composedCacheKeyCount = 0;


export function megaLightsMaterialPathFor(material) {
  if (!material) return DEFAULT_MATERIAL_PATH;
  if (material.isMeshPhysicalMaterial) return "physical";
  if (material.isMeshStandardMaterial) return DEFAULT_MATERIAL_PATH;
  if (material.isMeshPhongMaterial) return "phong";
  if (material.isMeshLambertMaterial) return "lambert";
  return DEFAULT_MATERIAL_PATH;
}


export function megaLightsWantsMaterials(lightingState) {
  const state = lightingState || {};
  if (state.megaLightsEnabled === false) return false;
  if (state.technology !== FUTURE_TECHNOLOGY) return false;
  const tierName = String(state.tierName || "");
  if (!tierName) return false;
  if (!isFlagActive(MASTER_ENABLE_FLAG_ID, tierName)) return false;
  if (isFlagActive(MASTER_BASELINE_FLAG_ID, tierName)) return false;
  return true;
}


export function subscribeMaterialToMegaLights(material) {
  if (!material) return false;
  if (!material.userData) material.userData = {};
  if (material.userData[MEGALIGHTS_MATERIAL_FLAG]) return false;

  const materialPath = megaLightsMaterialPathFor(material);
  const previousCacheKey =
    typeof material.customProgramCacheKey === "function" ? material.customProgramCacheKey : null;

  try {
    installOnMaterial(material, materialPath);
  } catch (error) {


    mlQa.error(error, "megaLightsMaterialSubscription.installOnMaterial");
    return false;
  }

  const megaLightsCacheKey =
    typeof material.customProgramCacheKey === "function" ? material.customProgramCacheKey : null;




  if (megaLightsCacheKey && previousCacheKey && megaLightsCacheKey !== previousCacheKey) {
    material.customProgramCacheKey = function () {
      return String(previousCacheKey.call(this)) + "|" + String(megaLightsCacheKey.call(this));
    };
    composedCacheKeyCount += 1;
  }

  material.userData[MEGALIGHTS_MATERIAL_FLAG] = true;
  material.needsUpdate = true;
  subscribedMaterialCount += 1;
  return true;
}


export function unsubscribeMaterialFromMegaLights(material) {
  if (!material) return false;
  const userData = material.userData || {};
  const wasSubscribed = !!userData[MEGALIGHTS_MATERIAL_FLAG];
  delete userData[MEGALIGHTS_MATERIAL_FLAG];
  delete material[MEGALIGHTS_INSTALLED_MARKER];
  delete material[MEGALIGHTS_MATERIAL_PATH_MARKER];
  if (wasSubscribed) unsubscribedMaterialCount += 1;
  return wasSubscribed;
}


export function materialIsSubscribedToMegaLights(material) {
  if (!material || !material.userData) return false;
  return !!material.userData[MEGALIGHTS_MATERIAL_FLAG];
}


export function megaLightsSubscriptionReport() {
  return {
    subscribedMaterialCount,
    unsubscribedMaterialCount,
    composedCacheKeyCount,
    materialFlag: MEGALIGHTS_MATERIAL_FLAG,
  };
}
