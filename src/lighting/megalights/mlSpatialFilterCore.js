import { luminanceOf } from "./mlTemporalVarianceCore.js";
import {
  SPATIAL_KERNEL,
  radiusFromRelativeVariance,
  rotationRadiansFor,
  sparseTapOffsets,
} from "./mlSpatialFilterKernelCore.js";
import { combinedTapWeight } from "./mlSpatialFilterWeightCore.js";

export const PIXEL_REFUSAL = Object.freeze({
  none: "none",
  varianceBelowSkipThreshold:
    "the pixel is already clean: blurring it would destroy detail, so it keeps its own radiance",
  noNeighbourReader:
    "no neighbour reader was given, so there is nothing to average and the pixel keeps its own radiance",
  noTapSurvived:
    "every tap was rejected by the edge stopping weights: the pixel sits on a real edge and keeps its own radiance",
});

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}


function radianceOf(value) {
  if (!value || typeof value !== "object") return { r: 0, g: 0, b: 0 };
  return {
    r: finiteNumberOrFallback(value.r, 0),
    g: finiteNumberOrFallback(value.g, 0),
    b: finiteNumberOrFallback(value.b, 0),
  };
}


export function filterOnePixel(request) {
  const input = request || {};
  const centre = input.centre || {};
  const centreRadiance = radianceOf(centre.radiance);
  const centreLuminance = luminanceOf(centreRadiance);
  const relativeVariance = Math.max(0, finiteNumberOrFallback(input.relativeVariance, 0));
  const varianceIsTrusted = input.varianceIsTrusted === true;
  const pixelX = Math.floor(finiteNumberOrFallback(input.pixelX, 0));
  const pixelY = Math.floor(finiteNumberOrFallback(input.pixelY, 0));
  const frameIndex = Math.floor(finiteNumberOrFallback(input.frameIndex, 0));
  const readTap = typeof input.readTap === "function" ? input.readTap : null;

  const result = {
    radiance: centreRadiance,
    radiusInPixels: 0,
    rotationRadians: 0,
    tapsRequested: 0,
    tapsUsed: 0,
    tapsRejected: 0,
    tapsCollapsedOnCentre: 0,
    tapsOutOfFrame: 0,
    weightSum: 1,
    blurred: false,
    varianceIsTrusted,
    relativeVariance,
    edgeStoppingUsedDepth: false,
    edgeStoppingUsedNormal: false,
    luminanceSpread: 0,
    absoluteLuminanceChange: 0,
    refusal: PIXEL_REFUSAL.none,
  };

  if (varianceIsTrusted && SPATIAL_KERNEL.relativeVarianceSkipThreshold > relativeVariance) {
    result.refusal = PIXEL_REFUSAL.varianceBelowSkipThreshold;
    return result;
  }
  if (!readTap) {
    result.refusal = PIXEL_REFUSAL.noNeighbourReader;
    return result;
  }

  const radiusInPixels = radiusFromRelativeVariance({
    relativeVariance,
    varianceIsTrusted,
    maximumRadiusInPixels: input.maximumRadiusInPixels,
  });
  const rotationRadians = rotationRadiansFor(pixelX, pixelY, frameIndex);
  const taps = sparseTapOffsets({ radiusInPixels, rotationRadians });

  result.radiusInPixels = radiusInPixels;
  result.rotationRadians = rotationRadians;
  result.tapsRequested = taps.length;


  const absoluteVariance = relativeVariance * centreLuminance * centreLuminance;

  let weightSum = 1;
  let red = centreRadiance.r;
  let green = centreRadiance.g;
  let blue = centreRadiance.b;
  let minimumLuminance = centreLuminance;
  let maximumLuminance = centreLuminance;

  for (let tapIndex = 0; taps.length > tapIndex; tapIndex += 1) {
    const tap = taps[tapIndex];
    if (tap.offsetX === 0 && tap.offsetY === 0) {
      result.tapsCollapsedOnCentre += 1;
      continue;
    }
    const neighbour = readTap(pixelX + tap.offsetX, pixelY + tap.offsetY);
    if (!neighbour) {
      result.tapsOutOfFrame += 1;
      continue;
    }
    const neighbourRadiance = radianceOf(neighbour.radiance);
    const neighbourLuminance = luminanceOf(neighbourRadiance);
    const weight = combinedTapWeight({
      centreDepth: centre.depth,
      tapDepth: neighbour.depth,
      centreNormal: centre.normal,
      tapNormal: neighbour.normal,
      centreLuminance,
      tapLuminance: neighbourLuminance,
      absoluteVariance,
      radiusInPixels,
    });
    if (weight.depthAvailable) result.edgeStoppingUsedDepth = true;
    if (weight.normalAvailable) result.edgeStoppingUsedNormal = true;
    if (weight.isRejected) {
      result.tapsRejected += 1;
      continue;
    }
    result.tapsUsed += 1;
    weightSum += weight.value;
    red += neighbourRadiance.r * weight.value;
    green += neighbourRadiance.g * weight.value;
    blue += neighbourRadiance.b * weight.value;
    if (neighbourLuminance > maximumLuminance) maximumLuminance = neighbourLuminance;
    if (minimumLuminance > neighbourLuminance) minimumLuminance = neighbourLuminance;
  }

  if (result.tapsUsed === 0) {
    result.refusal = PIXEL_REFUSAL.noTapSurvived;
    return result;
  }

  result.radiance = { r: red / weightSum, g: green / weightSum, b: blue / weightSum };
  result.weightSum = weightSum;
  result.blurred = true;
  result.luminanceSpread = maximumLuminance - minimumLuminance;
  result.absoluteLuminanceChange = Math.abs(luminanceOf(result.radiance) - centreLuminance);
  return result;
}
