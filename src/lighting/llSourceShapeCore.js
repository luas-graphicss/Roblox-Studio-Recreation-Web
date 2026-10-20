const NUMERIC_EPSILON = 1e-8;
const TANGENT_EPSILON = 1e-5;


export const LL_MAX_SHAPED_LIGHTS = 8;


export const LL_SHAPE_MATCH_TOLERANCE_SQUARED = 1e-6;


export const LL_MAX_SIN_ANGULAR_RADIUS_SQUARED = 0.9999;

export function clampToRange(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function makeVector(x, y, z) {
  return { x: x, y: y, z: z };
}
export function vectorDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function vectorLength(a) {
  return Math.sqrt(vectorDot(a, a));
}
export function vectorSubtract(a, b) {
  return makeVector(a.x - b.x, a.y - b.y, a.z - b.z);
}
export function vectorScale(a, scale) {
  return makeVector(a.x * scale, a.y * scale, a.z * scale);
}
export function vectorAddScaled(a, b, scale) {
  return makeVector(a.x + b.x * scale, a.y + b.y * scale, a.z + b.z * scale);
}
export function vectorNormalize(a) {
  const length = vectorLength(a);
  return length <= NUMERIC_EPSILON ? makeVector(0, 0, 0) : vectorScale(a, 1 / length);
}


export function diffuseSourceRadius({ sourceRadius = 0, softSourceRadius = 0 } = {}) {
  return Math.max(0, sourceRadius) + Math.max(0, softSourceRadius);
}


export function sourceHalfAxis({ axisDirection, sourceLength = 0 }) {
  const halfLength = Math.max(0, sourceLength) * 0.5;
  if (halfLength <= NUMERIC_EPSILON) return makeVector(0, 0, 0);
  return vectorScale(vectorNormalize(axisDirection), halfLength);
}

export function hasSourceShape({ sourceRadius = 0, softSourceRadius = 0, sourceLength = 0 } = {}) {
  return diffuseSourceRadius({ sourceRadius, softSourceRadius }) > 0 || Math.max(0, sourceLength) > 0;
}


export function nearestPointOnSourceSegment({ center, halfAxis, shadingPoint }) {
  const halfAxisLengthSquared = vectorDot(halfAxis, halfAxis);
  if (halfAxisLengthSquared <= NUMERIC_EPSILON) return makeVector(center.x, center.y, center.z);
  const centerToShadingPoint = vectorSubtract(shadingPoint, center);
  const axisParameter = clampToRange(vectorDot(centerToShadingPoint, halfAxis) / halfAxisLengthSquared, -1, 1);
  return vectorAddScaled(center, halfAxis, axisParameter);
}


export function sinAngularRadiusSquared({ sourceRadius = 0, sourceDistance = 0 }) {
  if (sourceRadius <= 0 || sourceDistance <= NUMERIC_EPSILON) return 0;
  const radiusOverDistance = sourceRadius / sourceDistance;
  return Math.min(radiusOverDistance * radiusOverDistance, LL_MAX_SIN_ANGULAR_RADIUS_SQUARED);
}


export function sphereDiffuseCosine({ cosIncidence = 0, sinAngularRadiusSquared: sinSquared = 0 }) {
  const cosine = clampToRange(cosIncidence, -1, 1);
  if (sinSquared <= NUMERIC_EPSILON) return Math.max(0, cosine);

  if (cosine * cosine > sinSquared) return Math.max(0, cosine);
  const sine = Math.sqrt(Math.max(1 - cosine * cosine, NUMERIC_EPSILON));
  const horizonRatio = Math.sqrt(Math.max(1 / sinSquared - 1, 0));
  const clippedCosine = clampToRange(-horizonRatio * (cosine / sine), -1, 1);
  const clippedChord = sine * Math.sqrt(Math.max(1 - clippedCosine * clippedCosine, 0));
  const irradiance =
    (cosine * Math.acos(clippedCosine) - horizonRatio * clippedChord) * sinSquared +
    Math.atan(clippedChord / Math.max(horizonRatio, NUMERIC_EPSILON));
  return clampToRange(Math.max(irradiance, 0) / (Math.PI * sinSquared), 0, 1);
}


export function shapedLightDirection({ shadingNormal, sourceDirection, shapedCosine = 0 }) {
  const cosIncidence = clampToRange(vectorDot(shadingNormal, sourceDirection), -1, 1);
  const tangent = vectorAddScaled(sourceDirection, shadingNormal, -cosIncidence);
  const tangentLength = vectorLength(tangent);
  if (tangentLength <= TANGENT_EPSILON) {
    return makeVector(sourceDirection.x, sourceDirection.y, sourceDirection.z);
  }
  const targetCosine = clampToRange(shapedCosine, 0, 1);
  const targetSine = Math.sqrt(Math.max(1 - targetCosine * targetCosine, 0));
  const tangentDirection = vectorScale(tangent, 1 / tangentLength);
  return vectorNormalize(vectorAddScaled(vectorScale(shadingNormal, targetCosine), tangentDirection, targetSine));
}


export function evaluateSourceShape({ shadingPoint, shadingNormal, sourceCenter, halfAxis, sourceRadius = 0 }) {
  const segmentAxis = halfAxis || makeVector(0, 0, 0);
  const nearestPoint = nearestPointOnSourceSegment({ center: sourceCenter, halfAxis: segmentAxis, shadingPoint });
  const shadingToSource = vectorSubtract(nearestPoint, shadingPoint);
  const sourceDistance = vectorLength(shadingToSource);
  if (sourceDistance <= TANGENT_EPSILON) {
    return { applied: false, direction: makeVector(0, 0, 0), shapedCosine: 0, cosIncidence: 0, sourceDistance, sinAngularRadiusSquared: 0, nearestPoint };
  }
  const sourceDirection = vectorScale(shadingToSource, 1 / sourceDistance);
  const sinSquared = sinAngularRadiusSquared({ sourceRadius, sourceDistance });
  const cosIncidence = clampToRange(vectorDot(shadingNormal, sourceDirection), -1, 1);
  const shapedCosine = sphereDiffuseCosine({ cosIncidence, sinAngularRadiusSquared: sinSquared });
  const direction =
    sinSquared <= NUMERIC_EPSILON ? sourceDirection : shapedLightDirection({ shadingNormal, sourceDirection, shapedCosine });
  return { applied: true, direction, shapedCosine, cosIncidence, sourceDistance, sinAngularRadiusSquared: sinSquared, nearestPoint };
}


export function uniformSphereDirections(sampleCount) {
  const directions = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index !== sampleCount; index++) {
    const z = 1 - (2 * index + 1) / sampleCount;
    const ringRadius = Math.sqrt(Math.max(0, 1 - z * z));
    const angle = goldenAngle * index;
    directions.push(makeVector(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, z));
  }
  return directions;
}


export function sphereDiffuseCosineReference({ cosIncidence = 0, sourceRadius = 0, sourceDistance = 1, sampleCount = 2048 }) {
  const cosine = clampToRange(cosIncidence, -1, 1);
  if (sourceRadius <= 0 || sourceDistance <= NUMERIC_EPSILON) return Math.max(0, cosine);
  const sine = Math.sqrt(Math.max(1 - cosine * cosine, 0));
  const shadingNormal = makeVector(sine, 0, cosine);
  const sourceCenter = makeVector(0, 0, sourceDistance);
  const surfaceDirections = uniformSphereDirections(sampleCount);
  let irradianceSum = 0;
  for (let index = 0; index !== surfaceDirections.length; index++) {
    const surfaceNormal = surfaceDirections[index];
    const surfacePoint = vectorAddScaled(sourceCenter, surfaceNormal, sourceRadius);
    const distanceSquared = vectorDot(surfacePoint, surfacePoint);
    if (distanceSquared <= NUMERIC_EPSILON) continue;
    const distance = Math.sqrt(distanceSquared);
    const direction = vectorScale(surfacePoint, 1 / distance);
    const receiverCosine = vectorDot(shadingNormal, direction);
    const emitterCosine = -vectorDot(direction, surfaceNormal);
    if (receiverCosine <= 0 || emitterCosine <= 0) continue;
    irradianceSum += (receiverCosine * emitterCosine) / distanceSquared;
  }


  return (4 * sourceDistance * sourceDistance * irradianceSum) / sampleCount;
}


export const POINT_LIGHT_ENERGY = 0.25;

export function averageOverUniformNormals(factorForCosine, sampleCount = 2048) {
  let sum = 0;
  for (let index = 0; index !== sampleCount; index++) {
    sum += factorForCosine(-1 + (2 * index + 1) / sampleCount);
  }
  return sum / sampleCount;
}


export function buildSourceShapeReferenceTable({
  sourceDistance = 10,
  radiusRatios = [0.05, 0.1, 0.25, 0.5],
  incidenceSampleCount = 129,
  sphereSampleCount = 1024,
  energySampleCount = 193,
} = {}) {
  return radiusRatios.map((radiusRatio) => {
    const sourceRadius = radiusRatio * sourceDistance;
    const sinSquared = sinAngularRadiusSquared({ sourceRadius, sourceDistance });
    const modelFor = (cosine) => sphereDiffuseCosine({ cosIncidence: cosine, sinAngularRadiusSquared: sinSquared });
    const referenceFor = (cosine) =>
      sphereDiffuseCosineReference({ cosIncidence: cosine, sourceRadius, sourceDistance, sampleCount: sphereSampleCount });
    let absoluteErrorSum = 0;
    let maxAbsoluteError = 0;
    for (let index = 0; index !== incidenceSampleCount; index++) {
      const cosine = -1 + (2 * index) / (incidenceSampleCount - 1);
      const absoluteError = Math.abs(modelFor(cosine) - referenceFor(cosine));
      absoluteErrorSum += absoluteError;
      maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError);
    }
    const modelEnergy = averageOverUniformNormals(modelFor, energySampleCount);
    const referenceEnergy = averageOverUniformNormals(referenceFor, energySampleCount);
    return {
      radiusRatio,
      sourceRadius,
      sourceDistance,
      meanAbsoluteError: absoluteErrorSum / incidenceSampleCount,
      maxAbsoluteError,
      modelEnergy,
      referenceEnergy,
      energyRatioToReference: modelEnergy / referenceEnergy,
      energyRatioToPointLight: modelEnergy / POINT_LIGHT_ENERGY,
    };
  });
}
