export const MIN_ALPHA = 1e-4;
export const MIN_DISTANCE = 1e-4;
export const MIN_DENOMINATOR = 1e-6;

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function addScaled(a, b, factorOfB) {
  return [a[0] + b[0] * factorOfB, a[1] + b[1] * factorOfB, a[2] + b[2] * factorOfB];
}

function scaled(a, factor) {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function magnitude(a) {
  return Math.sqrt(dot(a, a));
}

export function clampTo01(value) {
  return Math.min(1, Math.max(0, value));
}

export function normalizeDirection(direction) {
  return scaled(direction, 1 / Math.max(magnitude(direction), MIN_DISTANCE));
}


export function roughnessToAlpha(roughness) {
  return Math.max(roughness * roughness, MIN_ALPHA);
}

export function alphaToRoughness(alpha) {
  return Math.sqrt(clampTo01(alpha));
}


export function widenAlpha(alpha, sourceSize, distanceToSource) {
  const safeDistance = Math.max(distanceToSource, MIN_DISTANCE);
  return Math.min(1, Math.max(alpha, alpha + Math.max(sourceSize, 0) / (2 * safeDistance)));
}


export function sphereNormalization(alpha, alphaWidenedByRadius) {
  const ratio = Math.min(1, alpha / Math.max(alphaWidenedByRadius, MIN_ALPHA));
  return ratio * ratio;
}


export function tubeNormalization(alpha, alphaWidenedByHalfLength) {
  return Math.min(1, alpha / Math.max(alphaWidenedByHalfLength, MIN_ALPHA));
}


export function segmentFalloffCompensation(distanceToLightCenter, distanceToSegment) {
  const ratio = Math.max(distanceToLightCenter, MIN_DISTANCE) / Math.max(distanceToSegment, MIN_DISTANCE);
  return ratio * ratio;
}


export function closestPointOnSegmentToRay(segmentStart, segmentDelta, rayDirection) {
  const rayDotDelta = dot(rayDirection, segmentDelta);
  const denominator = dot(segmentDelta, segmentDelta) - rayDotDelta * rayDotDelta;
  if (denominator > MIN_DENOMINATOR) {
    const numerator = dot(rayDirection, segmentStart) * rayDotDelta - dot(segmentStart, segmentDelta);
    return addScaled(segmentStart, segmentDelta, clampTo01(numerator / denominator));
  }
  return segmentStart.slice();
}


export function closestPointOnSegmentToShadingPoint(segmentStart, segmentDelta) {
  const segmentLengthSquared = dot(segmentDelta, segmentDelta);
  if (segmentLengthSquared > MIN_DENOMINATOR) {
    const travel = clampTo01(-dot(segmentStart, segmentDelta) / segmentLengthSquared);
    return addScaled(segmentStart, segmentDelta, travel);
  }
  return segmentStart.slice();
}


export function closestPointOnSphereToRay(sphereCenter, sphereRadius, rayDirection) {
  const centerToRay = subtract(scaled(rayDirection, dot(sphereCenter, rayDirection)), sphereCenter);
  const centerToRayLength = Math.max(magnitude(centerToRay), MIN_DISTANCE);
  return addScaled(sphereCenter, centerToRay, clampTo01(sphereRadius / centerToRayLength));
}


export function horizonFadeFactor(normalDotLightCenter, sinAngularRadius) {
  const span = Math.max(2 * sinAngularRadius, MIN_DENOMINATOR);
  return clampTo01((normalDotLightCenter + sinAngularRadius) / span);
}


export function computeAreaSpecularSample(input) {
  const sourceRadius = Math.max(input.sourceRadius || 0, 0);
  const halfSourceLength = Math.max(input.sourceLength || 0, 0) / 2;

  const lightVector = subtract(input.lightPosition, input.shadingPosition);
  const distanceToLightCenter = Math.max(magnitude(lightVector), MIN_DISTANCE);


  const reflectionDirection = addScaled(
    scaled(input.viewDirection, -1),
    input.surfaceNormal,
    2 * dot(input.surfaceNormal, input.viewDirection)
  );

  const halfSegment = scaled(normalizeDirection(input.capsuleAxis), halfSourceLength);
  const segmentStart = subtract(lightVector, halfSegment);
  const segmentDelta = scaled(halfSegment, 2);


  const closestOnSegmentToRay = closestPointOnSegmentToRay(segmentStart, segmentDelta, reflectionDirection);
  const closestPoint = closestPointOnSphereToRay(closestOnSegmentToRay, sourceRadius, reflectionDirection);
  const distanceToClosestPoint = Math.max(magnitude(closestPoint), MIN_DISTANCE);
  const direction = scaled(closestPoint, 1 / distanceToClosestPoint);


  const closestOnSegment = closestPointOnSegmentToShadingPoint(segmentStart, segmentDelta);
  const distanceToSegment = Math.max(magnitude(closestOnSegment), MIN_DISTANCE);

  const alpha = roughnessToAlpha(input.roughness);
  const alphaWidenedByRadius = widenAlpha(alpha, sourceRadius, distanceToLightCenter);
  const alphaWidenedByHalfLength = widenAlpha(alpha, halfSourceLength, distanceToSegment);

  const radiusNormalization = sphereNormalization(alpha, alphaWidenedByRadius);
  const lengthNormalization = tubeNormalization(alpha, alphaWidenedByHalfLength);
  const falloffCompensation = segmentFalloffCompensation(distanceToLightCenter, distanceToSegment);

  const sinAngularRadius = clampTo01((sourceRadius + halfSourceLength) / distanceToLightCenter);
  const normalDotLightCenter = dot(input.surfaceNormal, scaled(lightVector, 1 / distanceToLightCenter));
  const horizonFade = horizonFadeFactor(normalDotLightCenter, sinAngularRadius);

  return {
    direction,
    distanceToClosestPoint,
    distanceToLightCenter,
    distanceToSegment,


    lobeRoughness: input.roughness,
    sphereNormalization: radiusNormalization,
    tubeNormalization: lengthNormalization,
    segmentFalloffCompensation: falloffCompensation,
    horizonFade,
    specularWeight: radiusNormalization * lengthNormalization * falloffCompensation * horizonFade,
  };
}
