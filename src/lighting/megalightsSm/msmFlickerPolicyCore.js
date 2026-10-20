import { MSM_CONVERGENCE_FRAMES_98 } from "./msmConvergenceClockCore.js";
import { MSM_HISTORY_ACTION } from "./msmGridDirtyCore.js";
import { readMsmLightKey } from "./msmLightRecordCore.js";
import {
  MSM_ACTIVE_TIERS,
  MSM_SLEEPING_TIERS,
  MSM_TIER_LIGHT_CAP_CEILING,
  describeMsmTierPolicy,
} from "./msmTierPolicy.js";

export const MSM_FLICKER_PHASE_ID = "MSM-F30";


export const MSM_FLICKER_MINIMUM_TIER = "low";

const MINIMUM_TIER_LADDER_INDEX = MSM_ACTIVE_TIERS.indexOf(MSM_FLICKER_MINIMUM_TIER);


export const MSM_FLICKER_ACTIVE_TIERS = Object.freeze(
  MINIMUM_TIER_LADDER_INDEX >= 0 ? MSM_ACTIVE_TIERS.slice(MINIMUM_TIER_LADDER_INDEX) : [],
);


export const MSM_FLICKER_RELATIVE_STEP = 0.1;


export const MSM_FLICKER_STEPS_TO_CLASSIFY = 2;


export const MSM_FLICKER_OBSERVATION_FRAMES = MSM_CONVERGENCE_FRAMES_98;


export const MSM_FLICKER_CALM_FRAMES = MSM_CONVERGENCE_FRAMES_98;


export const MSM_FLICKER_STABLE_HISTORY_FRAMES = MSM_CONVERGENCE_FRAMES_98;


export const MSM_FLICKER_MINIMUM_HISTORY_FRAMES = 2;


export const MSM_FLICKER_HISTORY_FRAMES = 2;

export const MSM_FLICKER_CLASSIFICATION = Object.freeze({
  STABLE: "stable",
  FLICKERING: "flickering",
});

export const MSM_FLICKER_REFUSAL = Object.freeze({
  TIER_BELOW_MINIMUM: "tier-below-minimum",
  TIER_SLEEPING: "tier-sleeping",
  TIER_UNKNOWN: "tier-unknown",
  MISSING_LIGHT_KEY: "missing-light-key",
  INVALID_LUMINANCE: "invalid-luminance",
  LIGHT_CAP_EXCEEDED: "light-cap-exceeded",
});


export const MSM_FLICKER_DECLARED_RESIDUE = Object.freeze({
  what:
    "a flickering light keeps " +
    MSM_FLICKER_HISTORY_FRAMES +
    " frames of history while it blinks, instead of " +
    MSM_FLICKER_STABLE_HISTORY_FRAMES,
  cost: "its own contribution is noisier than a stable light's, by construction",
  whoPays: "only the flickering light id - every other light keeps the long history untouched",
});

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumberOr(value, fallback) {
  const parsed = numberOr(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function positiveIntegerOr(value, fallback) {
  const parsed = Math.floor(numberOr(value, fallback));
  return parsed >= 1 ? parsed : fallback;
}


export function msmRelativeLuminanceStep(previousLuminance, luminance) {
  const previous = numberOr(previousLuminance, 0);
  const current = numberOr(luminance, 0);
  const largest = current > previous ? current : previous;
  if (!(largest > 0)) return 0;
  const distance = current > previous ? current - previous : previous - current;
  return distance / largest;
}


export function describeMsmFlickerTier(value) {
  const tierDecision = describeMsmTierPolicy(value);
  const tier = tierDecision.tier;

  if (MSM_FLICKER_ACTIVE_TIERS.indexOf(tier) >= 0) {
    return Object.freeze({
      tier,
      runs: true,
      refusal: null,
      lightCap: tierDecision.policy.lightCap,
      reason: "tier " + tier + " runs the flicker policy of " + MSM_FLICKER_PHASE_ID,
    });
  }

  if (tierDecision.runs) {
    return Object.freeze({
      tier,
      runs: false,
      refusal: MSM_FLICKER_REFUSAL.TIER_BELOW_MINIMUM,
      lightCap: tierDecision.policy.lightCap,
      reason:
        "tier " +
        tier +
        " is below " +
        MSM_FLICKER_MINIMUM_TIER +
        "+ - the flicker residue stays declared there instead of treated",
    });
  }

  if (MSM_SLEEPING_TIERS.indexOf(tier) >= 0) {
    return Object.freeze({
      tier,
      runs: false,
      refusal: MSM_FLICKER_REFUSAL.TIER_SLEEPING,
      lightCap: 0,
      reason: "tier " + tier + " belongs to the strong GPU - the whole MSM sleeps there",
    });
  }

  return Object.freeze({
    tier,
    runs: false,
    refusal: MSM_FLICKER_REFUSAL.TIER_UNKNOWN,
    lightCap: 0,
    reason: tierDecision.reason,
  });
}


function readObservationLightKey(observation) {
  if (observation === null || observation === undefined) return null;
  if (typeof observation !== "object") return readMsmLightKey(observation);
  const declaredKey = readMsmLightKey(observation.lightId);
  return declaredKey !== null ? declaredKey : readMsmLightKey(observation);
}

function readFlickerHistoryFrames(value, stableHistoryFrames) {
  const requested = positiveIntegerOr(value, MSM_FLICKER_HISTORY_FRAMES);
  if (MSM_FLICKER_MINIMUM_HISTORY_FRAMES > requested) return MSM_FLICKER_MINIMUM_HISTORY_FRAMES;
  return requested > stableHistoryFrames ? stableHistoryFrames : requested;
}

function createLightState(lightId) {
  return {
    lightId,
    luminance: 0,
    previousLuminance: 0,
    hasLuminance: false,
    relativeStep: 0,
    significantStepFrames: [],
    framesSinceSignificantStep: 0,
    framesSinceObserved: 0,
    observedThisFrame: false,
    steppedThisFrame: false,
    flickering: false,
    classifiedAtFrame: 0,
  };
}


export function createFlickerPolicy(options) {
  const settings = options || {};
  const tierDecision = describeMsmFlickerTier(settings.tier);
  const significantRelativeStep = positiveNumberOr(settings.relativeStep, MSM_FLICKER_RELATIVE_STEP);
  const stepsToClassify = positiveIntegerOr(settings.stepsToClassify, MSM_FLICKER_STEPS_TO_CLASSIFY);
  const observationFrames = positiveIntegerOr(settings.observationFrames, MSM_FLICKER_OBSERVATION_FRAMES);
  const calmFrames = positiveIntegerOr(settings.calmFrames, MSM_FLICKER_CALM_FRAMES);
  const stableHistoryFrames = positiveIntegerOr(settings.stableHistoryFrames, MSM_FLICKER_STABLE_HISTORY_FRAMES);
  const flickerHistoryFrames = readFlickerHistoryFrames(settings.flickerHistoryFrames, stableHistoryFrames);
  const trackedLightCap = positiveIntegerOr(
    settings.trackedLightCap,
    tierDecision.lightCap >= 1 ? tierDecision.lightCap : MSM_TIER_LIGHT_CAP_CEILING,
  );

  const lightStates = new Map();
  const pendingLuminanceByLightId = new Map();

  const totals = {
    frames: 0,
    observations: 0,
    rejectedObservations: 0,
    significantSteps: 0,
    flickerEntries: 0,
    flickerExits: 0,
    forgottenLights: 0,
    maxTrackedLightCount: 0,
  };

  let frame = 0;
  let newLightIdsThisFrame = 0;
  let rejectedObservationsThisFrame = 0;
  let lastRefusal = null;

  function refuseObservation(refusal) {
    totals.rejectedObservations++;
    rejectedObservationsThisFrame++;
    lastRefusal = refusal;
    return false;
  }


  function observeLight(observation) {
    if (!tierDecision.runs) return refuseObservation(tierDecision.refusal);

    const lightId = readObservationLightKey(observation);
    if (lightId === null) return refuseObservation(MSM_FLICKER_REFUSAL.MISSING_LIGHT_KEY);

    const luminance = observation && typeof observation === "object" ? Number(observation.luminance) : Number.NaN;
    if (!Number.isFinite(luminance) || !(luminance >= 0)) return refuseObservation(MSM_FLICKER_REFUSAL.INVALID_LUMINANCE);

    const isKnownLight = lightStates.has(lightId) || pendingLuminanceByLightId.has(lightId);
    if (!isKnownLight && lightStates.size + newLightIdsThisFrame >= trackedLightCap) {
      return refuseObservation(MSM_FLICKER_REFUSAL.LIGHT_CAP_EXCEEDED);
    }
    if (!isKnownLight) newLightIdsThisFrame++;

    pendingLuminanceByLightId.set(lightId, luminance);
    totals.observations++;
    return true;
  }

  function foldObservationsIntoStates() {
    lightStates.forEach((state) => {
      state.observedThisFrame = false;
      state.steppedThisFrame = false;
    });

    pendingLuminanceByLightId.forEach((luminance, lightId) => {
      const state = lightStates.get(lightId) || createLightState(lightId);
      lightStates.set(lightId, state);

      const relativeStep = state.hasLuminance ? msmRelativeLuminanceStep(state.luminance, luminance) : 0;
      state.previousLuminance = state.hasLuminance ? state.luminance : luminance;
      state.luminance = luminance;
      state.hasLuminance = true;
      state.relativeStep = relativeStep;
      state.observedThisFrame = true;
      state.framesSinceObserved = 0;

      if (relativeStep > significantRelativeStep) {
        state.steppedThisFrame = true;
        state.significantStepFrames.push(frame);
        state.framesSinceSignificantStep = 0;
        totals.significantSteps++;
      }
    });

    pendingLuminanceByLightId.clear();
  }

  function pruneStepsOutsideWindow(state) {
    const oldestKeptFrame = frame - observationFrames + 1;
    while (state.significantStepFrames.length >= 1 && oldestKeptFrame > state.significantStepFrames[0]) {
      state.significantStepFrames.shift();
    }
  }


  function ageLightsAndForgetTheGone() {
    const goneLightIds = [];
    lightStates.forEach((state, lightId) => {
      if (!state.observedThisFrame) {
        state.framesSinceObserved++;
        if (state.framesSinceObserved >= observationFrames) goneLightIds.push(lightId);
      }
      if (!state.steppedThisFrame) state.framesSinceSignificantStep++;
      pruneStepsOutsideWindow(state);
    });
    goneLightIds.forEach((lightId) => {
      lightStates.delete(lightId);
      totals.forgottenLights++;
    });
  }

  function classifyLights() {
    lightStates.forEach((state) => {
      if (!state.flickering && state.significantStepFrames.length >= stepsToClassify) {
        state.flickering = true;
        state.classifiedAtFrame = frame;
        totals.flickerEntries++;
        return;
      }
      if (state.flickering && state.framesSinceSignificantStep >= calmFrames) {
        state.flickering = false;
        state.significantStepFrames.length = 0;
        state.classifiedAtFrame = frame;
        totals.flickerExits++;
      }
    });
  }

  function historyFramesOf(state) {
    return state.flickering ? flickerHistoryFrames : stableHistoryFrames;
  }

  function historyActionOf(state) {
    return state.flickering ? MSM_HISTORY_ACTION.FAST_ALPHA : MSM_HISTORY_ACTION.NONE;
  }

  function buildPlan() {
    const lightIds = Array.from(lightStates.keys()).sort();
    const flickeringLightIds = [];
    const historyFramesByLightId = {};
    const historyActionByLightId = {};
    let observedLightCount = 0;

    lightIds.forEach((lightId) => {
      const state = lightStates.get(lightId);
      if (state.observedThisFrame) observedLightCount++;
      historyFramesByLightId[lightId] = historyFramesOf(state);
      historyActionByLightId[lightId] = historyActionOf(state);
      if (state.flickering) flickeringLightIds.push(lightId);
    });

    return Object.freeze({
      phase: MSM_FLICKER_PHASE_ID,
      frame,
      runs: true,
      tier: tierDecision.tier,
      reason: tierDecision.reason,
      observedLightCount,
      trackedLightCount: lightIds.length,
      flickeringLightIds: Object.freeze(flickeringLightIds),
      historyFramesByLightId: Object.freeze(historyFramesByLightId),
      historyActionByLightId: Object.freeze(historyActionByLightId),
      stableHistoryFrames,
      flickerHistoryFrames,
      rejectedObservationCount: rejectedObservationsThisFrame,
    });
  }


  function buildNeutralPlan() {
    return Object.freeze({
      phase: MSM_FLICKER_PHASE_ID,
      frame,
      runs: false,
      tier: tierDecision.tier,
      reason: tierDecision.reason,
      observedLightCount: 0,
      trackedLightCount: 0,
      flickeringLightIds: Object.freeze([]),
      historyFramesByLightId: Object.freeze({}),
      historyActionByLightId: Object.freeze({}),
      stableHistoryFrames,
      flickerHistoryFrames,
      rejectedObservationCount: rejectedObservationsThisFrame,
    });
  }

  function finishFrame(plan) {
    if (lightStates.size > totals.maxTrackedLightCount) totals.maxTrackedLightCount = lightStates.size;
    newLightIdsThisFrame = 0;
    rejectedObservationsThisFrame = 0;
    pendingLuminanceByLightId.clear();
    return plan;
  }

  function planFrame() {
    frame++;
    totals.frames++;
    if (!tierDecision.runs) return finishFrame(buildNeutralPlan());
    foldObservationsIntoStates();
    ageLightsAndForgetTheGone();
    classifyLights();
    return finishFrame(buildPlan());
  }


  function historyFramesFor(lightId) {
    if (!tierDecision.runs) return stableHistoryFrames;
    const key = readObservationLightKey(lightId);
    if (key === null) return stableHistoryFrames;
    const state = lightStates.get(key);
    return state ? historyFramesOf(state) : stableHistoryFrames;
  }

  function describeLight(lightId) {
    const key = readObservationLightKey(lightId);
    if (key === null) return null;
    const state = lightStates.get(key);
    if (!state) return null;
    return Object.freeze({
      lightId: key,
      classification: state.flickering ? MSM_FLICKER_CLASSIFICATION.FLICKERING : MSM_FLICKER_CLASSIFICATION.STABLE,
      flickering: state.flickering,
      luminance: state.luminance,
      previousLuminance: state.previousLuminance,
      relativeStep: state.relativeStep,
      significantStepsInWindow: state.significantStepFrames.length,
      framesSinceSignificantStep: state.framesSinceSignificantStep,
      framesSinceObserved: state.framesSinceObserved,
      classifiedAtFrame: state.classifiedAtFrame,
      historyFrames: historyFramesOf(state),
      historyAction: historyActionOf(state),
    });
  }

  function stats() {
    return {
      phase: MSM_FLICKER_PHASE_ID,
      tier: tierDecision.tier,
      runs: tierDecision.runs,
      frames: totals.frames,
      observations: totals.observations,
      rejectedObservations: totals.rejectedObservations,
      lastRefusal,
      significantSteps: totals.significantSteps,
      flickerEntries: totals.flickerEntries,
      flickerExits: totals.flickerExits,
      forgottenLights: totals.forgottenLights,
      trackedLightCount: lightStates.size,
      maxTrackedLightCount: totals.maxTrackedLightCount,
      relativeStep: significantRelativeStep,
      stepsToClassify,
      observationFrames,
      calmFrames,
      stableHistoryFrames,
      flickerHistoryFrames,
      trackedLightCap,
    };
  }

  function reset() {
    lightStates.clear();
    pendingLuminanceByLightId.clear();
    frame = 0;
    newLightIdsThisFrame = 0;
    rejectedObservationsThisFrame = 0;
    lastRefusal = null;
    Object.keys(totals).forEach((field) => {
      totals[field] = 0;
    });
    return true;
  }

  return {
    observeLight,
    planFrame,
    historyFramesFor,
    describeLight,
    stats,
    reset,
  };
}
