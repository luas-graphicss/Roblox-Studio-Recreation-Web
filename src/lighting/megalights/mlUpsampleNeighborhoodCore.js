import { MGL_DOWNSAMPLE_MODES } from "./mlPipelineContract.js";

export const UPSAMPLE_NEIGHBOR_COUNT = 4;


export const UPSAMPLE_NEIGHBOR_OFFSETS = Object.freeze([
  Object.freeze({ offsetX: 0, offsetY: 0 }),
  Object.freeze({ offsetX: 1, offsetY: 0 }),
  Object.freeze({ offsetX: 0, offsetY: 1 }),
  Object.freeze({ offsetX: 1, offsetY: 1 }),
]);

function clampToRange(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sanitizeDownsampleFactor(downsampleFactor) {
  const factor = Math.floor(Number(downsampleFactor));
  return Number.isFinite(factor) && factor >= 1 ? factor : 1;
}

function sanitizeSize(value) {
  const size = Math.floor(Number(value));
  return Number.isFinite(size) && size >= 0 ? size : 0;
}


export function supportedDownsampleFactors() {
  return Object.keys(MGL_DOWNSAMPLE_MODES)
    .map((modeName) => Number(MGL_DOWNSAMPLE_MODES[modeName].factor))
    .filter((factor) => Number.isFinite(factor));
}


export function downsampledResolution(request) {
  const settings = request || {};
  const downsampleFactor = sanitizeDownsampleFactor(settings.downsampleFactor);
  const fullWidth = sanitizeSize(settings.fullWidth);
  const fullHeight = sanitizeSize(settings.fullHeight);
  return {
    downsampleFactor,
    fullWidth,
    fullHeight,
    width: Math.ceil(fullWidth / downsampleFactor),
    height: Math.ceil(fullHeight / downsampleFactor),
  };
}

function nearestNeighborIndexOf(neighbors) {
  let bestIndex = -1;
  let bestWeight = -1;
  neighbors.forEach((neighbor) => {
    if (!neighbor.isInsideBuffer) return;
    if (neighbor.bilinearWeight > bestWeight) {
      bestWeight = neighbor.bilinearWeight;
      bestIndex = neighbor.index;
    }
  });
  return bestIndex;
}


export function downsampledFootprint(request) {
  const settings = request || {};
  const downsampleFactor = sanitizeDownsampleFactor(settings.downsampleFactor);
  const downsampledWidth = sanitizeSize(settings.downsampledWidth);
  const downsampledHeight = sanitizeSize(settings.downsampledHeight);
  const pixelX = Math.floor(Number(settings.pixelX) || 0);
  const pixelY = Math.floor(Number(settings.pixelY) || 0);
  const isEmptyBuffer = !(downsampledWidth >= 1 && downsampledHeight >= 1);

  const sampleSpaceX = (pixelX + 0.5) / downsampleFactor - 0.5;
  const sampleSpaceY = (pixelY + 0.5) / downsampleFactor - 0.5;
  const baseX = Math.floor(sampleSpaceX);
  const baseY = Math.floor(sampleSpaceY);
  const fractionX = sampleSpaceX - baseX;
  const fractionY = sampleSpaceY - baseY;

  const neighbors = [];
  let bilinearWeightSum = 0;
  let clampedNeighborCount = 0;

  UPSAMPLE_NEIGHBOR_OFFSETS.forEach((offset, index) => {
    const unclampedX = baseX + offset.offsetX;
    const unclampedY = baseY + offset.offsetY;
    const x = isEmptyBuffer ? -1 : clampToRange(unclampedX, 0, downsampledWidth - 1);
    const y = isEmptyBuffer ? -1 : clampToRange(unclampedY, 0, downsampledHeight - 1);
    const weightX = offset.offsetX === 1 ? fractionX : 1 - fractionX;
    const weightY = offset.offsetY === 1 ? fractionY : 1 - fractionY;
    const bilinearWeight = weightX * weightY;
    const isClamped = !isEmptyBuffer && (x !== unclampedX || y !== unclampedY);
    if (isClamped) clampedNeighborCount++;
    bilinearWeightSum += bilinearWeight;
    neighbors.push({
      index,
      x,
      y,
      offsetX: offset.offsetX,
      offsetY: offset.offsetY,
      bilinearWeight,
      isClamped,
      isInsideBuffer: !isEmptyBuffer,
    });
  });

  return {
    downsampleFactor,
    downsampledWidth,
    downsampledHeight,
    isEmptyBuffer,
    pixelX,
    pixelY,
    sampleSpaceX,
    sampleSpaceY,
    fractionX,
    fractionY,
    neighbors,
    bilinearWeightSum,
    clampedNeighborCount,
    nearestNeighborIndex: nearestNeighborIndexOf(neighbors),
  };
}


export function nearestNeighborOf(footprint) {
  if (!footprint || footprint.nearestNeighborIndex === -1) return null;
  return footprint.neighbors[footprint.nearestNeighborIndex] || null;
}


export function fullResolutionPixelOfTap(request) {
  const settings = request || {};
  const downsampleFactor = sanitizeDownsampleFactor(settings.downsampleFactor);
  const half = Math.floor(downsampleFactor / 2);
  const fullWidth = sanitizeSize(settings.fullWidth);
  const fullHeight = sanitizeSize(settings.fullHeight);
  const x = Math.floor(Number(settings.tapX) || 0) * downsampleFactor + half;
  const y = Math.floor(Number(settings.tapY) || 0) * downsampleFactor + half;
  return {
    x: fullWidth >= 1 ? clampToRange(x, 0, fullWidth - 1) : x,
    y: fullHeight >= 1 ? clampToRange(y, 0, fullHeight - 1) : y,
  };
}
