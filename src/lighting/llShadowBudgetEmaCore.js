import {
  MAX_SHADOW_RESOLUTION,
  MIN_SHADOW_RESOLUTION,
  SHADOW_RESOLUTION_LADDER,
} from "./llShadowScreenSizeCore.js";

export const BUDGET_PHASE_ID = "LL-F12";


export const BUDGET_EMA_ALPHA = 0.1;


export const BUDGET_TARGET_FRAME_MS = Object.freeze({
  fraco: 1000 / 45,
  medio: 1000 / 60,
  forte: 1000 / 72,
});

export const BUDGET_RELIEF_PRESSURE = 1.15;
export const BUDGET_RECOVERY_PRESSURE = 0.85;
export const BUDGET_PLANS_BEFORE_STEP = 3;

const LAST_LADDER_INDEX = SHADOW_RESOLUTION_LADDER.length - 1;

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function targetFrameMsForTier(tier) {
  const target = BUDGET_TARGET_FRAME_MS[String(tier)];
  return target === undefined ? BUDGET_TARGET_FRAME_MS.medio : target;
}


export function createShadowBudgetCeiling(options) {
  const settings = asObject(options);
  const alpha = Math.min(Math.max(finiteOr(settings.alpha, BUDGET_EMA_ALPHA), 0.01), 1);
  const plansBeforeStep = Math.max(Math.floor(finiteOr(settings.plansBeforeStep, BUDGET_PLANS_BEFORE_STEP)), 1);
  const reliefPressure = Math.max(finiteOr(settings.reliefPressure, BUDGET_RELIEF_PRESSURE), 1);
  const recoveryPressure = Math.min(Math.max(finiteOr(settings.recoveryPressure, BUDGET_RECOVERY_PRESSURE), 0.1), 1);

  let targetMs = Math.max(finiteOr(settings.targetFrameMs, targetFrameMsForTier(settings.tier)), 1);
  let tier = settings.tier === undefined ? "medio" : String(settings.tier);
  let emaMs = 0;
  let sampleCount = 0;
  let ceilingIndex = LAST_LADDER_INDEX;
  let reliefPlans = 0;
  let recoveryPlans = 0;
  let steps = 0;

  function pressure() {
    return sampleCount > 0 ? emaMs / targetMs : 0;
  }

  function snapshot() {
    return Object.freeze({
      tier,
      targetFrameMs: targetMs,
      emaMs,
      sampleCount,
      pressure: pressure(),
      ceilingResolution: SHADOW_RESOLUTION_LADDER[ceilingIndex],
      ceilingIndex,
      reliefPlans,
      recoveryPlans,
      steps,
      relieving: reliefPlans > 0,
      recovering: recoveryPlans > 0,
    });
  }


  function observe(frameMs) {
    const sample = Math.max(finiteOr(frameMs, 0), 0);
    emaMs = sampleCount > 0 ? emaMs + alpha * (sample - emaMs) : sample;
    sampleCount += 1;
    const currentPressure = pressure();
    if (currentPressure >= reliefPressure) {
      reliefPlans += 1;
      recoveryPlans = 0;
    } else if (recoveryPressure >= currentPressure) {
      recoveryPlans += 1;
      reliefPlans = 0;
    } else {
      reliefPlans = 0;
      recoveryPlans = 0;
    }
    if (reliefPlans >= plansBeforeStep) {
      const next = Math.max(ceilingIndex - 1, 0);
      if (next !== ceilingIndex) steps += 1;
      ceilingIndex = next;
      reliefPlans = 0;
    }
    if (recoveryPlans >= plansBeforeStep) {
      const next = Math.min(ceilingIndex + 1, LAST_LADDER_INDEX);
      if (next !== ceilingIndex) steps += 1;
      ceilingIndex = next;
      recoveryPlans = 0;
    }
    return snapshot();
  }

  function setTier(nextTier) {
    tier = String(nextTier);
    targetMs = Math.max(targetFrameMsForTier(tier), 1);
    return snapshot();
  }

  function reset() {
    emaMs = 0;
    sampleCount = 0;
    ceilingIndex = LAST_LADDER_INDEX;
    reliefPlans = 0;
    recoveryPlans = 0;
    steps = 0;
    return snapshot();
  }

  return Object.freeze({
    observe,
    setTier,
    reset,
    snapshot,
    ceilingResolution: () => SHADOW_RESOLUTION_LADDER[ceilingIndex],
    floorResolution: () => MIN_SHADOW_RESOLUTION,
    topResolution: () => MAX_SHADOW_RESOLUTION,
  });
}
