export const LEGACY_SPOT_PENUMBRA = 0.4;
export const DEFAULT_OUTER_CONE_ANGLE_DEG = 90;
export const MAX_SPOT_APERTURE_DEG = 178;
export const MIN_SPOT_APERTURE_DEG = 0.1;
export const MIN_CONE_COSINE_SPAN = 1e-6;
export const LEGACY_DISTANCE_DECAY = 2;

const DEGREES_TO_RADIANS = Math.PI / 180;

export function saturate(value) {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

function isFiniteNumber(value) {
  return typeof value === "number" && isFinite(value);
}

export function cosineOfHalfAngle(halfAngleDeg) {
  return Math.cos(halfAngleDeg * DEGREES_TO_RADIANS);
}

function clampSpotAperture(apertureDeg) {
  if (!isFiniteNumber(apertureDeg)) return DEFAULT_OUTER_CONE_ANGLE_DEG;
  return Math.min(Math.max(apertureDeg, MIN_SPOT_APERTURE_DEG), MAX_SPOT_APERTURE_DEG);
}

function hasAuthoredOuterCone(outerConeAngleDeg) {
  return isFiniteNumber(outerConeAngleDeg) && outerConeAngleDeg > 0 && outerConeAngleDeg !== DEFAULT_OUTER_CONE_ANGLE_DEG;
}

function hasAuthoredInnerCone(innerConeAngleDeg) {
  return isFiniteNumber(innerConeAngleDeg) && innerConeAngleDeg > 0;
}


function resolveOuterHalfAngleDeg(apertureDeg, outerConeAngleDeg) {
  const outerAperture = hasAuthoredOuterCone(outerConeAngleDeg) ? Math.min(outerConeAngleDeg, apertureDeg) : apertureDeg;
  return outerAperture / 2;
}


function resolveInnerHalfAngleDeg(outerHalfAngleDeg, innerConeAngleDeg, legacyPenumbra, iesOwnsAngularFalloff) {
  if (iesOwnsAngularFalloff) return outerHalfAngleDeg;
  if (!hasAuthoredInnerCone(innerConeAngleDeg)) return outerHalfAngleDeg * (1 - legacyPenumbra);
  return Math.min(innerConeAngleDeg / 2, outerHalfAngleDeg);
}

function resolveInnerSource(innerConeAngleDeg, iesOwnsAngularFalloff) {
  if (iesOwnsAngularFalloff) return "ies-clip";
  return hasAuthoredInnerCone(innerConeAngleDeg) ? "authored" : "legacy-penumbra";
}


export function resolveSpotCone(authored) {
  const input = authored || {};
  const iesOwnsAngularFalloff = input.iesOwnsAngularFalloff === true;
  const legacyPenumbra = isFiniteNumber(input.legacyPenumbra) ? saturate(input.legacyPenumbra) : LEGACY_SPOT_PENUMBRA;
  const apertureDeg = clampSpotAperture(input.coneAngleDeg);
  const outerHalfAngleDeg = resolveOuterHalfAngleDeg(apertureDeg, input.outerConeAngleDeg);
  const innerHalfAngleDeg = resolveInnerHalfAngleDeg(outerHalfAngleDeg, input.innerConeAngleDeg, legacyPenumbra, iesOwnsAngularFalloff);
  return Object.freeze({
    apertureDeg: apertureDeg,
    outerHalfAngleDeg: outerHalfAngleDeg,
    innerHalfAngleDeg: innerHalfAngleDeg,
    cosOuter: cosineOfHalfAngle(outerHalfAngleDeg),
    cosInner: cosineOfHalfAngle(innerHalfAngleDeg),


    threePenumbra: outerHalfAngleDeg > 0 ? saturate(1 - innerHalfAngleDeg / outerHalfAngleDeg) : 0,
    innerSource: resolveInnerSource(input.innerConeAngleDeg, iesOwnsAngularFalloff),
    iesClip: iesOwnsAngularFalloff,
  });
}


export function spotConeAttenuation(cosTheta, cosInner, cosOuter) {
  const cosineSpan = Math.max(cosInner - cosOuter, MIN_CONE_COSINE_SPAN);
  const ramp = saturate((cosTheta - cosOuter) / cosineSpan);
  return ramp * ramp;
}

export function spotConeAttenuationAtAngle(angleFromAxisDeg, cone) {
  return spotConeAttenuation(cosineOfHalfAngle(angleFromAxisDeg), cone.cosInner, cone.cosOuter);
}

function smoothstepReference(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const ramp = saturate((value - edge0) / (edge1 - edge0));
  return ramp * ramp * (3 - 2 * ramp);
}


export function legacySpotConeAttenuation(cosTheta, cosOuter, cosPenumbra) {
  return smoothstepReference(cosOuter, cosPenumbra, cosTheta);
}

export function legacySpotConeAttenuationAtAngle(angleFromAxisDeg, outerHalfAngleDeg, penumbra) {
  const cosOuter = cosineOfHalfAngle(outerHalfAngleDeg);
  const cosPenumbra = cosineOfHalfAngle(outerHalfAngleDeg * (1 - penumbra));
  return legacySpotConeAttenuation(cosineOfHalfAngle(angleFromAxisDeg), cosOuter, cosPenumbra);
}


export function legacyRadialAttenuation(distance, range, decayExponent) {
  const decay = isFiniteNumber(decayExponent) ? decayExponent : LEGACY_DISTANCE_DECAY;
  const falloff = 1 / Math.max(Math.pow(Math.max(distance, 0), decay), 0.01);
  if (!(range > 0)) return falloff;
  const windowed = saturate(1 - Math.pow(distance / range, 4));
  return falloff * windowed * windowed;
}


export function spotLightAttenuation(terms) {
  const input = terms || {};
  const coneAttenuation = isFiniteNumber(input.coneAttenuation) ? Math.max(input.coneAttenuation, 0) : 0;
  const radialAttenuation = isFiniteNumber(input.radialAttenuation) ? Math.max(input.radialAttenuation, 0) : 0;
  return coneAttenuation * radialAttenuation;
}


export function spotConeGateHalfAngleDeg(cone) {
  return cone && isFiniteNumber(cone.outerHalfAngleDeg) ? cone.outerHalfAngleDeg : 0;
}


export function sampleSpotConeCurve(cone, sampleCount) {
  const count = Math.max(2, Math.floor(sampleCount || 64));
  const maxAngleDeg = cone.outerHalfAngleDeg * 1.25;
  const samples = new Array(count);
  for (let index = 0; index < count; index++) {
    const angleFromAxisDeg = (maxAngleDeg * index) / (count - 1);
    samples[index] = { angleFromAxisDeg: angleFromAxisDeg, attenuation: spotConeAttenuationAtAngle(angleFromAxisDeg, cone) };
  }
  return samples;
}
