const defaults = Object.freeze({
  enabled: true,
  workingScale: 2,
  mode: "realtime",
  historyWeight: 0.9,
  cocHistoryWeight: 0.65,
  maximumSamples: 64,
  depthTolerance: 0.02,
  coverageTolerance: 0.1,
  cocTolerancePixels: 0.75,
  cocRelativeTolerance: 0.1,
  maximumCocPixels: 512,
  maximumFocusDeltaDiopters: 0.02,
  maximumApertureDeltaStops: 0.1,
  colorClampSigma: 2,
  colorClampMargin: 0.025,
  colorRelativeMargin: 0.05,
  maximumMotionPixels: 64,
  paused: false,
  resetRevision: 0
});

const ranges = Object.freeze({
  historyWeight: [0, 0.99], cocHistoryWeight: [0, 0.99], maximumSamples: [1, 256],
  depthTolerance: [0, 0.5], coverageTolerance: [0, 1], cocTolerancePixels: [0, 32],
  cocRelativeTolerance: [0, 1], maximumCocPixels: [1, 4096],
  maximumFocusDeltaDiopters: [0.000001, 10], maximumApertureDeltaStops: [0.000001, 16],
  colorClampSigma: [0, 8], colorClampMargin: [0, 1], colorRelativeMargin: [0, 1],
  maximumMotionPixels: [0, 4096], resetRevision: [0, 4294967295]
});

export function resolveDofTemporalSettings(input) {
  if (input == null) return defaults;
  if (typeof input !== "object" || Array.isArray(input)) throw new TypeError("CP-F20 settings require an object or AUTO");
  const settings = { ...defaults };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(defaults, key)) throw new TypeError(`Unknown CP-F20 setting: ${key}`);
    if (value != null) settings[key] = value;
  }
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    if (typeof settings[key] !== "number" || !Number.isFinite(settings[key]) || settings[key] < minimum || settings[key] > maximum) throw new RangeError(`Invalid CP-F20 ${key}`);
  }
  for (const key of ["maximumSamples", "resetRevision"]) if (!Number.isInteger(settings[key])) throw new TypeError(`${key} must be an integer`);
  for (const key of ["enabled", "paused"]) if (typeof settings[key] !== "boolean") throw new TypeError(`${key} must be boolean`);
  if (![1, 2, 4].includes(settings.workingScale)) throw new RangeError("CP-F20 workingScale must be 1, 2 or 4");
  if (!["realtime", "cinematic"].includes(settings.mode)) throw new TypeError("CP-F20 mode must be realtime or cinematic");
  return Object.freeze(settings);
}

export function dofSettingsSignature(settings) {
  return JSON.stringify(settings);
}
