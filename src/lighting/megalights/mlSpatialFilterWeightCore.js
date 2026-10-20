export const EDGE_STOPPING = Object.freeze({


  depthToleranceInMeters: 0.05,


  normalPower: 32,

  luminanceSigmaScale: 4,

  luminanceSigmaFloor: 0.001,


  minimumTapWeight: 0.0001,
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isVector3(value) {
  return !!value && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}


export function depthWeightOf(centreDepth, tapDepth, radiusInPixels) {
  if (!isFiniteNumber(centreDepth) || !isFiniteNumber(tapDepth)) {
    return { value: 1, available: false };
  }
  const radius = isFiniteNumber(radiusInPixels) ? Math.max(1, radiusInPixels) : 1;
  const tolerance = EDGE_STOPPING.depthToleranceInMeters * radius;
  return {
    value: Math.exp(-Math.abs(tapDepth - centreDepth) / tolerance),
    available: true,
  };
}


export function normalWeightOf(centreNormal, tapNormal) {
  if (!isVector3(centreNormal) || !isVector3(tapNormal)) {
    return { value: 1, available: false };
  }
  const dot =
    centreNormal.x * tapNormal.x + centreNormal.y * tapNormal.y + centreNormal.z * tapNormal.z;
  return { value: Math.pow(Math.max(0, dot), EDGE_STOPPING.normalPower), available: true };
}


export function luminanceWeightOf(centreLuminance, tapLuminance, absoluteVariance) {
  const centre = isFiniteNumber(centreLuminance) ? centreLuminance : 0;
  const tap = isFiniteNumber(tapLuminance) ? tapLuminance : 0;
  const variance = isFiniteNumber(absoluteVariance) ? Math.max(0, absoluteVariance) : 0;
  const sigma = EDGE_STOPPING.luminanceSigmaScale * Math.sqrt(variance) + EDGE_STOPPING.luminanceSigmaFloor;
  return { value: Math.exp(-Math.abs(tap - centre) / sigma), available: true };
}


export function combinedTapWeight(request) {
  const input = request || {};
  const depth = depthWeightOf(input.centreDepth, input.tapDepth, input.radiusInPixels);
  const normal = normalWeightOf(input.centreNormal, input.tapNormal);
  const luminance = luminanceWeightOf(input.centreLuminance, input.tapLuminance, input.absoluteVariance);
  const value = depth.value * normal.value * luminance.value;
  return {
    value,
    isRejected: EDGE_STOPPING.minimumTapWeight > value,
    depthWeight: depth.value,
    normalWeight: normal.value,
    luminanceWeight: luminance.value,
    depthAvailable: depth.available,
    normalAvailable: normal.available,
  };
}


export function edgeStoppingIsDegraded(weight) {
  return !!weight && weight.depthAvailable === false && weight.normalAvailable === false;
}
