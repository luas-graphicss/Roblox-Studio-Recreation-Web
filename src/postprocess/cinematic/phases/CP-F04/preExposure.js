import { requireFiniteVector } from "./colorMatrix.js";
import { resolveWorkingColorSpace } from "./workingColorSpace.js";

export function requirePreExposure(value, label = "preExposure") {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a positive finite number`);
  return value;
}

export function preExposureRatio(source, destination) {
  const ratio = requirePreExposure(destination, "destination preExposure") / requirePreExposure(source, "source preExposure");
  if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(Math.fround(ratio)) || Math.fround(ratio) === 0) throw new RangeError("Pre-exposure ratio is not representable by GPU float32");
  return ratio;
}

export function rescalePreExposure(rgb, source, destination) {
  const scale = preExposureRatio(source, destination);
  return requireFiniteVector(rgb, 3, "Radiance").map((value) => {
    const result = value * scale;
    if (!Number.isFinite(result)) throw new RangeError("Radiance overflow during pre-exposure normalization");
    return result;
  });
}

export function normalizeHistoryRadiance(rgb, previousPreExposure, currentPreExposure) {
  return rescalePreExposure(rgb, previousPreExposure, currentPreExposure);
}

export function normalizeEmissiveRadiance(rgb, currentPreExposure) {
  return rescalePreExposure(rgb, 1, currentPreExposure);
}

export function sceneRadianceForMetering(rgb, currentPreExposure) {
  return rescalePreExposure(rgb, currentPreExposure, 1);
}

export function applyFinalExposure(rgb, currentPreExposure, finalExposure) {
  return rescalePreExposure(rgb, currentPreExposure, finalExposure);
}

export function measureSceneLuminance(rgb, currentPreExposure, workingSpace = "rec709") {
  const radiance = sceneRadianceForMetering(rgb, currentPreExposure);
  const weights = resolveWorkingColorSpace(workingSpace).rgbToXyz.slice(3, 6);
  return Math.max(0, radiance.reduce((sum, channel, index) => sum + channel * weights[index], 0));
}
