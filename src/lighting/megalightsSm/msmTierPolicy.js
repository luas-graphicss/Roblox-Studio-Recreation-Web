import { SHADOW_TIERS } from "../shadowTierCore.js";


export const MSM_SPATIAL_FILTER = Object.freeze({
  OFF: "off",
  GATED: "gated",
  ON: "on",
});


export const MSM_TIER_LIGHT_CAP_CEILING = 255;


export const MSM_ACTIVE_TIERS = Object.freeze(["micro", "lite", "low", "medium"]);


export const MSM_SLEEPING_TIERS = Object.freeze(["high", "ultra"]);


const ATLAS_RESOLUTIONS_256 = Object.freeze([256]);
const ATLAS_RESOLUTIONS_256_OR_512 = Object.freeze([256, 512]);

function frozenWorldGrid(cellsX, cellsY, cellsZ, cellStuds, listsPerCell) {
  return Object.freeze({ cellsX, cellsY, cellsZ, cellStuds, listsPerCell });
}


export const MSM_TIER_POLICY = Object.freeze({
  micro: Object.freeze({
    tier: "micro",
    resolutionDivisor: 4,
    samplesPerPixel: 1,
    screenTraceSteps: 3,
    atlasPagesPerFrame: 1,
    atlasSlots: 8,
    atlasSlotResolutions: ATLAS_RESOLUTIONS_256,
    spatialFilter: MSM_SPATIAL_FILTER.OFF,
    worldGrid: frozenWorldGrid(16, 6, 16, 12, 6),
    lightCap: 128,
    budgetMs: 1.2,
  }),
  lite: Object.freeze({
    tier: "lite",
    resolutionDivisor: 2,
    samplesPerPixel: 1,
    screenTraceSteps: 4,
    atlasPagesPerFrame: 1,
    atlasSlots: 16,
    atlasSlotResolutions: ATLAS_RESOLUTIONS_256,
    spatialFilter: MSM_SPATIAL_FILTER.GATED,
    worldGrid: frozenWorldGrid(24, 8, 24, 8, 8),
    lightCap: 192,
    budgetMs: 2.0,
  }),
  low: Object.freeze({
    tier: "low",
    resolutionDivisor: 2,
    samplesPerPixel: 1,
    screenTraceSteps: 6,
    atlasPagesPerFrame: 2,
    atlasSlots: 24,
    atlasSlotResolutions: ATLAS_RESOLUTIONS_256_OR_512,
    spatialFilter: MSM_SPATIAL_FILTER.ON,
    worldGrid: frozenWorldGrid(24, 8, 24, 8, 8),
    lightCap: 255,
    budgetMs: 2.8,
  }),
  medium: Object.freeze({
    tier: "medium",
    resolutionDivisor: 2,
    samplesPerPixel: 2,
    screenTraceSteps: 8,
    atlasPagesPerFrame: 2,
    atlasSlots: 32,
    atlasSlotResolutions: ATLAS_RESOLUTIONS_256_OR_512,
    spatialFilter: MSM_SPATIAL_FILTER.ON,
    worldGrid: frozenWorldGrid(32, 8, 32, 8, 12),
    lightCap: 255,
    budgetMs: 4.0,
  }),
});

function readTierText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}


export function isMsmTier(value) {
  return MSM_ACTIVE_TIERS.indexOf(readTierText(value)) !== -1;
}


export function isEngineTier(value) {
  return SHADOW_TIERS.indexOf(readTierText(value)) !== -1;
}


export function getMsmTierPolicy(value) {
  const tier = readTierText(value);
  return isMsmTier(tier) ? MSM_TIER_POLICY[tier] : null;
}











export function describeMsmTierPolicy(value) {
  const tier = readTierText(value);
  const policy = getMsmTierPolicy(tier);

  if (policy) {
    return {
      tier,
      runs: true,
      policy,
      reason:
        "tier " +
        tier +
        " runs the MSM with a budget of at most " +
        policy.budgetMs +
        " ms per frame",
    };
  }

  if (MSM_SLEEPING_TIERS.indexOf(tier) !== -1) {
    return {
      tier,
      runs: false,
      policy: null,
      reason:
        "tier " +
        tier +
        " belongs to the strong GPU - the original MegaLights assumes and the MSM sleeps",
    };
  }

  if (!tier) {
    return {
      tier: "",
      runs: false,
      policy: null,
      reason: "renderer tier was not informed - the MSM needs a measured tier before it wakes",
    };
  }

  return {
    tier,
    runs: false,
    policy: null,
    reason:
      'unknown renderer tier "' +
      tier +
      '" - it is not part of ' +
      SHADOW_TIERS.join(", ") +
      ", so the MSM sleeps",
  };
}


export function msmRunsOnTier(value) {
  return isMsmTier(value);
}
