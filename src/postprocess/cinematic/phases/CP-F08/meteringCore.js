import { resolveMeteringSettings, validatePreExposure } from "./meteringSettings.js";
import { HISTOGRAM_BIN_COUNT, histogramBinIndex, reduceHistogramPercentiles } from "./histogramCore.js";
import { resolveManualEv100 } from "./physicalExposure.js";

export function meterPixels({ pixels, width, height, mask = null, preExposure = 1, settings: input, camera = null }) {
  const settings = resolveMeteringSettings(input);
  validatePreExposure(preExposure);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels?.length !== width * height * 4) {
    throw new TypeError("CP-F08 pixels must be a complete RGBA image with positive integer dimensions");
  }
  if (mask !== null && mask.length !== width * height) throw new TypeError("CP-F08 mask must contain one weight per pixel");
  const bins = new Float64Array(HISTOGRAM_BIN_COUNT);
  const histogramAvailable = settings.mode !== "manual" && (settings.mode === "histogram" || settings.debugHistogram);
  let weightedLogSum = 0;
  let totalWeight = 0;
  let invalidPixelCount = 0;
  let blackWeight = 0;
  if (settings.mode !== "manual") {
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const maskWeight = mask === null ? 1 : mask[index];
      if (![red, green, blue, maskWeight].every(Number.isFinite)) { invalidPixelCount += 1; continue; }
      const weight = Math.max(0, Math.min(1, maskWeight));
      const luminance = 0.2126 * Math.max(0, red) + 0.7152 * Math.max(0, green) + 0.0722 * Math.max(0, blue);
      const logLuminance = luminance > 0 ? Math.max(Math.log2(settings.minimumLuminance), Math.log2(luminance) - Math.log2(preExposure)) : Math.log2(settings.minimumLuminance);
      totalWeight += weight;
      weightedLogSum += weight * logLuminance;
      if (luminance === 0) blackWeight += weight;
      if (histogramAvailable) bins[histogramBinIndex(logLuminance, settings.histogramMinLog2, settings.histogramMaxLog2)] += weight;
    }
  }
  const histogram = reduceHistogramPercentiles(bins, settings);
  const emptyMask = totalWeight === 0 && settings.mode !== "manual";
  let meanLog2 = settings.mode === "histogram" ? histogram.meanLog2 : totalWeight > 0 ? weightedLogSum / totalWeight : null;
  if (meanLog2 === null) meanLog2 = Math.log2(settings.middleGray);
  let targetEv100 = Math.max(settings.minimumEv100, Math.min(settings.maximumEv100, meanLog2 + Math.log2(100 / settings.luminanceCalibration)));
  let targetExposure = settings.middleGray / ((settings.luminanceCalibration / 100) * 2 ** targetEv100);
  if (emptyMask) { targetEv100 = Math.log2(settings.middleGray * 100 / settings.luminanceCalibration); targetExposure = 1; }
  if (settings.mode === "manual") {
    targetEv100 = resolveManualEv100(settings, camera);
    targetExposure = 2 ** -targetEv100 / settings.manualExposureCalibration;
    meanLog2 = Math.log2(settings.middleGray / targetExposure);
  }
  return { mode: settings.mode, meanLog2, averageLuminance: 2 ** meanLog2, targetEv100, targetExposure, totalWeight, weightedLogSum, invalidPixelCount, blackWeight, histogramAvailable, bins, selectedWeight: histogram.selectedWeight, emptyMask };
}
