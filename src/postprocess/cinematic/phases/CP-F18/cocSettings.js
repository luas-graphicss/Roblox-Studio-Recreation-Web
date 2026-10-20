import { COC_BINDINGS_KEY, COC_LIMITS, COC_SETTINGS_KEY } from "./cocContract.js";
import { requireChoice, requireNumber, requireRecord, resolveCropRectangle } from "./cocValidation.js";

export const DEFAULT_COC_SETTINGS = Object.freeze({
  enabled: true,
  maxRadiusOutputPixels: 32,
  downsampleFactor: 2,
  tileSize: 8,
  focusThresholdOutputPixels: 0.5,
  smallRadiusOutputPixels: 4,
  skyPolicy: "infinity",
  alphaMode: "straight",
  outputCropUv: null
});

const DEFAULT_BINDINGS = Object.freeze({ camera: "CP-F03.camera", depth: "CP-F05.linearDepth", coverage: "CP-F05.coverage" });

export function resolveCocSettings(authored = {}) {
  requireRecord(authored, "CP-F18 settings");
  for (const key of Object.keys(authored)) if (!(key in DEFAULT_COC_SETTINGS)) throw new TypeError(`Unknown CP-F18 setting: ${key}`);
  const result = Object.fromEntries(Object.entries(DEFAULT_COC_SETTINGS).map(([key, fallback]) => [key, authored[key] ?? fallback]));
  if (typeof result.enabled !== "boolean") throw new TypeError("CP-F18 enabled must be boolean or null/AUTO");
  requireNumber(result.maxRadiusOutputPixels, "maxRadiusOutputPixels", 0, COC_LIMITS.maxRadiusOutputPixels);
  requireChoice(result.downsampleFactor, "downsampleFactor", [1, 2, 4]);
  requireChoice(result.tileSize, "tileSize", [4, 8, 16]);
  requireNumber(result.focusThresholdOutputPixels, "focusThresholdOutputPixels", 0, COC_LIMITS.maxRadiusOutputPixels);
  requireNumber(result.smallRadiusOutputPixels, "smallRadiusOutputPixels", result.focusThresholdOutputPixels, COC_LIMITS.maxRadiusOutputPixels);
  requireChoice(result.skyPolicy, "skyPolicy", ["infinity", "focus", "exclude"]);
  requireChoice(result.alphaMode, "alphaMode", ["straight", "premultiplied", "opaque"]);
  if (result.outputCropUv !== null) result.outputCropUv = resolveCropRectangle(result.outputCropUv);
  return Object.freeze(result);
}

export function readCocSettings(settings, viewId) {
  const global = settings.get(COC_SETTINGS_KEY) ?? {};
  const local = settings.get(`${COC_SETTINGS_KEY}.${viewId}`) ?? {};
  requireRecord(global, "CP-F18 global settings");
  requireRecord(local, "CP-F18 per-view settings");
  return resolveCocSettings({ ...global, ...local });
}

export function readCocBindings(settings) {
  const authored = settings.get(COC_BINDINGS_KEY) ?? {};
  requireRecord(authored, COC_BINDINGS_KEY);
  for (const key of Object.keys(authored)) if (!(key in DEFAULT_BINDINGS)) throw new TypeError(`Unknown CoC binding: ${key}`);
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_BINDINGS)) {
    const name = authored[key] ?? fallback;
    if (typeof name !== "string" || !name.length || name === "$color" || name.startsWith("CP-F18.")) throw new TypeError(`Invalid CoC ${key} binding`);
    result[key] = name;
  }
  if (new Set(Object.values(result)).size !== 3) throw new Error("CoC inputs require distinct camera, depth and coverage resources");
  return Object.freeze(result);
}
