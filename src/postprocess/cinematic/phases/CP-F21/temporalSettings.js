import { requireFiniteNumber, validateSize } from "../../contracts/frameContract.js";

export const TEMPORAL_RECONSTRUCTION_OWNER = "CP-F21";
export const TEMPORAL_RECONSTRUCTION_PROFILE = "variance-clipped-temporal-reconstruction-v1";

const defaults = Object.freeze({
  enabled: true,
  mode: "auto",
  screenPercentage: null,
  historyWeight: 0.9,
  motionRejectionPixels: 32,
  depthRelativeThreshold: 0.02,
  depthAbsoluteThresholdMeters: 0.01,
  varianceGamma: 1.5,
  clipping: "variance",
  reconstructionFilter: "catmull-rom",
  historyFilter: "bilinear",
  velocityDilation: true,
  reactiveStrength: 1,
  luminanceRejection: 0.25,
  sharpening: 0,
  resetRevision: 0
});

export function resolveTemporalSettings(value) {
  if (value == null) return defaults;
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("CP-F21 settings require an object or AUTO");
  const settings = { ...defaults };
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(defaults, key)) throw new TypeError(`Unknown CP-F21 setting: ${key}`);
    if (value[key] != null) settings[key] = value[key];
  }
  for (const key of ["enabled", "velocityDilation"]) {
    if (typeof settings[key] !== "boolean") throw new TypeError(`${key} must be boolean`);
  }
  for (const [key, choices] of [
    ["mode", ["auto", "taa", "temporal-upscale"]],
    ["clipping", ["variance", "minmax"]],
    ["reconstructionFilter", ["bilinear", "catmull-rom"]],
    ["historyFilter", ["bilinear", "catmull-rom"]]
  ]) {
    if (!choices.includes(settings[key])) throw new TypeError(`Unsupported CP-F21 ${key}: ${settings[key]}`);
  }
  for (const [key, minimum, maximum] of [
    ["historyWeight", 0, 0.98], ["motionRejectionPixels", 0.01, 4096],
    ["depthRelativeThreshold", 0, 0.5], ["depthAbsoluteThresholdMeters", 0, 100],
    ["varianceGamma", 0, 8], ["reactiveStrength", 0, 1],
    ["luminanceRejection", 0, 1], ["sharpening", 0, 1], ["resetRevision", 0, 0xffffffff]
  ]) requireFiniteNumber(settings[key], `CP-F21 ${key}`, minimum, maximum);
  if (!Number.isSafeInteger(settings.resetRevision)) throw new TypeError("resetRevision must be an unsigned integer");
  if (settings.screenPercentage !== null) requireFiniteNumber(settings.screenPercentage, "screenPercentage", 25, 100);
  return Object.freeze(settings);
}

export function getTemporalRenderSize(outputSize, screenPercentage) {
  validateSize(outputSize, "outputSize");
  requireFiniteNumber(screenPercentage, "screenPercentage", 25, 100);
  return Object.freeze({
    width: Math.max(1, Math.round(outputSize.width * screenPercentage / 100)),
    height: Math.max(1, Math.round(outputSize.height * screenPercentage / 100))
  });
}

export function resolveTemporalExtent(frame, settings, maximumTextureSize) {
  const render = validateSize(frame.renderSize, "renderSize");
  const output = validateSize(frame.outputSize, "outputSize");
  if (output.width > maximumTextureSize || output.height > maximumTextureSize) throw new RangeError("CP-F21 output exceeds the device texture limit");
  if (render.width > output.width || render.height > output.height || output.width > render.width * 4 || output.height > render.height * 4) throw new RangeError("CP-F21 supports native resolution through 4x temporal upscaling, not downsampling");
  if (Math.abs(render.width / output.width - render.height / output.height) > 1 / output.width + 1 / output.height) throw new RangeError("CP-F21 requires a uniform screen percentage, allowing integer rounding");
  const nativeResolution = render.width === output.width && render.height === output.height;
  if (settings.mode === "taa" && !nativeResolution) throw new RangeError("TAA mode requires equal render and output extents");
  if (settings.screenPercentage !== null) {
    const requested = getTemporalRenderSize(output, settings.screenPercentage);
    if (requested.width !== render.width || requested.height !== render.height) throw new Error("CP-F21 screenPercentage disagrees with the host render extent");
  }
  return Object.freeze({
    mode: settings.mode === "auto" ? (nativeResolution ? "taa" : "temporal-upscale") : settings.mode,
    renderSize: Object.freeze({ ...render }),
    outputSize: Object.freeze({ ...output }),
    screenPercentage: Object.freeze([100 * render.width / output.width, 100 * render.height / output.height])
  });
}

export function temporalHistorySettingsKey(settings) {
  return JSON.stringify(Object.entries(settings).filter(([key]) => key !== "sharpening"));
}
