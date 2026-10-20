import { VOL_FOG_MAX_STEPS, VOL_FOG_MIN_STEPS } from "./volumetricFogCore.js";
import { LOCAL_VOLUMETRIC_MAX_LIGHTS } from "./llVolumetricLocalContract.js";

export const LOCAL_VOLUMETRIC_REFUSAL = Object.freeze({
  TIER_HAS_NO_BUDGET: "tier-has-no-volumetric-budget",
  LIGHT_IS_DARK: "light-is-dark",
  SCATTERING_DISABLED: "scattering-intensity-is-zero",
  RANGE_IS_ZERO: "range-is-zero",
  BEHIND_CAMERA: "influence-sphere-behind-camera",
  BEYOND_VIEW_DISTANCE: "influence-sphere-beyond-view-distance",
  OUT_OF_LIGHT_BUDGET: "out-of-light-budget",
});

export const LOCAL_VOLUMETRIC_DEFAULT_TIER = "medio";
export const LOCAL_VOLUMETRIC_PRIORITY_SOURCE = "LL-F17 range x intensity x scattering over distance";


const LIGHT_BUDGET_BY_TIER = Object.freeze({
  fraco: 0,
  medio: LOCAL_VOLUMETRIC_MAX_LIGHTS,
  forte: LOCAL_VOLUMETRIC_MAX_LIGHTS,
});


const STEP_COUNT_BY_TIER = Object.freeze({
  fraco: 0,
  medio: 12,
  forte: 20,
});

function isFiniteNumber(value) {
  return typeof value === "number" && isFinite(value);
}

function numberOr(value, fallback) {
  return isFiniteNumber(value) ? value : fallback;
}

export function volumetricLightBudgetForTier(tier) {
  const budget = LIGHT_BUDGET_BY_TIER[tier];
  return isFiniteNumber(budget) ? budget : LIGHT_BUDGET_BY_TIER[LOCAL_VOLUMETRIC_DEFAULT_TIER];
}

export function volumetricStepCountForTier(tier) {
  const steps = STEP_COUNT_BY_TIER[tier];
  const resolved = isFiniteNumber(steps) ? steps : STEP_COUNT_BY_TIER[LOCAL_VOLUMETRIC_DEFAULT_TIER];
  if (resolved <= 0) return 0;
  return Math.min(Math.max(resolved, VOL_FOG_MIN_STEPS), VOL_FOG_MAX_STEPS);
}

function distanceAlongCameraAxis(light, camera) {
  const toLightX = light.worldPosition.x - camera.position.x;
  const toLightY = light.worldPosition.y - camera.position.y;
  const toLightZ = light.worldPosition.z - camera.position.z;
  return toLightX * camera.forward.x + toLightY * camera.forward.y + toLightZ * camera.forward.z;
}

function distanceToCamera(light, camera) {
  const toLightX = light.worldPosition.x - camera.position.x;
  const toLightY = light.worldPosition.y - camera.position.y;
  const toLightZ = light.worldPosition.z - camera.position.z;
  return Math.sqrt(toLightX * toLightX + toLightY * toLightY + toLightZ * toLightZ);
}


export function refuseVolumetricLight(light, camera, viewDistance) {
  if (!light.emitsIntoMedium) {
    if (!(light.intensity > 0)) return LOCAL_VOLUMETRIC_REFUSAL.LIGHT_IS_DARK;
    if (!(light.range > 0)) return LOCAL_VOLUMETRIC_REFUSAL.RANGE_IS_ZERO;
    return LOCAL_VOLUMETRIC_REFUSAL.SCATTERING_DISABLED;
  }
  if (!camera) return null;
  const axialDistance = distanceAlongCameraAxis(light, camera);
  if (axialDistance + light.range < 0) return LOCAL_VOLUMETRIC_REFUSAL.BEHIND_CAMERA;
  if (axialDistance - light.range > numberOr(viewDistance, Infinity)) {
    return LOCAL_VOLUMETRIC_REFUSAL.BEYOND_VIEW_DISTANCE;
  }
  return null;
}


export function volumetricLightPriority(light, camera) {
  const distance = camera ? distanceToCamera(light, camera) : 0;
  return (light.intensity * light.scatteringIntensity * light.range) / (1 + distance);
}


export function planLocalVolumetricBudget(options) {
  const settings = options || {};
  const tier = settings.tier || LOCAL_VOLUMETRIC_DEFAULT_TIER;
  const lights = Array.isArray(settings.lights) ? settings.lights : [];
  const camera = settings.camera || null;
  const tierBudget = volumetricLightBudgetForTier(tier);
  const budget = Math.min(
    isFiniteNumber(settings.maxLights) ? Math.max(Math.floor(settings.maxLights), 0) : tierBudget,
    tierBudget,
    LOCAL_VOLUMETRIC_MAX_LIGHTS,
  );
  const stepCount = volumetricStepCountForTier(tier);
  const refused = [];
  const eligible = [];
  for (let index = 0; index < lights.length; index++) {
    const light = lights[index];
    if (budget <= 0) {
      refused.push({ name: light.name, refusal: LOCAL_VOLUMETRIC_REFUSAL.TIER_HAS_NO_BUDGET });
      continue;
    }
    const refusal = refuseVolumetricLight(light, camera, settings.viewDistance);
    if (refusal) {
      refused.push({ name: light.name, refusal });
      continue;
    }
    eligible.push({ light, priority: volumetricLightPriority(light, camera) });
  }


  eligible.sort((a, b) => (b.priority - a.priority) || 0);
  const selected = [];
  for (let index = 0; index < eligible.length; index++) {
    if (selected.length < budget) {
      selected.push(eligible[index].light);
      continue;
    }
    refused.push({ name: eligible[index].light.name, refusal: LOCAL_VOLUMETRIC_REFUSAL.OUT_OF_LIGHT_BUDGET });
  }
  return {
    tier,
    budget,
    stepCount,
    selected,
    selectedCount: selected.length,
    refused,
    prioritySource: LOCAL_VOLUMETRIC_PRIORITY_SOURCE,
  };
}
