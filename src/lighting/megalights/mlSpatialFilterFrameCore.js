import { PIXEL_REFUSAL, filterOnePixel } from "./mlSpatialFilterCore.js";
import { SPATIAL_KERNEL, sparseTapSavingRatio } from "./mlSpatialFilterKernelCore.js";


const DISTINCT_ROTATION_SAMPLE_CEILING = 4096;

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function meanOf(total, count) {
  return count > 0 ? total / count : 0;
}


export function filterSpatialFrame(request) {
  const input = request || {};
  const width = Math.max(0, Math.floor(finiteNumberOrFallback(input.width, 0)));
  const height = Math.max(0, Math.floor(finiteNumberOrFallback(input.height, 0)));
  const frameIndex = Math.floor(finiteNumberOrFallback(input.frameIndex, 0));
  const channelName = typeof input.channelName === "string" ? input.channelName : "diffuse";
  const readPixel = typeof input.readPixel === "function" ? input.readPixel : null;
  const relativeVarianceAt =
    typeof input.relativeVarianceAt === "function" ? input.relativeVarianceAt : () => 0;
  const varianceIsTrustedAt =
    typeof input.varianceIsTrustedAt === "function" ? input.varianceIsTrustedAt : () => false;

  const pixelCount = width * height;
  const store = new Float32Array(Math.max(3, pixelCount * 3));
  const distinctRotations = new Set();

  const counters = {
    channelName,
    width,
    height,
    frameIndex,
    pixelCount,
    readPixelCount: 0,
    blurredPixelCount: 0,
    cleanPixelCount: 0,
    edgePixelCount: 0,
    untrustedVariancePixelCount: 0,
    tapsRequestedTotal: 0,
    tapsUsedTotal: 0,
    tapsRejectedTotal: 0,
    tapsOutOfFrameTotal: 0,
    tapsCollapsedOnCentreTotal: 0,
    maximumRadiusUsedInPixels: 0,
    edgeStoppingUsedDepth: false,
    edgeStoppingUsedNormal: false,
  };

  let radiusTotal = 0;
  let luminanceSpreadTotal = 0;
  let luminanceChangeTotal = 0;

  function readTapInsideFrame(pixelX, pixelY) {
    if (!readPixel) return null;
    if (pixelX > width - 1 || pixelY > height - 1) return null;
    if (0 > pixelX || 0 > pixelY) return null;
    return readPixel(pixelX, pixelY);
  }

  for (let pixelY = 0; height > pixelY; pixelY += 1) {
    for (let pixelX = 0; width > pixelX; pixelX += 1) {
      const centre = readPixel ? readPixel(pixelX, pixelY) : null;
      const storeIndex = (pixelY * width + pixelX) * 3;
      if (!centre) {
        store[storeIndex] = 0;
        store[storeIndex + 1] = 0;
        store[storeIndex + 2] = 0;
        continue;
      }
      counters.readPixelCount += 1;

      const varianceIsTrusted = varianceIsTrustedAt(pixelX, pixelY) === true;
      if (!varianceIsTrusted) counters.untrustedVariancePixelCount += 1;

      const filtered = filterOnePixel({
        pixelX,
        pixelY,
        frameIndex,
        centre,
        relativeVariance: relativeVarianceAt(pixelX, pixelY),
        varianceIsTrusted,
        maximumRadiusInPixels: input.maximumRadiusInPixels,
        readTap: readTapInsideFrame,
      });

      store[storeIndex] = filtered.radiance.r;
      store[storeIndex + 1] = filtered.radiance.g;
      store[storeIndex + 2] = filtered.radiance.b;

      counters.tapsRequestedTotal += filtered.tapsRequested;
      counters.tapsUsedTotal += filtered.tapsUsed;
      counters.tapsRejectedTotal += filtered.tapsRejected;
      counters.tapsOutOfFrameTotal += filtered.tapsOutOfFrame;
      counters.tapsCollapsedOnCentreTotal += filtered.tapsCollapsedOnCentre;
      if (filtered.edgeStoppingUsedDepth) counters.edgeStoppingUsedDepth = true;
      if (filtered.edgeStoppingUsedNormal) counters.edgeStoppingUsedNormal = true;
      if (filtered.radiusInPixels > counters.maximumRadiusUsedInPixels) {
        counters.maximumRadiusUsedInPixels = filtered.radiusInPixels;
      }
      radiusTotal += filtered.radiusInPixels;

      if (DISTINCT_ROTATION_SAMPLE_CEILING > distinctRotations.size) {
        distinctRotations.add(Math.round(filtered.rotationRadians * 1000));
      }

      if (filtered.blurred) {
        counters.blurredPixelCount += 1;
        luminanceSpreadTotal += filtered.luminanceSpread;
        luminanceChangeTotal += filtered.absoluteLuminanceChange;
      } else if (filtered.refusal === PIXEL_REFUSAL.varianceBelowSkipThreshold) {
        counters.cleanPixelCount += 1;
      } else if (filtered.refusal === PIXEL_REFUSAL.noTapSurvived) {
        counters.edgePixelCount += 1;
      }
    }
  }

  const tapsPerPixel = meanOf(counters.tapsRequestedTotal, counters.readPixelCount);

  return Object.assign(counters, {
    meanRadiusInPixels: meanOf(radiusTotal, counters.readPixelCount),
    meanTapsRequestedPerPixel: tapsPerPixel,
    meanTapsUsedPerPixel: meanOf(counters.tapsUsedTotal, counters.readPixelCount),
    meanLuminanceSpread: meanOf(luminanceSpreadTotal, counters.blurredPixelCount),
    meanAbsoluteLuminanceChange: meanOf(luminanceChangeTotal, counters.blurredPixelCount),
    distinctRotationCount: distinctRotations.size,
    sparseTapCountPerPixel: SPATIAL_KERNEL.tapCount,
    denseEquivalentTapCount: SPATIAL_KERNEL.denseEquivalentTapCount,
    tapSavingRatioVersusDenseKernel: sparseTapSavingRatio(SPATIAL_KERNEL.tapCount),


    readFilteredTexel(pixelX, pixelY) {
      const x = Math.floor(finiteNumberOrFallback(pixelX, -1));
      const y = Math.floor(finiteNumberOrFallback(pixelY, -1));
      if (0 > x || 0 > y || x > width - 1 || y > height - 1) return null;
      const storeIndex = (y * width + x) * 3;
      return { r: store[storeIndex], g: store[storeIndex + 1], b: store[storeIndex + 2] };
    },
  });
}
