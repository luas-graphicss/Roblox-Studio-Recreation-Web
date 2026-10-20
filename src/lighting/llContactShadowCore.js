export const CONTACT_SHADOW_MIN_STEPS = 8;
export const CONTACT_SHADOW_MAX_STEPS = 16;

export const CONTACT_SHADOW_MAX_LENGTH_STUDS = 8;
export const CONTACT_SHADOW_DEFAULT_INTENSITY = 1;


export const CONTACT_SHADOW_THICKNESS_RATIO = 0.5;
export const CONTACT_SHADOW_MIN_THICKNESS_STUDS = 0.05;

export const CONTACT_SHADOW_MIN_DEPTH_BIAS_STUDS = 0.02;
export const CONTACT_SHADOW_DEPTH_BIAS_STEP_RATIO = 0.25;
export const CONTACT_SHADOW_MIN_NORMAL_OFFSET_STUDS = 0.03;
export const CONTACT_SHADOW_NORMAL_OFFSET_STEP_RATIO = 0.5;


export const CONTACT_SHADOW_NOISE_X = 0.06711056;
export const CONTACT_SHADOW_NOISE_Y = 0.00583715;
export const CONTACT_SHADOW_NOISE_SCALE = 52.9829189;

export const CONTACT_SHADOW_STEPS_BY_TIER = Object.freeze({ fraco: 8, medio: 12, forte: 16 });

export const CONTACT_SHADOW_MARCHES_BY_TIER = Object.freeze({ fraco: false, medio: true, forte: true });
export const CONTACT_SHADOW_DEFAULT_TIER = "medio";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function saturate(value) {
  const number = isFiniteNumber(Number(value)) ? Number(value) : 0;
  if (number < 0) return 0;
  if (number > 1) return 1;
  return number;
}

export function fract(value) {
  return value - Math.floor(value);
}

export function clampContactShadowLengthStuds(lengthStuds) {
  const requested = isFiniteNumber(Number(lengthStuds)) ? Number(lengthStuds) : 0;
  if (requested <= 0) return 0;
  return Math.min(requested, CONTACT_SHADOW_MAX_LENGTH_STUDS);
}

export function clampContactShadowStepCount(stepCount) {
  const requested = isFiniteNumber(Number(stepCount)) ? Math.round(Number(stepCount)) : CONTACT_SHADOW_MIN_STEPS;
  if (requested < CONTACT_SHADOW_MIN_STEPS) return CONTACT_SHADOW_MIN_STEPS;
  if (requested > CONTACT_SHADOW_MAX_STEPS) return CONTACT_SHADOW_MAX_STEPS;
  return requested;
}

export function contactShadowStepCountForTier(tier) {
  const byTier = CONTACT_SHADOW_STEPS_BY_TIER[tier];
  return clampContactShadowStepCount(byTier === undefined ? CONTACT_SHADOW_STEPS_BY_TIER[CONTACT_SHADOW_DEFAULT_TIER] : byTier);
}

export function tierMarchesLocalLights(tier) {
  return CONTACT_SHADOW_MARCHES_BY_TIER[tier] === true;
}


export function resolveContactShadowSettings(request) {
  const input = request || {};
  const tier = typeof input.tier === "string" ? input.tier : CONTACT_SHADOW_DEFAULT_TIER;
  const marchesLocalLights = tierMarchesLocalLights(tier);
  const authoredLengthStuds = clampContactShadowLengthStuds(input.contactShadowLengthStuds);
  const marchLengthStuds = marchesLocalLights ? authoredLengthStuds : 0;
  const stepCount = input.stepCount === undefined ? contactShadowStepCountForTier(tier) : clampContactShadowStepCount(input.stepCount);
  const stepLengthStuds = marchLengthStuds > 0 ? marchLengthStuds / stepCount : 0;
  const intensity = saturate(input.intensity === undefined ? CONTACT_SHADOW_DEFAULT_INTENSITY : input.intensity);


  const temporalAccumulation = input.temporalAccumulationAvailable === true;
  const temporalPhase = temporalAccumulation && isFiniteNumber(Number(input.temporalPhase)) ? fract(Number(input.temporalPhase)) : 0;
  return Object.freeze({
    tier,
    enabled: marchLengthStuds > 0 && intensity > 0,
    fallbackToGlobalFuse: !marchesLocalLights,
    authoredLengthStuds,
    marchLengthStuds,
    stepCount,
    stepLengthStuds,
    intensity,
    thicknessStuds: marchLengthStuds > 0 ? Math.max(marchLengthStuds * CONTACT_SHADOW_THICKNESS_RATIO, CONTACT_SHADOW_MIN_THICKNESS_STUDS) : 0,
    depthBiasStuds: Math.max(CONTACT_SHADOW_MIN_DEPTH_BIAS_STUDS, stepLengthStuds * CONTACT_SHADOW_DEPTH_BIAS_STEP_RATIO),
    normalOffsetStuds: Math.max(CONTACT_SHADOW_MIN_NORMAL_OFFSET_STUDS, stepLengthStuds * CONTACT_SHADOW_NORMAL_OFFSET_STEP_RATIO),
    temporalAccumulation,
    temporalPhase,


    coneGateHalfAngleDeg: isFiniteNumber(Number(input.coneGateHalfAngleDeg)) ? Math.max(Number(input.coneGateHalfAngleDeg), 0) : 0,
  });
}


export function contactShadowJitter(pixelX, pixelY, temporalPhase) {
  const projected = fract(Number(pixelX) * CONTACT_SHADOW_NOISE_X + Number(pixelY) * CONTACT_SHADOW_NOISE_Y);
  const phase = isFiniteNumber(Number(temporalPhase)) ? Number(temporalPhase) : 0;
  return fract(fract(CONTACT_SHADOW_NOISE_SCALE * projected) + phase);
}


export function contactShadowSampleDistances(settings, jitter) {
  const resolved = settings || {};
  if (!resolved.enabled) return [];
  const offset = isFiniteNumber(Number(jitter)) ? Number(jitter) : 0;
  const distances = [];
  for (let marchIndex = 0; marchIndex < resolved.stepCount; marchIndex++) {
    distances.push((marchIndex + offset) * resolved.stepLengthStuds);
  }
  return distances;
}


export function isContactShadowOccluder(sample, settings) {
  const resolved = settings || {};
  if (!sample || sample.insideScreen === false || sample.hasSceneDepth === false) return false;
  if (!isFiniteNumber(Number(sample.sceneViewZ)) || !isFiniteNumber(Number(sample.rayViewZ))) return false;
  const difference = Number(sample.sceneViewZ) - Number(sample.rayViewZ);
  return difference > resolved.depthBiasStuds && difference < resolved.thicknessStuds;
}


export function contactShadowOcclusionFromSamples(samples, settings) {
  const list = Array.isArray(samples) ? samples : [];
  for (let index = 0; index < list.length; index++) {
    if (isContactShadowOccluder(list[index], settings)) return 1;
  }
  return 0;
}


export function contactShadowFactor(occlusion, settings) {
  const resolved = settings || {};
  const intensity = saturate(resolved.intensity === undefined ? CONTACT_SHADOW_DEFAULT_INTENSITY : resolved.intensity);
  return 1 - saturate(occlusion) * intensity;
}


export function accumulateContactShadowFactor(previousFactor, currentFactor, historyWeight) {
  const weight = saturate(historyWeight);
  const previous = isFiniteNumber(Number(previousFactor)) ? Number(previousFactor) : Number(currentFactor);
  return previous * weight + Number(currentFactor) * (1 - weight);
}
