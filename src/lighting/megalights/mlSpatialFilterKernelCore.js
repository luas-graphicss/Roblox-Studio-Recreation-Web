export const SPATIAL_FILTER_PHASE_ID = "ML-F21";
export const SPATIAL_FILTER_PASS_NAME = "spatialFilter";

const TWO_PI = Math.PI * 2;

export const SPATIAL_KERNEL = Object.freeze({

  tapCount: 8,

  denseEquivalentTapCount: 25,
  minimumRadiusInPixels: 1,
  maximumRadiusInPixels: 8,


  maximumSpecularRadiusInPixels: 3,

  goldenAngleRadians: 2.399963229728653,

  relativeVarianceAtMaximumRadius: 0.25,

  relativeVarianceSkipThreshold: 0.0001,
});

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampUnitScalar(value) {
  if (value > 1) return 1;
  if (value > 0) return value;
  return 0;
}


export function hashedUnitScalar(pixelX, pixelY, frameIndex) {
  let hash = Math.imul(pixelX | 0, 0x27d4eb2d);
  hash ^= Math.imul(pixelY | 0, 0x165667b1);
  hash ^= Math.imul(frameIndex | 0, 0x9e3779b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296;
}


export function rotationRadiansFor(pixelX, pixelY, frameIndex) {
  return hashedUnitScalar(pixelX, pixelY, frameIndex) * TWO_PI;
}


export function radiusFromRelativeVariance(request) {
  const input = request || {};
  const maximumRadius = finiteNumberOrFallback(
    input.maximumRadiusInPixels,
    SPATIAL_KERNEL.maximumRadiusInPixels,
  );
  const minimumRadius = Math.min(SPATIAL_KERNEL.minimumRadiusInPixels, maximumRadius);
  if (input.varianceIsTrusted !== true) return maximumRadius;
  const noiseRatio = clampUnitScalar(
    finiteNumberOrFallback(input.relativeVariance, 0) / SPATIAL_KERNEL.relativeVarianceAtMaximumRadius,
  );
  return minimumRadius + (maximumRadius - minimumRadius) * noiseRatio;
}


export function sparseTapOffsets(request) {
  const input = request || {};
  const radiusInPixels = Math.max(0, finiteNumberOrFallback(input.radiusInPixels, 0));
  const rotationRadians = finiteNumberOrFallback(input.rotationRadians, 0);
  const tapCount = Math.max(1, Math.floor(finiteNumberOrFallback(input.tapCount, SPATIAL_KERNEL.tapCount)));

  const taps = [];
  for (let tapIndex = 0; tapCount > tapIndex; tapIndex += 1) {
    const angleRadians = rotationRadians + tapIndex * SPATIAL_KERNEL.goldenAngleRadians;

    const distanceInPixels = radiusInPixels * Math.sqrt((tapIndex + 0.5) / tapCount);
    taps.push({
      offsetX: Math.round(Math.cos(angleRadians) * distanceInPixels),
      offsetY: Math.round(Math.sin(angleRadians) * distanceInPixels),
      distanceInPixels,
      angleRadians,
    });
  }
  return taps;
}


export function sparseTapSavingRatio(tapCount) {
  const taps = Math.max(1, Math.floor(finiteNumberOrFallback(tapCount, SPATIAL_KERNEL.tapCount)));
  return 1 - taps / SPATIAL_KERNEL.denseEquivalentTapCount;
}


export function describeSpatialKernel() {
  return {
    tapCount: SPATIAL_KERNEL.tapCount,
    denseEquivalentTapCount: SPATIAL_KERNEL.denseEquivalentTapCount,
    tapSavingRatio: sparseTapSavingRatio(SPATIAL_KERNEL.tapCount),
    minimumRadiusInPixels: SPATIAL_KERNEL.minimumRadiusInPixels,
    maximumRadiusInPixels: SPATIAL_KERNEL.maximumRadiusInPixels,
    maximumSpecularRadiusInPixels: SPATIAL_KERNEL.maximumSpecularRadiusInPixels,
    rotatedPerPixel: true,
    rotatedPerFrame: true,
    drivenBy: "relative variance of ML-F20, never absolute variance",
  };
}
