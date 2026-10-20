import { OUTPUT_MODES, OUTPUT_SETTINGS_KEY } from "./outputContract.js";

export const OUTPUT_DEFAULTS = Object.freeze({
  enabled: true,
  outputMode: "srgb",
  destination: "display",
  fallback: "srgb",
  paperWhiteNits: 200,
  peakNits: 1000,
  blackNits: 0,
  outputGamut: "auto",
  outputWhitePoint: "D65",
  gamutMapping: "auto",
  dither: "none",
  ditherSeed: 0,
  uiComposition: "external"
});
const choices = Object.freeze({
  outputMode: Object.keys(OUTPUT_MODES), destination: ["display", "capture"], fallback: ["srgb", "block"],
  outputGamut: ["auto", "rec709", "display-p3", "rec2020"], outputWhitePoint: ["D65", "D50"],
  gamutMapping: ["auto", "compress", "clip", "preserve"], dither: ["none", "bayer8"], uiComposition: ["external"]
});

export function resolveOutputSettings(authored = {}) {
  if (authored == null) authored = {};
  if (typeof authored !== "object" || Array.isArray(authored)) throw new TypeError("CP-F28 settings must be an object or null");
  const resolved = { ...OUTPUT_DEFAULTS };
  for (const [name, value] of Object.entries(authored)) {
    if (!Object.hasOwn(resolved, name)) throw new TypeError(`Unknown CP-F28 setting: ${name}`);
    if (value == null) continue;
    if (choices[name]) {
      if (!choices[name].includes(value)) throw new TypeError(`Invalid CP-F28 ${name}`);
    } else if (name === "enabled") {
      if (typeof value !== "boolean") throw new TypeError("CP-F28 enabled must be boolean");
    } else if (name === "ditherSeed") {
      if (!Number.isInteger(value) || value < 0 || value > 2147483647) throw new RangeError("CP-F28 ditherSeed must be a nonnegative 31-bit integer");
    } else if (typeof value !== "number" || !Number.isFinite(value) || value < (name === "blackNits" ? 0 : 1) || value > 10000) {
      throw new RangeError(`CP-F28 ${name} must be finite in its luminance range`);
    }
    resolved[name] = value;
  }
  if (resolved.peakNits < resolved.paperWhiteNits || resolved.blackNits >= resolved.paperWhiteNits) throw new RangeError("CP-F28 requires black < paper white <= peak");
  const profile = OUTPUT_MODES[resolved.outputMode];
  if (resolved.outputMode !== "linear" && resolved.outputGamut !== "auto" && resolved.outputGamut !== profile.gamut) throw new Error("CP-F28 output gamut disagrees with the standard encoding");
  if (resolved.outputWhitePoint !== "D65" && (resolved.outputMode !== "linear" || resolved.destination !== "capture")) throw new Error("CP-F28 standard display encodings require D65; other white points are linear-capture only");
  if (resolved.outputMode === "linear" && resolved.destination !== "capture") throw new Error("CP-F28 linear output is capture-only");
  if (resolved.gamutMapping === "preserve" && !["scrgb", "linear"].includes(resolved.outputMode)) throw new Error("CP-F28 bounded output cannot preserve out-of-gamut values");
  if (resolved.dither !== "none" && profile.format !== "rgba8") throw new Error("CP-F28 byte dither cannot be applied to floating-point output");
  return Object.freeze(resolved);
}

export function createOutputSettingsReader() {
  let previousStore;
  let previousRevision;
  let previousAuthored;
  let previousValue;
  return (store) => {
    const authored = store?.get?.(OUTPUT_SETTINGS_KEY);
    const revision = store?.revision?.();
    if (previousValue && store === previousStore && authored === previousAuthored && revision === previousRevision) return previousValue;
    const value = resolveOutputSettings(authored);
    previousStore = store;
    previousRevision = revision;
    previousAuthored = authored;
    previousValue = value;
    return value;
  };
}
