export const CONVOLUTION_OWNER = "CP-F15";
export const CONVOLUTION_SETTING_KEY = "CP-F15";
export const CONVOLUTION_BATCH_SIZE = 32;

export const DEFAULT_CONVOLUTION_SETTINGS = Object.freeze({
  enabled: false,
  intensity: 1,
  center: Object.freeze([0.5, 0.5]),
  scale: 1,
  anamorphicRatio: 1,
  bufferScale: 0,
  resolutionScale: 1,
  normalization: "luminance",
  threshold: 0,
  softKnee: 0,
  prefilterMinimum: 0,
  prefilterMaximum: 64,
  prefilterMultiplier: 1,
  maxTargetBytes: 67108864,
  maxSampleOperations: 268435456,
  kernel: null
});

export function finiteNumber(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be finite in [${minimum}, ${maximum}]`);
  }
  return value;
}

export function resolveConvolutionSettings(input = null) {
  if (input !== null && (typeof input !== "object" || Array.isArray(input))) throw new TypeError("CP-F15 settings require an object or null");
  const options = {};
  for (const key of Object.keys(input ?? {})) if (!(key in DEFAULT_CONVOLUTION_SETTINGS)) throw new TypeError(`Unknown CP-F15 setting: ${key}`);
  for (const [key, fallback] of Object.entries(DEFAULT_CONVOLUTION_SETTINGS)) options[key] = input?.[key] ?? fallback;
  if (typeof options.enabled !== "boolean") throw new TypeError("enabled must be boolean");
  for (const [key, minimum, maximum] of [
    ["intensity", 0, 64], ["scale", 0.0625, 64], ["anamorphicRatio", 0.0625, 16],
    ["bufferScale", 0, 2], ["resolutionScale", 0.25, 1], ["threshold", 0, 65504],
    ["softKnee", 0, 65504], ["prefilterMinimum", 0, 65504], ["prefilterMaximum", 0, 65504],
    ["prefilterMultiplier", 0, 64], ["maxTargetBytes", 1, 1073741824], ["maxSampleOperations", 1, 2147483647]
  ]) finiteNumber(options[key], key, minimum, maximum);
  if (options.prefilterMaximum < options.prefilterMinimum) throw new TypeError("prefilterMaximum must not precede prefilterMinimum");
  if (!Array.isArray(options.center) || options.center.length !== 2) throw new TypeError("center requires two normalized coordinates");
  options.center = Object.freeze(options.center.map((value) => finiteNumber(value, "center", 0, 1)));
  if (!["luminance", "per-channel", "none"].includes(options.normalization)) throw new TypeError("Unknown kernel normalization");
  return Object.freeze(options);
}

export function describeStandardBloomFallback(reason) {
  return Object.freeze({ phase: "CP-F14", equivalentToConvolution: false, automatic: false, requiresExplicitHostSelection: true, reason });
}
