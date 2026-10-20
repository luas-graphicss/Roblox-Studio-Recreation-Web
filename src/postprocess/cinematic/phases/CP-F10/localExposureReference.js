import { normalizeLocalExposureSettings } from "./localExposureSettings.js";
import { sceneLogLuminance, resolveLocalBase, calculateLocalGainStops, limitGainToHalfFloat } from "./localExposureMath.js";

function filterAxis(input, width, height, settings, horizontal) {
  const output = new Float64Array(input.length);
  const radius = settings.kernelRadiusPixels;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const center = (row * width + column) * 4;
      const centerLog = input[center + 2];
      let bilateralSum = 0;
      let bilateralWeight = 0;
      let blurredSum = 0;
      let blurredWeight = 0;
      let edgeSpan = input[center + 3];
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleColumn = Math.max(0, Math.min(width - 1, column + (horizontal ? offset : 0)));
        const sampleRow = Math.max(0, Math.min(height - 1, row + (horizontal ? 0 : offset)));
        const sample = (sampleRow * width + sampleColumn) * 4;
        const difference = Math.abs(input[sample + 2] - centerLog);
        const spatialWeight = Math.exp(-0.5 * (offset / settings.spatialSigmaPixels) ** 2);
        const rangeWeight = difference <= settings.edgeThresholdStops ? Math.exp(-0.5 * (difference / settings.rangeSigmaStops) ** 2) : 0;
        bilateralSum += input[sample] * spatialWeight * rangeWeight;
        bilateralWeight += spatialWeight * rangeWeight;
        blurredSum += input[sample + 1] * spatialWeight;
        blurredWeight += spatialWeight;
        edgeSpan = Math.max(edgeSpan, difference, input[sample + 3]);
      }
      output[center] = bilateralSum / bilateralWeight;
      output[center + 1] = blurredSum / blurredWeight;
      output[center + 2] = centerLog;
      output[center + 3] = edgeSpan;
    }
  }
  return output;
}

export function evaluateLocalExposureReference({ pixels, width, height, preExposure = 1, settings: authoredSettings = {} }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !pixels || pixels.length !== width * height * 4) throw new TypeError("CP-F10 requires matching RGBA pixels and positive integer dimensions");
  const settings = normalizeLocalExposureSettings(authoredSettings);
  if (settings.highlightContrastCurve || settings.shadowContrastCurve) throw new Error("CP-F10 reference curves must be resolved with explicit metering before evaluation");
  const logLuminance = new Float64Array(pixels.length);
  for (let index = 0; index < pixels.length; index += 4) {
    if (!Number.isFinite(pixels[index + 3]) || pixels[index + 3] < 0 || pixels[index + 3] > 1) throw new TypeError("CP-F10 alpha must be finite coverage in [0, 1]");
    const luminance = sceneLogLuminance(pixels[index], pixels[index + 1], pixels[index + 2], preExposure);
    logLuminance.set([luminance, luminance, luminance, 0], index);
  }
  const horizontal = filterAxis(logLuminance, width, height, settings, true);
  const base = filterAxis(horizontal, width, height, settings, false);
  const gain = new Float64Array(width * height);
  const color = new Float64Array(pixels.length);
  for (let index = 0; index < pixels.length; index += 4) {
    const centerLog = base[index + 2];
    const localBase = resolveLocalBase(centerLog, base[index], base[index + 1], base[index + 3], settings);
    const rawGain = calculateLocalGainStops(centerLog, localBase, settings);
    gain[index / 4] = limitGainToHalfFloat(rawGain, Math.max(Math.abs(pixels[index]), Math.abs(pixels[index + 1]), Math.abs(pixels[index + 2])));
    const multiplier = 2 ** gain[index / 4];
    color[index] = pixels[index] * multiplier;
    color[index + 1] = pixels[index + 1] * multiplier;
    color[index + 2] = pixels[index + 2] * multiplier;
    color[index + 3] = pixels[index + 3];
  }
  return { color, gain, base, logLuminance };
}
