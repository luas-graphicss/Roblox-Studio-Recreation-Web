import { diffuseLobeWithoutAlbedo } from "./mlMicrofacetBrdfCore.js";
import {
  color,
  diffuseAlbedoOf,
  diffuseFactorizationFactor,
  factorOutSignal,
  putSignalBack,
} from "./mlAlbedoFactorizationCore.js";

export const CHECKERBOARD_DEFAULTS = Object.freeze({
  width: 8,
  height: 8,
  squareSize: 1,
  brightAlbedo: 0.8,
  darkAlbedo: 0.04,
  incomingRadiance: 1,
  filterRadius: 1,
});


export function checkerboardAlbedoAt(pixelX, pixelY, options) {
  const settings = Object.assign({}, CHECKERBOARD_DEFAULTS, options || {});
  const squareSize = Math.max(1, Math.floor(Number(settings.squareSize) || 1));
  const isBrightSquare =
    (Math.floor(pixelX / squareSize) + Math.floor(pixelY / squareSize)) % 2 === 0;
  const level = isBrightSquare ? Number(settings.brightAlbedo) : Number(settings.darkAlbedo);
  return diffuseAlbedoOf(color(level, level, level), 0);
}

function averageNeighborhood(values, width, height, pixelX, pixelY, radius) {
  let sumRed = 0;
  let sumGreen = 0;
  let sumBlue = 0;
  let count = 0;
  for (let offsetY = -radius; offsetY <= radius; offsetY++) {
    for (let offsetX = -radius; offsetX <= radius; offsetX++) {
      const sampleX = Math.min(width - 1, Math.max(0, pixelX + offsetX));
      const sampleY = Math.min(height - 1, Math.max(0, pixelY + offsetY));
      const sample = values[sampleY * width + sampleX];
      sumRed += sample.r;
      sumGreen += sample.g;
      sumBlue += sample.b;
      count++;
    }
  }
  return color(sumRed / count, sumGreen / count, sumBlue / count);
}

function relativeError(measured, expected) {
  const denominator = Math.max(Math.abs(expected), 1e-6);
  return Math.abs(measured - expected) / denominator;
}

function worstChannelError(measured, expected) {
  return Math.max(
    relativeError(measured.r, expected.r),
    relativeError(measured.g, expected.g),
    relativeError(measured.b, expected.b),
  );
}

function errorSummary(errors) {
  const total = errors.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    maxRelativeAlbedoError: errors.reduce((worst, value) => Math.max(worst, value), 0),
    meanRelativeAlbedoError: errors.length > 0 ? total / errors.length : 0,
  });
}


export function probeAlbedoBleed(request) {
  const settings = Object.assign({}, CHECKERBOARD_DEFAULTS, request || {});
  const width = Math.max(1, Math.floor(Number(settings.width) || 1));
  const height = Math.max(1, Math.floor(Number(settings.height) || 1));
  const filterRadius = Math.max(1, Math.floor(Number(settings.filterRadius) || 1));


  const lightWithoutAlbedo = Number(settings.incomingRadiance) * diffuseLobeWithoutAlbedo();
  const uniformSignal = color(lightWithoutAlbedo, lightWithoutAlbedo, lightWithoutAlbedo);

  const factors = [];
  const finalWithoutFilter = [];
  const signalWithAlbedoFactoredOut = [];

  for (let pixelY = 0; pixelY < height; pixelY++) {
    for (let pixelX = 0; pixelX < width; pixelX++) {
      const factor = diffuseFactorizationFactor(checkerboardAlbedoAt(pixelX, pixelY, settings));
      const groundTruth = putSignalBack(uniformSignal, factor);
      factors.push(factor);
      finalWithoutFilter.push(groundTruth);
      signalWithAlbedoFactoredOut.push(factorOutSignal(groundTruth, factor));
    }
  }

  const factoredOutErrors = [];
  const notFactoredOutErrors = [];

  for (let pixelY = 0; pixelY < height; pixelY++) {
    for (let pixelX = 0; pixelX < width; pixelX++) {
      const pixelIndex = pixelY * width + pixelX;
      const groundTruth = finalWithoutFilter[pixelIndex];

      const filteredFactoredSignal = averageNeighborhood(
        signalWithAlbedoFactoredOut,
        width,
        height,
        pixelX,
        pixelY,
        filterRadius,
      );
      const restored = putSignalBack(filteredFactoredSignal, factors[pixelIndex]);
      factoredOutErrors.push(worstChannelError(restored, groundTruth));

      const filteredWithAlbedoInside = averageNeighborhood(
        finalWithoutFilter,
        width,
        height,
        pixelX,
        pixelY,
        filterRadius,
      );
      notFactoredOutErrors.push(worstChannelError(filteredWithAlbedoInside, groundTruth));
    }
  }

  return {
    width,
    height,
    filterRadius,
    factoredOut: errorSummary(factoredOutErrors),
    notFactoredOut: errorSummary(notFactoredOutErrors),
  };
}

export function describeAlbedoBleedProbe(probeResult) {
  if (!probeResult) return "the checkerboard probe has not run";
  return [
    "filtering the factored signal moved the image by at most " +
      (probeResult.factoredOut.maxRelativeAlbedoError * 100).toFixed(4) +
      "%",
    "filtering with albedo still inside moved it by " +
      (probeResult.notFactoredOut.maxRelativeAlbedoError * 100).toFixed(2) +
      "% - that is the texture the denoiser would have smeared",
  ].join("; ");
}
