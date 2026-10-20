export const GRADING_SETTINGS_KEY = "CP-F12.settings";
export const GRADING_LAYERS_KEY = "CP-F12.layers";
export const GRADING_REGIONS = Object.freeze(["global", "shadows", "midtones", "highlights"]);
export const GRADING_CONTROLS = Object.freeze(["saturation", "contrast", "gamma", "gain", "offset"]);

const controlLimits = Object.freeze({ saturation: [0, 4], contrast: [0.05, 4], gamma: [0.05, 4], gain: [0, 16], offset: [-16, 16] });
const defaultRegion = Object.freeze(Object.fromEntries(GRADING_CONTROLS.map((name) => [name, Object.freeze(Array(4).fill(name === "offset" ? 0 : 1))])));

export const DEFAULT_GRADING_SETTINGS = Object.freeze({
  enabled: true,
  whiteBalance: Object.freeze({ mode: "whiteBalance", temperature: 6500, tint: 0 }),
  ranges: Object.freeze({ shadowStart: 0, shadowEnd: 0.09, highlightStart: 0.5, highlightEnd: 1 }),
  ...Object.fromEntries(GRADING_REGIONS.map((region) => [region, defaultRegion]))
});

export function isAutomatic(value) {
  return value === undefined || value === null || value === "AUTO";
}

export function requireFinite(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new TypeError(`${label} must be finite in [${minimum}, ${maximum}]`);
  return value;
}

function requireRecord(value, defaults, label) {
  if (isAutomatic(value)) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} requires an object`);
  for (const key of Object.keys(value)) if (!Object.hasOwn(defaults, key)) throw new TypeError(`Unknown ${label}.${key}`);
  return value;
}

export function normalizeGradingSettings(input) {
  const source = requireRecord(input, DEFAULT_GRADING_SETTINGS, "grading");
  const enabled = isAutomatic(source.enabled) ? true : source.enabled;
  if (typeof enabled !== "boolean") throw new TypeError("grading.enabled requires a boolean");
  const whiteBalanceInput = requireRecord(source.whiteBalance, DEFAULT_GRADING_SETTINGS.whiteBalance, "whiteBalance");
  const mode = isAutomatic(whiteBalanceInput.mode) ? "whiteBalance" : whiteBalanceInput.mode;
  if (!["whiteBalance", "temperature", "disabled"].includes(mode)) throw new TypeError("Unknown white balance mode");
  const temperature = isAutomatic(whiteBalanceInput.temperature) ? 6500 : requireFinite(whiteBalanceInput.temperature, "temperature", 1667, 25000);
  const tint = isAutomatic(whiteBalanceInput.tint) ? 0 : requireFinite(whiteBalanceInput.tint, "tint", -1, 1);
  const rangeInput = requireRecord(source.ranges, DEFAULT_GRADING_SETTINGS.ranges, "ranges");
  const ranges = Object.fromEntries(Object.entries(DEFAULT_GRADING_SETTINGS.ranges).map(([key, fallback]) => [key, isAutomatic(rangeInput[key]) ? fallback : requireFinite(rangeInput[key], key, 0, 65504)]));
  if (!(ranges.shadowStart < ranges.shadowEnd && ranges.shadowEnd <= ranges.highlightStart && ranges.highlightStart < ranges.highlightEnd)) throw new RangeError("Tonal ranges must be ordered and non-overlapping");
  const regions = Object.fromEntries(GRADING_REGIONS.map((region) => {
    const authoredRegion = requireRecord(source[region], defaultRegion, region);
    return [region, Object.freeze(Object.fromEntries(GRADING_CONTROLS.map((control) => {
      const value = isAutomatic(authoredRegion[control]) ? defaultRegion[control] : authoredRegion[control];
      if (!Array.isArray(value) || value.length !== 4) throw new TypeError(`${region}.${control} requires [red, green, blue, master]`);
      const components = value.map((component) => requireFinite(component, `${region}.${control}`, ...controlLimits[control]));
      return [control, Object.freeze(components)];
    })))];
  }));
  return Object.freeze({ enabled, whiteBalance: Object.freeze({ mode, temperature, tint }), ranges: Object.freeze(ranges), ...regions });
}
