export const FALLOFF_MODE = Object.freeze({
  LEGACY_THREE: "legacyThree",
  UNREAL: "unreal",
});

export const FALLOFF_DECISION_SOURCE = Object.freeze({
  LIGHT_FORCED: "light-forced",
  LIGHT_VETOED: "light-vetoed",
  PHASE_AUTO_ON: "phase-auto-on",
  PHASE_AUTO_OFF: "phase-auto-off",
});

export const UNREAL_NEAR_FIELD_OFFSET = 1;
export const THREE_MIN_DENOMINATOR = 0.01;
export const DEFAULT_DECAY_EXPONENT = 2;
export const REFERENCE_SAMPLE_COUNT = 32;
export const REFERENCE_TABLE_RADIUS = 10;


export const UNREAL_REFERENCE_TABLE = Object.freeze([
  Object.freeze({ distance: 0, value: 1 }),
  Object.freeze({ distance: 0.5, value: 0.79999000003125 }),
  Object.freeze({ distance: 1, value: 0.499900005 }),
  Object.freeze({ distance: 2, value: 0.199360512 }),
  Object.freeze({ distance: 5, value: 0.0338040865384615 }),
  Object.freeze({ distance: 8, value: 0.00536264861538461 }),
  Object.freeze({ distance: 9, value: 0.00144228304878049 }),
  Object.freeze({ distance: 10, value: 0 }),
]);

export function saturate(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}


export function attenuationWindow(distance, attenuationRadius) {
  if (!(attenuationRadius > 0)) return 1;
  const distanceOverRadius = Math.max(distance, 0) / attenuationRadius;
  const squared = distanceOverRadius * distanceOverRadius;
  const closing = saturate(1 - squared * squared);
  return closing * closing;
}

export function unrealFalloff(distance, attenuationRadius) {
  const clampedDistance = Math.max(distance, 0);
  const denominator = clampedDistance * clampedDistance + UNREAL_NEAR_FIELD_OFFSET;
  return attenuationWindow(clampedDistance, attenuationRadius) / denominator;
}


export function unrealFalloffReference(distance, attenuationRadius) {
  const clampedDistance = Math.max(distance, 0);
  const denominator = clampedDistance * clampedDistance + UNREAL_NEAR_FIELD_OFFSET;
  if (!(attenuationRadius > 0)) return 1 / denominator;
  const distanceOverRadius = clampedDistance / attenuationRadius;
  const squared = distanceOverRadius * distanceOverRadius;
  const closing = saturate((1 - squared) * (1 + squared));
  return (closing * closing) / denominator;
}

export function legacyThreeFalloff(distance, attenuationRadius, decayExponent) {
  const exponent = decayExponent === undefined ? DEFAULT_DECAY_EXPONENT : decayExponent;
  const clampedDistance = Math.max(distance, 0);
  const denominator = Math.max(Math.pow(clampedDistance, exponent), THREE_MIN_DENOMINATOR);
  return attenuationWindow(clampedDistance, attenuationRadius) / denominator;
}

export function falloffAt(distance, attenuationRadius, options) {
  const settings = options || {};
  if (settings.mode === FALLOFF_MODE.LEGACY_THREE) {
    return legacyThreeFalloff(distance, attenuationRadius, settings.decayExponent);
  }
  return unrealFalloff(distance, attenuationRadius);
}


export function blendFalloff(distance, attenuationRadius, blend, decayExponent) {
  const legacyValue = legacyThreeFalloff(distance, attenuationRadius, decayExponent);
  const amount = saturate(blend);
  if (amount <= 0) return legacyValue;
  const unrealValue = unrealFalloff(distance, attenuationRadius);
  if (amount >= 1) return unrealValue;
  return legacyValue + (unrealValue - legacyValue) * amount;
}

function resolveRadius(attenuationRadius) {
  return attenuationRadius > 0 ? attenuationRadius : REFERENCE_TABLE_RADIUS;
}

function resolveSampleCount(sampleCount) {
  const asInteger = Math.floor(sampleCount || REFERENCE_SAMPLE_COUNT);
  return asInteger > 0 ? asInteger : REFERENCE_SAMPLE_COUNT;
}


export function sampleFalloffCurve(options) {
  const settings = options || {};
  const radius = resolveRadius(settings.attenuationRadius);
  const sampleCount = resolveSampleCount(settings.sampleCount);
  const samples = [];
  for (let index = 1; index <= sampleCount; index++) {
    const distance = (radius * index) / sampleCount;
    samples.push({
      distance,
      value: falloffAt(distance, radius, { mode: settings.mode, decayExponent: settings.decayExponent }),
    });
  }
  return samples;
}

export function sampleReferenceCurve(options) {
  const settings = options || {};
  const radius = resolveRadius(settings.attenuationRadius);
  const sampleCount = resolveSampleCount(settings.sampleCount);
  const samples = [];
  for (let index = 1; index <= sampleCount; index++) {
    const distance = (radius * index) / sampleCount;
    samples.push({ distance, value: unrealFalloffReference(distance, radius) });
  }
  return samples;
}

export function relativeError(value, reference) {
  return Math.abs(value - reference) / Math.max(Math.abs(reference), 1e-12);
}


export function maxRelativeErrorAgainstReference(options) {
  const settings = options || {};
  const radius = resolveRadius(settings.attenuationRadius);
  const sampleCount = resolveSampleCount(settings.sampleCount);
  const curve = sampleFalloffCurve({ attenuationRadius: radius, sampleCount, mode: FALLOFF_MODE.UNREAL });
  const reference = sampleReferenceCurve({ attenuationRadius: radius, sampleCount });
  let worst = { distance: 0, value: 0, reference: 0, error: 0, sampleCount };
  for (let index = 0; index < curve.length; index++) {
    const error = relativeError(curve[index].value, reference[index].value);
    if (error > worst.error) {
      worst = {
        distance: curve[index].distance,
        value: curve[index].value,
        reference: reference[index].value,
        error,
        sampleCount,
      };
    }
  }
  return worst;
}


export function resolveLightFalloffMode(lightOverride, phaseFlagOn) {
  if (lightOverride === true) {
    return { mode: FALLOFF_MODE.UNREAL, source: FALLOFF_DECISION_SOURCE.LIGHT_FORCED };
  }
  if (lightOverride === false) {
    return { mode: FALLOFF_MODE.LEGACY_THREE, source: FALLOFF_DECISION_SOURCE.LIGHT_VETOED };
  }
  if (phaseFlagOn) {
    return { mode: FALLOFF_MODE.UNREAL, source: FALLOFF_DECISION_SOURCE.PHASE_AUTO_ON };
  }
  return { mode: FALLOFF_MODE.LEGACY_THREE, source: FALLOFF_DECISION_SOURCE.PHASE_AUTO_OFF };
}


export function resolveSceneFalloffDecision(lightOverrides, phaseFlagOn) {
  const overrides = Array.isArray(lightOverrides) ? lightOverrides : [];
  const perLight = overrides.map((override, index) => {
    const resolved = resolveLightFalloffMode(override, phaseFlagOn);
    return { index, override: override === undefined ? null : override, mode: resolved.mode, source: resolved.source };
  });
  const unrealLights = perLight.filter((light) => light.mode === FALLOFF_MODE.UNREAL).length;
  const legacyLights = perLight.length - unrealLights;
  const on = Boolean(phaseFlagOn) || unrealLights > 0;
  const overruled = on
    ? perLight.filter((light) => light.source === FALLOFF_DECISION_SOURCE.LIGHT_VETOED).map((light) => light.index)
    : perLight.filter((light) => light.source === FALLOFF_DECISION_SOURCE.LIGHT_FORCED).map((light) => light.index);
  return {
    on,
    blend: on ? 1 : 0,
    mode: on ? FALLOFF_MODE.UNREAL : FALLOFF_MODE.LEGACY_THREE,
    unrealLights,
    legacyLights,
    mixed: unrealLights > 0 && legacyLights > 0,
    overruledLights: overruled,
    perLight,
  };
}
