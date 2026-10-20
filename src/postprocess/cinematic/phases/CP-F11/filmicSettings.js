export const FILMIC_SETTINGS_KEY = "CP-F11.settings";

export const FILMIC_DEFAULTS = Object.freeze({
  mode: "film",
  slope: 0.88,
  toe: 0.55,
  shoulder: 0.26,
  blackClip: 0,
  whiteClip: 0.04,
  blueCorrection: 0.6,
  expandGamut: 1,
  outputMode: "sdr",
  paperWhiteNits: 200,
  peakNits: 1000
});

const unitParameters = new Set(["slope", "toe", "shoulder", "blackClip", "whiteClip", "blueCorrection", "expandGamut"]);

export function resolveFilmicSettings(authored = {}) {
  if (authored == null) authored = {};
  if (typeof authored !== "object" || Array.isArray(authored)) throw new TypeError("CP-F11 settings must be an object or null");
  const resolved = { ...FILMIC_DEFAULTS };
  for (const [name, value] of Object.entries(authored)) {
    if (!Object.hasOwn(FILMIC_DEFAULTS, name)) throw new TypeError(`Unknown CP-F11 setting: ${name}`);
    if (value == null) continue;
    if (unitParameters.has(name)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be finite in [0, 1]`);
    } else if (name === "mode") {
      if (!["film", "bypass", "replace"].includes(value)) throw new TypeError("mode must be film, bypass or replace");
    } else if (name === "outputMode") {
      if (!["sdr", "hdr"].includes(value)) throw new TypeError("outputMode must be sdr or hdr");
    } else if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 10000) {
      throw new RangeError(`${name} must be finite in [1, 10000] nits`);
    }
    resolved[name] = value;
  }
  if (resolved.peakNits < resolved.paperWhiteNits) throw new RangeError("peakNits cannot be lower than paperWhiteNits");
  return Object.freeze(resolved);
}

export function getFilmicOutput(settings) {
  const hdr = settings.outputMode === "hdr";
  return Object.freeze({
    encoding: hdr ? "display-linear-rec2020" : "display-linear-rec709",
    headroom: hdr ? settings.peakNits / settings.paperWhiteNits : 1,
    transferFunction: "linear",
    colorPrimaries: hdr ? "rec2020" : "rec709",
    whitePoint: "D65",
    referenceWhiteNits: settings.paperWhiteNits,
    peakNits: hdr ? settings.peakNits : settings.paperWhiteNits,
    displayVerified: false,
    referenceVerified: false
  });
}
