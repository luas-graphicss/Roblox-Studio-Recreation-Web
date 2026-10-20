import { resolveTemporalPixel } from "./mlTemporalFilterCore.js";
import { varianceIsTrusted } from "./mlTemporalVarianceCore.js";

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function incrementCount(countsByKey, key) {
  const name = String(key);
  countsByKey[name] = (countsByKey[name] || 0) + 1;
}


export function resolveTemporalFrame(request) {
  const input = request || {};
  const width = Math.floor(finiteNumberOrFallback(input.width, 0));
  const height = Math.floor(finiteNumberOrFallback(input.height, 0));
  const store = input.historyStore;
  const readCurrentPixel = input.readCurrentPixel;


  if (!(width >= 1 && height >= 1)) {
    throw new Error("resolveTemporalFrame: needs width and height of at least 1 pixel");
  }
  if (!store || typeof store.readTexel !== "function" || typeof store.writeTexel !== "function") {
    throw new Error("resolveTemporalFrame: needs a history store with readTexel and writeTexel");
  }
  if (typeof readCurrentPixel !== "function") {
    throw new Error("resolveTemporalFrame: needs readCurrentPixel(pixelX, pixelY)");
  }

  const frameSize = { width, height };
  const pixelCount = width * height;
  const diffuseVariance = new Array(pixelCount);
  const specularVariance = new Array(pixelCount);
  const accumulatedFrameCounts = new Array(pixelCount);
  const collectedPixels = input.collectPixels === true ? new Array(pixelCount) : null;

  const resolveReasonCounts = {};
  let historyAcceptedPixelCount = 0;
  let trustedVariancePixelCount = 0;
  let acceptedTapCount = 0;
  let diffuseVarianceSum = 0;
  let specularVarianceSum = 0;
  let diffuseRelativeVarianceSum = 0;

  const readHistoryTexel = (tapX, tapY) => store.readTexel(tapX, tapY);

  for (let pixelY = 0; pixelY < height; pixelY++) {
    for (let pixelX = 0; pixelX < width; pixelX++) {
      const sample = readCurrentPixel(pixelX, pixelY) || {};
      const depth = finiteNumberOrFallback(sample.depth, 1);
      const normal = sample.normal || { x: 0, y: 0, z: 1 };

      const resolved = resolveTemporalPixel({
        pixelX,
        pixelY,
        frame: frameSize,
        current: {
          diffuse: sample.diffuse,
          specular: sample.specular,
          depth,
          normal,
        },
        screenVelocity: sample.screenVelocity,
        encodedVelocity: sample.encodedVelocity,
        velocityIsValid: sample.velocityIsValid === undefined ? true : !!sample.velocityIsValid,
        sampleHistory: readHistoryTexel,
      });

      const pixelIndex = pixelY * width + pixelX;
      diffuseVariance[pixelIndex] = resolved.diffuse.variance;
      specularVariance[pixelIndex] = resolved.specular.variance;
      accumulatedFrameCounts[pixelIndex] = resolved.accumulatedFrameCount;
      if (collectedPixels) collectedPixels[pixelIndex] = resolved;

      incrementCount(resolveReasonCounts, resolved.reason);
      if (resolved.historyAccepted) historyAcceptedPixelCount++;
      if (varianceIsTrusted(resolved.accumulatedFrameCount)) trustedVariancePixelCount++;
      acceptedTapCount += finiteNumberOrFallback(resolved.historyWeights.acceptedTapCount, 0);
      diffuseVarianceSum += resolved.diffuse.variance;
      specularVarianceSum += resolved.specular.variance;
      diffuseRelativeVarianceSum += resolved.diffuse.relativeVariance;


      store.writeTexel(pixelX, pixelY, {
        diffuse: resolved.diffuse.radiance,
        specular: resolved.specular.radiance,
        diffuseSecondMoment: resolved.diffuse.secondMoment,
        specularSecondMoment: resolved.specular.secondMoment,
        accumulatedFrameCount: resolved.accumulatedFrameCount,
        depth,
        normal,
      });
    }
  }

  return Object.freeze({
    width,
    height,
    resolvedPixelCount: pixelCount,
    historyAcceptedPixelCount,
    historyRejectedPixelCount: pixelCount - historyAcceptedPixelCount,
    historyAcceptedPixelRatio: pixelCount > 0 ? historyAcceptedPixelCount / pixelCount : 0,
    trustedVariancePixelCount,
    acceptedTapCount,
    resolveReasonCounts: Object.freeze(resolveReasonCounts),
    meanDiffuseVariance: pixelCount > 0 ? diffuseVarianceSum / pixelCount : 0,
    meanSpecularVariance: pixelCount > 0 ? specularVarianceSum / pixelCount : 0,
    meanDiffuseRelativeVariance: pixelCount > 0 ? diffuseRelativeVarianceSum / pixelCount : 0,
    diffuseVariance: Object.freeze(diffuseVariance),
    specularVariance: Object.freeze(specularVariance),
    accumulatedFrameCounts: Object.freeze(accumulatedFrameCounts),
    pixels: collectedPixels ? Object.freeze(collectedPixels) : null,
  });
}
