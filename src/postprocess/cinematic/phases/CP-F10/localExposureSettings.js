export const LOCAL_EXPOSURE_DEFAULTS = Object.freeze({
  enabled: true,
  highlightContrast: 0.7,
  shadowContrast: 0.8,
  detailStrength: 1,
  middleGray: 0.18,
  middleGrayBiasStops: 0,
  exposureOffsetStops: 0,
  blurredLuminanceBlend: 0,
  kernelRadiusPixels: 4,
  spatialSigmaPixels: 2,
  rangeSigmaStops: 0.5,
  edgeThresholdStops: 2,
  detailLimitStops: 1,
  maxGainStops: 8,
  temporalHalfLifeSeconds: 0.08,
  historyRejectionStops: 0.25,
  highlightContrastCurve: null,
  shadowContrastCurve: null
});

const numericRanges = Object.freeze({
  highlightContrast: [0, 1], shadowContrast: [0, 1], detailStrength: [0, 2],
  middleGray: [0.0001, 1], middleGrayBiasStops: [-8, 8], exposureOffsetStops: [-24, 24],
  blurredLuminanceBlend: [0, 1], kernelRadiusPixels: [1, 8], spatialSigmaPixels: [0.25, 8],
  rangeSigmaStops: [0.05, 2], edgeThresholdStops: [0.125, 4], detailLimitStops: [0, 4],
  maxGainStops: [0, 8], temporalHalfLifeSeconds: [0, 1], historyRejectionStops: [0.001, 2]
});

export function requireLocalExposureNumber(value, name, minimum = -Infinity, maximum = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`CP-F10 ${name} must be finite in [${minimum}, ${maximum}]`);
  }
  return value;
}

function normalizeCurve(curve, name) {
  if (curve === null) return null;
  if (!Array.isArray(curve) || curve.length < 1 || curve.length > 32) throw new TypeError(`CP-F10 ${name} requires 1..32 points`);
  let previousStops = -Infinity;
  return Object.freeze(curve.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) throw new TypeError(`CP-F10 ${name} requires [sceneLogLuminanceStops, contrast] pairs`);
    const stops = requireLocalExposureNumber(point[0], name, -40, 40);
    const contrast = requireLocalExposureNumber(point[1], name, 0, 1);
    if (stops <= previousStops) throw new TypeError(`CP-F10 ${name} stops must strictly increase`);
    previousStops = stops;
    return Object.freeze([stops, contrast]);
  }));
}

export function normalizeLocalExposureSettings(authored = {}) {
  if (authored === null || authored === "AUTO") authored = {};
  if (typeof authored !== "object" || Array.isArray(authored)) throw new TypeError("CP-F10 settings require an object");
  for (const name of Object.keys(authored)) {
    if (!Object.hasOwn(LOCAL_EXPOSURE_DEFAULTS, name)) throw new TypeError(`Unknown CP-F10 setting: ${name}`);
  }
  const settings = {};
  for (const [name, defaultValue] of Object.entries(LOCAL_EXPOSURE_DEFAULTS)) {
    const value = authored[name] === undefined || authored[name] === null || authored[name] === "AUTO" ? defaultValue : authored[name];
    if (name === "enabled") {
      if (typeof value !== "boolean") throw new TypeError("CP-F10 enabled must be boolean");
      settings[name] = value;
    } else if (name.endsWith("Curve")) settings[name] = normalizeCurve(value, name);
    else settings[name] = requireLocalExposureNumber(value, name, ...numericRanges[name]);
  }
  if (!Number.isInteger(settings.kernelRadiusPixels)) throw new TypeError("CP-F10 kernelRadiusPixels must be an integer");
  return Object.freeze(settings);
}

export function sampleContrastCurve(curve, sceneLogLuminanceStops, fallback) {
  if (!curve) return fallback;
  requireLocalExposureNumber(sceneLogLuminanceStops, "metered scene log luminance", -40, 40);
  if (sceneLogLuminanceStops <= curve[0][0]) return curve[0][1];
  for (let index = 1; index < curve.length; index += 1) {
    const [upperStops, upperValue] = curve[index];
    if (sceneLogLuminanceStops > upperStops) continue;
    const [lowerStops, lowerValue] = curve[index - 1];
    const weight = (sceneLogLuminanceStops - lowerStops) / (upperStops - lowerStops);
    return lowerValue + weight * (upperValue - lowerValue);
  }
  return curve.at(-1)[1];
}
