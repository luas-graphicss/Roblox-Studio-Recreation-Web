export const METERING_DEFAULTS = Object.freeze({
  mode: "basic",
  histogramMinLog2: -10,
  histogramMaxLog2: 20,
  lowPercent: 10,
  highPercent: 90,
  minimumLuminance: 0.000001,
  minimumEv100: -16,
  maximumEv100: 20,
  middleGray: 0.18,
  luminanceCalibration: 12.5,
  manualEv100: 0,
  manualExposureCalibration: 1.2,
  applyPhysicalCameraExposure: false,
  debugHistogram: false,
  histogramBackend: "auto"
});

function finiteNumber(value, name, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`CP-F08 ${name} must be a finite number in [${minimum}, ${maximum}]`);
  }
}

export function resolveMeteringSettings(input) {
  if (input == null) return METERING_DEFAULTS;
  if (typeof input !== "object" || Array.isArray(input)) throw new TypeError("CP-F08 settings must be an object");
  for (const name of Object.keys(input)) {
    if (!Object.hasOwn(METERING_DEFAULTS, name)) throw new TypeError(`CP-F08 unknown setting: ${name}`);
  }
  const settings = Object.fromEntries(Object.entries(METERING_DEFAULTS).map(([name, fallback]) => [name, input[name] ?? fallback]));
  if (!["basic", "histogram", "manual"].includes(settings.mode)) throw new TypeError("CP-F08 unsupported metering mode");
  if (!["auto", "gather", "scatter"].includes(settings.histogramBackend)) throw new TypeError("CP-F08 unsupported histogram backend");
  for (const name of ["histogramMinLog2", "histogramMaxLog2", "minimumEv100", "maximumEv100", "manualEv100"]) finiteNumber(settings[name], name, -32, 32);
  for (const name of ["lowPercent", "highPercent"]) finiteNumber(settings[name], name, 0, 100);
  finiteNumber(settings.minimumLuminance, "minimumLuminance", 2 ** -32, 1);
  finiteNumber(settings.middleGray, "middleGray", 0.0001, 1);
  finiteNumber(settings.luminanceCalibration, "luminanceCalibration", 0.01, 100);
  finiteNumber(settings.manualExposureCalibration, "manualExposureCalibration", 0.01, 100);
  for (const name of ["applyPhysicalCameraExposure", "debugHistogram"]) {
    if (typeof settings[name] !== "boolean") throw new TypeError(`CP-F08 ${name} must be boolean`);
  }
  if (settings.histogramMinLog2 >= settings.histogramMaxLog2) throw new RangeError("CP-F08 histogram range must be increasing");
  if (settings.minimumEv100 > settings.maximumEv100) throw new RangeError("CP-F08 exposure bounds must not be reversed");
  if (settings.lowPercent >= settings.highPercent) throw new RangeError("CP-F08 percentile interval must be nonempty");
  return Object.freeze(settings);
}

export function validatePreExposure(value) {
  finiteNumber(value, "preExposure", 2 ** -32, 2 ** 32);
  return value;
}
