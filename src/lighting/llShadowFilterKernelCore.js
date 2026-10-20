import {
  ENGINE_PCSS_MIN_FILTER_TEXELS,
  clampFilterTexelRadius,
  filterTexelRadiusFor,
  searchTexelRadiusFor,
} from "./llShadowSourceCore.js";


export const GOLDEN_ANGLE_RADIANS = 2.399963229728653;

export const BLOCKER_SEARCH_TAPS = 12;
export const FILTER_TAPS = 16;


export const MAX_SLOPE_DEPTH_PER_TEXEL = 0.01;

function positiveOrZero(value) {
  const number = Number(value);
  return typeof number === "number" && isFinite(number) && number > 0 ? number : 0;
}


export function vogelDiskSample(index, sampleCount) {
  const count = Math.max(1, Math.floor(Number(sampleCount) || 0));
  const tapIndex = Math.max(0, Number(index) || 0);
  const radius = Math.sqrt((tapIndex + 0.5) / count);
  const angle = tapIndex * GOLDEN_ANGLE_RADIANS;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export function vogelDiskSamples(sampleCount) {
  const count = Math.max(1, Math.floor(Number(sampleCount) || 0));
  const samples = [];
  for (let index = 0; index !== count; index++) samples.push(vogelDiskSample(index, count));
  return samples;
}


export function searchBlockerDepth(input) {
  const options = input || {};
  const sampleDepth = typeof options.sampleDepth === "function" ? options.sampleDepth : null;
  const centerUv = options.centerUv || { x: 0, y: 0 };
  const texelSize = options.texelSize || { x: 0, y: 0 };
  const searchTexelRadius = positiveOrZero(options.searchTexelRadius);
  const receiverDepth = Number(options.receiverDepth) || 0;
  const tapCount = Math.max(1, Math.floor(Number(options.tapCount) || BLOCKER_SEARCH_TAPS));
  if (sampleDepth === null || searchTexelRadius <= 0) {
    return Object.freeze({ hasBlocker: false, blockerCount: 0, averageBlockerDepth: 0 });
  }
  let blockerDepthSum = 0;
  let blockerCount = 0;
  for (let tap = 0; tap !== tapCount; tap++) {
    const offset = vogelDiskSample(tap, tapCount);
    const sampledDepth = sampleDepth(
      centerUv.x + offset.x * searchTexelRadius * texelSize.x,
      centerUv.y + offset.y * searchTexelRadius * texelSize.y,
    );
    if (sampledDepth < receiverDepth) {
      blockerDepthSum += sampledDepth;
      blockerCount++;
    }
  }
  return Object.freeze({
    hasBlocker: blockerCount > 0,
    blockerCount: blockerCount,
    averageBlockerDepth: blockerCount > 0 ? blockerDepthSum / blockerCount : 0,
  });
}


export function measureSlopeDepthPerTexel(input) {
  const options = input || {};
  const sampleDepth = typeof options.sampleDepth === "function" ? options.sampleDepth : null;
  const centerUv = options.centerUv || { x: 0, y: 0 };
  const texelSize = options.texelSize || { x: 0, y: 0 };
  if (sampleDepth === null) return 0;
  const right = sampleDepth(centerUv.x + texelSize.x, centerUv.y);
  const left = sampleDepth(centerUv.x - texelSize.x, centerUv.y);
  const up = sampleDepth(centerUv.x, centerUv.y + texelSize.y);
  const down = sampleDepth(centerUv.x, centerUv.y - texelSize.y);
  const slope = Math.max(Math.abs(right - left), Math.abs(up - down)) * 0.5;
  return Math.min(slope, MAX_SLOPE_DEPTH_PER_TEXEL);
}


export function slopeBiasDepth(input) {
  const options = input || {};
  const slopeBias = positiveOrZero(options.slopeBias);
  const slopeDepthPerTexel = positiveOrZero(options.slopeDepthPerTexel);
  const filterTexelRadius = positiveOrZero(options.filterTexelRadius);
  return slopeBias * slopeDepthPerTexel * filterTexelRadius;
}


export function filterVisibility(input) {
  const options = input || {};
  const sampleDepth = typeof options.sampleDepth === "function" ? options.sampleDepth : null;
  const centerUv = options.centerUv || { x: 0, y: 0 };
  const texelSize = options.texelSize || { x: 0, y: 0 };
  const filterTexelRadius = positiveOrZero(options.filterTexelRadius);
  const compareDepth = Number(options.compareDepth) || 0;
  const tapCount = Math.max(1, Math.floor(Number(options.tapCount) || FILTER_TAPS));
  if (sampleDepth === null) return 1;
  let litSum = 0;
  for (let tap = 0; tap !== tapCount; tap++) {
    const offset = vogelDiskSample(tap, tapCount);
    const sampledDepth = sampleDepth(
      centerUv.x + offset.x * filterTexelRadius * texelSize.x,
      centerUv.y + offset.y * filterTexelRadius * texelSize.y,
    );
    litSum += sampledDepth >= compareDepth ? 1 : 0;
  }
  return litSum / tapCount;
}


export function evaluateLocalSoftShadow(input) {
  const options = input || {};
  const sampleDepth = typeof options.sampleDepth === "function" ? options.sampleDepth : null;
  const centerUv = options.centerUv || { x: 0, y: 0 };
  const mapSize = positiveOrZero(options.mapSize);
  const texelSize = options.texelSize || { x: mapSize > 0 ? 1 / mapSize : 0, y: mapSize > 0 ? 1 / mapSize : 0 };
  const receiverDepth = Number(options.receiverDepth) || 0;
  const sourceTexelScale = positiveOrZero(options.sourceTexelScale);
  const slopeBias = positiveOrZero(options.slopeBias);
  const searchTapCount = Math.max(1, Math.floor(Number(options.searchTapCount) || BLOCKER_SEARCH_TAPS));
  const filterTapCount = Math.max(1, Math.floor(Number(options.filterTapCount) || FILTER_TAPS));

  const searchTexelRadius = searchTexelRadiusFor({ sourceTexelScale, receiverDepth, mapSize });
  const blockers = searchBlockerDepth({
    sampleDepth,
    centerUv,
    texelSize,
    searchTexelRadius,
    receiverDepth,
    tapCount: searchTapCount,
  });
  if (!blockers.hasBlocker) {
    return Object.freeze({
      visibility: 1,
      searchTexelRadius,
      filterTexelRadius: 0,
      blockerCount: 0,
      averageBlockerDepth: 0,
      slopeDepthPerTexel: 0,
      tapBias: 0,
    });
  }
  const filterTexelRadius = clampFilterTexelRadius(
    filterTexelRadiusFor({ sourceTexelScale, receiverDepth, blockerDepth: blockers.averageBlockerDepth }),
    mapSize,
  );
  const slopeDepthPerTexel = slopeBias > 0 ? measureSlopeDepthPerTexel({ sampleDepth, centerUv, texelSize }) : 0;
  const tapBias = slopeBiasDepth({ slopeBias, slopeDepthPerTexel, filterTexelRadius });
  return Object.freeze({
    visibility: filterVisibility({
      sampleDepth,
      centerUv,
      texelSize,
      filterTexelRadius,
      compareDepth: receiverDepth - tapBias,
      tapCount: filterTapCount,
    }),
    searchTexelRadius,
    filterTexelRadius,
    blockerCount: blockers.blockerCount,
    averageBlockerDepth: blockers.averageBlockerDepth,
    slopeDepthPerTexel,
    tapBias,
  });
}


export function measureTenToNinetyWidth(input) {
  const options = input || {};
  const visibilityAt = typeof options.visibilityAt === "function" ? options.visibilityAt : null;
  const from = Number(options.from) || 0;
  const to = Number(options.to) || 0;
  const steps = Math.max(2, Math.floor(Number(options.steps) || 256));
  if (visibilityAt === null || to === from) return Object.freeze({ width: 0, atTenPercent: 0, atNinetyPercent: 0 });
  const stepSize = (to - from) / steps;
  let atTenPercent = null;
  let atNinetyPercent = null;
  let previousPosition = from;
  let previousVisibility = visibilityAt(from);
  for (let step = 1; step <= steps; step++) {
    const position = from + stepSize * step;
    const visibility = visibilityAt(position);
    if (atNinetyPercent === null && previousVisibility >= 0.9 && visibility < 0.9) {
      atNinetyPercent = interpolateCrossing(previousPosition, previousVisibility, position, visibility, 0.9);
    }
    if (atTenPercent === null && previousVisibility >= 0.1 && visibility < 0.1) {
      atTenPercent = interpolateCrossing(previousPosition, previousVisibility, position, visibility, 0.1);
    }
    previousPosition = position;
    previousVisibility = visibility;
  }
  if (atTenPercent === null || atNinetyPercent === null) {
    return Object.freeze({ width: 0, atTenPercent: 0, atNinetyPercent: 0 });
  }
  return Object.freeze({
    width: Math.abs(atTenPercent - atNinetyPercent),
    atTenPercent,
    atNinetyPercent,
  });
}

function interpolateCrossing(positionA, valueA, positionB, valueB, level) {
  const span = valueA - valueB;
  if (!(Math.abs(span) > 1e-12)) return positionA;
  return positionA + ((valueA - level) / span) * (positionB - positionA);
}


export const MIN_FILTER_TEXELS = ENGINE_PCSS_MIN_FILTER_TEXELS;
