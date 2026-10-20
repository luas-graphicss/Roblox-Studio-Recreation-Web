export const FILM_GRAIN_DEFAULTS = Object.freeze({
  enabled: true,
  intensity: 0,
  shadowsIntensity: 1,
  midtonesIntensity: 1,
  highlightsIntensity: 1,
  shadowsMax: 0.25,
  highlightsMin: 0.65,
  highlightsMax: 1,
  texelSize: 1,
  seed: 25,
  temporalMode: "time",
  framesPerSecond: 24,
  fixedFrame: 0,
  texture: null
});

const unitFields = new Set(["intensity", "shadowsIntensity", "midtonesIntensity", "highlightsIntensity", "shadowsMax", "highlightsMin", "highlightsMax"]);

function requireRange(value, name, minimum, maximum, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) throw new TypeError(`CP-F25 ${name} must be ${integer ? "an integer" : "finite"} in [${minimum}, ${maximum}]`);
}

export function resolveGrainSettings(authored) {
  if (authored == null) return FILM_GRAIN_DEFAULTS;
  if (typeof authored !== "object" || Array.isArray(authored)) throw new TypeError("CP-F25 settings must be an object or AUTO");
  const resolved = { ...FILM_GRAIN_DEFAULTS };
  for (const [name, value] of Object.entries(authored)) {
    if (!Object.hasOwn(resolved, name)) throw new TypeError(`Unknown CP-F25 setting: ${name}`);
    if (value == null) continue;
    if (unitFields.has(name)) requireRange(value, name, 0, 1);
    else if (name === "texelSize") requireRange(value, name, 1, 64);
    else if (name === "framesPerSecond") requireRange(value, name, 1, 240);
    else if (name === "seed" || name === "fixedFrame") requireRange(value, name, 0, 0xffffffff, true);
    else if (name === "enabled" && typeof value !== "boolean") throw new TypeError("CP-F25 enabled must be boolean");
    else if (name === "temporalMode" && !["time", "frame", "fixed"].includes(value)) throw new TypeError("CP-F25 temporalMode must be time, frame or fixed");
    else if (name === "texture" && (typeof value !== "object" || Array.isArray(value))) throw new TypeError("CP-F25 texture must be a grain asset or AUTO");
    resolved[name] = value;
  }
  if (resolved.shadowsMax <= 0 || resolved.shadowsMax > resolved.highlightsMin || resolved.highlightsMin >= resolved.highlightsMax) throw new RangeError("CP-F25 zones require 0 < shadowsMax <= highlightsMin < highlightsMax <= 1");
  return Object.freeze(resolved);
}

export function isGrainEnabled(settings) {
  return settings.enabled && settings.intensity > 0 && Math.max(settings.shadowsIntensity, settings.midtonesIntensity, settings.highlightsIntensity) > 0;
}
