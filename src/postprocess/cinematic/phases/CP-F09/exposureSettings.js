import { createCompensationCurve } from "./compensationCurve.js";
import { isAutomaticValue, requireExposureObject, resolveExposureNumber } from "./exposureValidation.js";

export const DEFAULT_EXPOSURE_SETTINGS = Object.freeze({
  mode: "auto",
  minEv100: -16,
  maxEv100: 24,
  compensationStops: 0,
  speedUpStopsPerSecond: 3,
  speedDownStopsPerSecond: 1,
  transitionDistanceStops: 1.5,
  exposureScale: 1,
  manualEv100: null,
  editorEv100: null,
  frozen: false,
  compensationCurve: null
});

export function resolveExposureSettings(authored = {}) {
  if (isAutomaticValue(authored)) authored = {};
  requireExposureObject(authored, "exposure settings");
  for (const key of Object.keys(authored)) {
    if (!(key in DEFAULT_EXPOSURE_SETTINGS)) throw new TypeError(`Unknown exposure setting: ${key}`);
  }
  const mode = isAutomaticValue(authored.mode) ? "auto" : authored.mode;
  if (!["auto", "manual"].includes(mode)) throw new TypeError("Exposure mode must be auto or manual");
  const frozen = isAutomaticValue(authored.frozen) ? false : authored.frozen;
  if (typeof frozen !== "boolean") throw new TypeError("frozen must be a boolean or AUTO");
  const number = (key, minimum, maximum) => resolveExposureNumber(authored[key], DEFAULT_EXPOSURE_SETTINGS[key], key, minimum, maximum);
  const optionalEv = (key) => isAutomaticValue(authored[key]) ? null : resolveExposureNumber(authored[key], null, key, -64, 64);
  const settings = {
    mode,
    minEv100: number("minEv100", -32, 32),
    maxEv100: number("maxEv100", -32, 32),
    compensationStops: number("compensationStops", -16, 16),
    speedUpStopsPerSecond: number("speedUpStopsPerSecond", 0, 128),
    speedDownStopsPerSecond: number("speedDownStopsPerSecond", 0, 128),
    transitionDistanceStops: number("transitionDistanceStops", 0, 32),
    exposureScale: number("exposureScale", 1 / 65536, 65536),
    manualEv100: optionalEv("manualEv100"),
    editorEv100: optionalEv("editorEv100"),
    frozen,
    compensationCurve: createCompensationCurve(authored.compensationCurve)
  };
  if (settings.minEv100 > settings.maxEv100) throw new RangeError("minEv100 must not exceed maxEv100");
  return Object.freeze(settings);
}
