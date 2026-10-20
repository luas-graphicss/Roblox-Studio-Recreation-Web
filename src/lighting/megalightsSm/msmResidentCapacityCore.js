import { SHADOW_MIN_ACTIVE, localShadowCap } from "../shadowBudget.js";
import {
  MSM_COMPOSITE_MODE_INJECTION,
  MSM_COMPOSITE_MODE_SCREEN,
  MSM_MATERIAL_TEXTURE_UNIT_LIMIT,
} from "./msmPipelineContract.js";
import { describeMsmTierPolicy } from "./msmTierPolicy.js";

export const MSM_RESIDENT_CAPACITY_OWNER = "MSM-F7";


export const MSM_MATERIAL_TEXTURE_CHARGE_BY_MODE = Object.freeze({
  [MSM_COMPOSITE_MODE_SCREEN]: 0,
  [MSM_COMPOSITE_MODE_INJECTION]: MSM_MATERIAL_TEXTURE_UNIT_LIMIT,
});


export const MSM_FORBIDDEN_CAPACITY_SIGNALS = Object.freeze([
  "instantaneousFps",
  "fps",
  "currentFps",
  "framesPerSecond",
  "frameTimeMs",
  "lastFrameMs",
]);

export const MSM_CAPACITY_REFUSAL = Object.freeze({
  FORBIDDEN_SIGNAL: "forbidden-signal",
  TIER_DOES_NOT_RUN: "tier-does-not-run",
  MISSING_MEASURED_BUDGET: "missing-measured-budget",
  UNKNOWN_COMPOSITE_MODE: "unknown-composite-mode",
});

function flooredCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const floored = Math.floor(parsed);
  return floored >= 0 ? floored : null;
}

function forbiddenSignalsIn(request) {
  return MSM_FORBIDDEN_CAPACITY_SIGNALS.filter(
    (signalName) => request[signalName] !== undefined && request[signalName] !== null,
  );
}


function residentCeilingForTier(policy) {
  return Math.min(policy.atlasSlots, policy.lightCap);
}

function capacityDecision(fields) {
  return Object.freeze({
    owner: MSM_RESIDENT_CAPACITY_OWNER,
    tier: fields.tier,
    capacity: fields.capacity,
    floor: SHADOW_MIN_ACTIVE,
    ceiling: fields.ceiling,
    ceilingFromPlan: false,
    measuredLocalShadowBudget: fields.measuredLocalShadowBudget,
    budgetAfterTextureCharge: fields.budgetAfterTextureCharge,
    compositeMode: fields.compositeMode,
    materialTextureCharge: fields.materialTextureCharge,
    refused: fields.refused,
    refusalCode: fields.refusalCode,
    forbiddenSignals: Object.freeze(fields.forbiddenSignals),
    reason: fields.reason,
  });
}


export function describeResidentCapacity(request) {
  const source = request && typeof request === "object" ? request : {};
  const forbiddenSignals = forbiddenSignalsIn(source);
  const tierDecision = describeMsmTierPolicy(source.tier);
  const compositeMode =
    source.compositeMode === undefined || source.compositeMode === null
      ? MSM_COMPOSITE_MODE_INJECTION
      : String(source.compositeMode);
  const materialTextureCharge = MSM_MATERIAL_TEXTURE_CHARGE_BY_MODE[compositeMode];
  const measuredLocalShadowBudget = flooredCount(source.measuredLocalShadowBudget);

  const refusalFields = {
    tier: tierDecision.tier,
    capacity: null,
    ceiling: null,
    measuredLocalShadowBudget,
    budgetAfterTextureCharge: null,
    compositeMode,
    materialTextureCharge: materialTextureCharge === undefined ? null : materialTextureCharge,
    refused: true,
    forbiddenSignals,
  };

  if (forbiddenSignals.length >= 1) {
    return capacityDecision(
      Object.assign({}, refusalFields, {
        refusalCode: MSM_CAPACITY_REFUSAL.FORBIDDEN_SIGNAL,
        reason:
          "resident set size is a function of tier and measured budget, never of instantaneous fps - refused signals: " +
          forbiddenSignals.join(", "),
      }),
    );
  }

  if (!tierDecision.policy) {
    return capacityDecision(
      Object.assign({}, refusalFields, {
        refusalCode: MSM_CAPACITY_REFUSAL.TIER_DOES_NOT_RUN,
        reason: tierDecision.reason,
      }),
    );
  }

  if (materialTextureCharge === undefined) {
    return capacityDecision(
      Object.assign({}, refusalFields, {
        refusalCode: MSM_CAPACITY_REFUSAL.UNKNOWN_COMPOSITE_MODE,
        reason:
          'unknown composite mode "' +
          compositeMode +
          '" - the contract only has ' +
          MSM_COMPOSITE_MODE_SCREEN +
          " and " +
          MSM_COMPOSITE_MODE_INJECTION,
      }),
    );
  }

  if (measuredLocalShadowBudget === null) {
    return capacityDecision(
      Object.assign({}, refusalFields, {
        refusalCode: MSM_CAPACITY_REFUSAL.MISSING_MEASURED_BUDGET,
        reason:
          "measuredLocalShadowBudget is required and must be a finite count - the MSM never guesses the budget it did not measure",
      }),
    );
  }

  const ceiling = residentCeilingForTier(tierDecision.policy);
  const budgetAfterTextureCharge = localShadowCap(measuredLocalShadowBudget, materialTextureCharge);
  const capacity = Math.min(ceiling, budgetAfterTextureCharge);

  return capacityDecision({
    tier: tierDecision.tier,
    capacity,
    ceiling,
    measuredLocalShadowBudget,
    budgetAfterTextureCharge,
    compositeMode,
    materialTextureCharge,
    refused: false,
    refusalCode: null,
    forbiddenSignals,
    reason:
      "tier " +
      tierDecision.tier +
      " with a measured budget of " +
      measuredLocalShadowBudget +
      " local shadows, minus " +
      materialTextureCharge +
      " texture unit charged by composite mode " +
      compositeMode +
      ", against a tier ceiling of " +
      ceiling +
      " - resident capacity " +
      capacity,
  });
}


export function resolveResidentCapacity(request) {
  return describeResidentCapacity(request).capacity;
}
