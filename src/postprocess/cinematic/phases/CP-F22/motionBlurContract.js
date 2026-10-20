export const MOTION_BLUR_OWNER = "CP-F22";
export const MOTION_BLUR_TILE_SIZE = 16;
export const MOTION_BLUR_MAXIMUM_PIXELS = 256;
export const MOTION_BLUR_RESOURCES = Object.freeze({
  plan: "CP-F22.plan",
  flattened: "CP-F22.flattenedVelocity",
  tiles: "CP-F22.tileMaximum",
  neighbors: "CP-F22.neighborMaximum",
  color: "CP-F22.color",
  diagnostics: "CP-F22.diagnostics",
});
export const MOTION_BLUR_DEFAULT_BINDINGS = Object.freeze({
  velocity: "CP-F06.velocity",
  depth: "sceneDepth",
  validity: "CP-F06.reprojectionValidity",
  camera: "CP-F03.camera",
  objectSize: null,
  cameraVelocity: null,
});
export const MOTION_BLUR_LAYOUT = Object.freeze({
  encoding: "motion-blur-pixels-log-depth-class-v1",
  format: "rgba16f",
  channels: Object.freeze([
    "shutter-displacement-x-pixels",
    "shutter-displacement-y-pixels",
    "log2-depth-meters",
    "surface-class",
  ]),
  classes: Object.freeze({
    protected: 0,
    opaque: 1,
    sky: 2,
    premultiplied: 3,
    invalidVelocity: -1,
    invalidDepth: -2,
    invalidMask: -3,
    invalidColor: -4,
  }),
  history: "none",
  referenceVerified: false,
});

export function resolveMotionBlurBindings(authored = null) {
  if (
    authored !== null &&
    (typeof authored !== "object" || Array.isArray(authored))
  )
    throw new TypeError("CP-F22 bindings must be an object");
  const bindings = { ...MOTION_BLUR_DEFAULT_BINDINGS, ...authored };
  for (const key of Object.keys(bindings)) {
    if (!Object.hasOwn(MOTION_BLUR_DEFAULT_BINDINGS, key))
      throw new TypeError(`CP-F22 unknown binding: ${key}`);
    const value = bindings[key];
    if (value === null && !["velocity", "depth"].includes(key)) continue;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value !== value.trim() ||
      value === "$color" ||
      value.startsWith("CP-F22.")
    )
      throw new TypeError(`CP-F22 invalid ${key} binding`);
  }
  const names = Object.values(bindings).filter(Boolean);
  if (new Set(names).size !== names.length)
    throw new TypeError("CP-F22 side inputs must name distinct resources");
  return Object.freeze(bindings);
}
