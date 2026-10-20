export const MOTION_BLUR_DEFAULTS = Object.freeze({
  enabled: true,
  amount: 1,
  shutterMode: "camera",
  shutterSeconds: 1 / 120,
  shutterAngleDegrees: 180,
  targetFps: 60,
  shutterTiming: "centered",
  maximumBlurPixels: 64,
  maximumBlurPercent: 5,
  perObjectSizePercent: 0,
  sampleCount: 24,
  geometrySampling: "render-jittered",
  skyPolicy: "preserve",
  translucencyPolicy: "preserve",
  depthTolerance: 0.01,
  motionTolerancePixels: 1.5,
  maximumBytes: 67108864,
  maximumViews: 4,
});

const ranges = Object.freeze({
  amount: [0, 4],
  shutterSeconds: [0, 60],
  shutterAngleDegrees: [0, 360],
  targetFps: [0, 1000],
  maximumBlurPixels: [0, 256],
  maximumBlurPercent: [0, 100],
  perObjectSizePercent: [0, 100],
  sampleCount: [4, 64],
  depthTolerance: [0, 0.25],
  motionTolerancePixels: [0.5, 4],
  maximumBytes: [1024, 1073741824],
  maximumViews: [1, 8],
});
const choices = Object.freeze({
  shutterMode: ["camera", "seconds", "angle"],
  shutterTiming: ["centered", "trailing", "leading"],
  geometrySampling: ["render-jittered", "output-aligned"],
  skyPolicy: ["preserve", "velocity"],
  translucencyPolicy: ["preserve", "premultiplied"],
});

export function inheritedMotionValue(value) {
  return value === null || value === undefined || value === "AUTO";
}

export function resolveMotionBlurSettings(
  authored = null,
  inherited = MOTION_BLUR_DEFAULTS,
) {
  if (inheritedMotionValue(authored)) authored = {};
  if (typeof authored !== "object" || Array.isArray(authored))
    throw new TypeError("CP-F22 settings must be an object or AUTO");
  const settings = { ...inherited };
  for (const [key, value] of Object.entries(authored)) {
    if (!Object.hasOwn(MOTION_BLUR_DEFAULTS, key))
      throw new TypeError(`CP-F22 unknown setting: ${key}`);
    if (!inheritedMotionValue(value)) settings[key] = value;
  }
  if (typeof settings.enabled !== "boolean")
    throw new TypeError("CP-F22 enabled must be boolean");
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    const value = settings[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum
    )
      throw new TypeError(
        `CP-F22 ${key} must be finite in [${minimum}, ${maximum}]`,
      );
  }
  for (const key of ["sampleCount", "maximumViews", "maximumBytes"])
    if (!Number.isInteger(settings[key]))
      throw new TypeError(`CP-F22 ${key} must be an integer`);
  for (const [key, values] of Object.entries(choices))
    if (!values.includes(settings[key]))
      throw new TypeError(`CP-F22 unsupported ${key}`);
  return Object.freeze(settings);
}

export function createMotionBlurSettingsReader(store) {
  let lastRevision = null;
  const views = new Map();
  return (viewId) => {
    const revision = store.revision?.();
    if (revision !== lastRevision || revision === undefined) {
      views.clear();
      lastRevision = revision;
    }
    if (!views.has(viewId)) {
      if (views.size >= 8) views.clear();
      views.set(
        viewId,
        resolveMotionBlurSettings(
          store.get(`CP-F22.${viewId}`),
          resolveMotionBlurSettings(store.get("CP-F22")),
        ),
      );
    }
    return views.get(viewId);
  };
}
