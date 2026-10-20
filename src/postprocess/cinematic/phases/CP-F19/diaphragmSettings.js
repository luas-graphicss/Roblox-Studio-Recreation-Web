import { requireFiniteNumber } from "../../contracts/frameContract.js";

export const DEFAULT_DIAPHRAGM_SETTINGS = Object.freeze({
  enabled: false, bladeCount: 7, bladeCurvature: 0, bladeRotationDegrees: 0, anamorphicRatio: 1,
  maxRadiusPixels: 16, smallRadiusPixels: 3, holeFillRadiusPixels: 6,
  focusProtectionRadiusPixels: 0.5, depthToleranceMeters: 0.02,
  memoryBudgetBytes: 67108864, sampleVisitBudget: 1000000000
});

export function resolveDiaphragmSettings(authored) {
  if (authored === undefined || authored === null || authored === "AUTO") return DEFAULT_DIAPHRAGM_SETTINGS;
  if (typeof authored !== "object" || Array.isArray(authored)) throw new TypeError("CP-F19 settings must be an object");
  for (const key of Object.keys(authored)) if (!Object.hasOwn(DEFAULT_DIAPHRAGM_SETTINGS, key)) throw new TypeError(`CP-F19 unknown setting: ${key}`);
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_DIAPHRAGM_SETTINGS)) {
    const value = authored[key];
    result[key] = value === undefined || value === null || value === "AUTO" ? fallback : value;
  }
  if (typeof result.enabled !== "boolean") throw new TypeError("CP-F19 enabled must be boolean or AUTO");
  const ranges = {
    bladeCount: [3, 32], bladeCurvature: [0, 1], bladeRotationDegrees: [-3600, 3600], anamorphicRatio: [0.25, 4],
    maxRadiusPixels: [0, 24], smallRadiusPixels: [0, 4], holeFillRadiusPixels: [0, 8],
    focusProtectionRadiusPixels: [0.001, 4], depthToleranceMeters: [0, 10],
    memoryBudgetBytes: [1, 1073741824], sampleVisitBudget: [1, Number.MAX_SAFE_INTEGER]
  };
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) requireFiniteNumber(result[key], `CP-F19.${key}`, minimum, maximum);
  for (const key of ["bladeCount", "holeFillRadiusPixels", "memoryBudgetBytes", "sampleVisitBudget"]) if (!Number.isSafeInteger(result[key])) throw new TypeError(`CP-F19 ${key} must be an integer`);
  return Object.freeze(result);
}

export function resolveDiaphragmBindings(authored) {
  if (authored === undefined || authored === null) return null;
  if (typeof authored !== "object" || Array.isArray(authored)) throw new TypeError("CP-F19 bindings must be an object");
  for (const key of Object.keys(authored)) if (!["coc", "surface"].includes(key)) throw new TypeError(`CP-F19 unknown binding: ${key}`);
  for (const key of ["coc", "surface"]) {
    const name = authored[key];
    if (typeof name !== "string" || !name.trim() || name.startsWith("CP-F19.") || name === "$color") throw new TypeError(`CP-F19 requires an external ${key} resource name`);
  }
  if (authored.coc === authored.surface) throw new TypeError("CP-F19 input bindings must be distinct");
  return Object.freeze({ coc: authored.coc, surface: authored.surface });
}

export function createDiaphragmSettingsReader(store) {
  let previousSource = Symbol("unread"), previousRevision, resolved;
  return () => {
    const source = store?.get?.("CP-F19");
    const revision = store?.revision?.();
    if (source !== previousSource || revision !== previousRevision) {
      resolved = resolveDiaphragmSettings(source);
      previousSource = source;
      previousRevision = revision;
    }
    return resolved;
  };
}
