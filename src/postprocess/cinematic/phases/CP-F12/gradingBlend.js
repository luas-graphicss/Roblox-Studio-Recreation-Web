import { GRADING_CONTROLS, GRADING_REGIONS, isAutomatic, normalizeGradingSettings, requireFinite } from "./gradingSettings.js";

const settingPaths = Object.freeze([
  "enabled", "whiteBalance.mode", "whiteBalance.temperature", "whiteBalance.tint",
  "ranges.shadowStart", "ranges.shadowEnd", "ranges.highlightStart", "ranges.highlightEnd",
  ...GRADING_REGIONS.flatMap((region) => GRADING_CONTROLS.map((control) => `${region}.${control}`))
]);

function readPath(settings, path) {
  return path.split(".").reduce((value, key) => value?.[key], settings);
}

function writePath(settings, path, value) {
  const [group, field] = path.split(".");
  if (field) settings[group][field] = value;
  else settings[group] = value;
}

function blendValue(previous, next, weight) {
  if (weight === 0) return previous;
  if (weight === 1) return next;
  if (Array.isArray(previous)) return previous.map((component, index) => component + (next[index] - component) * weight);
  if (typeof previous === "number") return previous + (next - previous) * weight;
  return weight >= 0.5 ? next : previous;
}

export function resolveGradingLayers(base, layers = []) {
  if (!Array.isArray(layers)) throw new TypeError("Grading layers must be an ordered array");
  let resolved = normalizeGradingSettings(base);
  for (const layer of layers) {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) throw new TypeError("Invalid grading layer");
    if (layer.enabled !== undefined && typeof layer.enabled !== "boolean") throw new TypeError("Layer enabled requires a boolean");
    const weight = requireFinite(layer.weight, "Layer weight", 0, 1);
    if (layer.enabled === false || weight === 0) continue;
    if (!layer.overrides || typeof layer.overrides !== "object" || Array.isArray(layer.overrides)) throw new TypeError("Layer requires explicit property overrides");
    const authored = structuredClone(resolved);
    const activePaths = [];
    for (const [path, overridden] of Object.entries(layer.overrides)) {
      if (!settingPaths.includes(path) || typeof overridden !== "boolean") throw new TypeError(`Invalid grading override: ${path}`);
      const value = readPath(layer.settings, path);
      if (!overridden || isAutomatic(value)) continue;
      writePath(authored, path, value);
      activePaths.push(path);
    }
    const target = normalizeGradingSettings(authored);
    const blended = structuredClone(resolved);
    for (const path of activePaths) writePath(blended, path, blendValue(readPath(resolved, path), readPath(target, path), weight));
    resolved = normalizeGradingSettings(blended);
  }
  return resolved;
}
