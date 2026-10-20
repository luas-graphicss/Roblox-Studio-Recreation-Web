const defaults = Object.freeze({
  jitterEnabled: false,
  seed: 0,
  sequenceLength: 16,
  paused: false,
  sceneRevision: 0,
  teleportRevision: 0,
  deviceRevision: 0,
  resetRevision: 0
});

export function resolveTemporalControls(value) {
  if (value == null) return defaults;
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("Temporal controls must be an object or AUTO");
  const controls = { ...defaults };
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(defaults, key)) throw new TypeError(`Unknown temporal control: ${key}`);
    if (value[key] != null) controls[key] = value[key];
  }
  for (const key of ["jitterEnabled", "paused"]) {
    if (typeof controls[key] !== "boolean") throw new TypeError(`${key} must be boolean`);
  }
  for (const key of ["seed", "sceneRevision", "teleportRevision", "deviceRevision", "resetRevision"]) {
    if (!Number.isSafeInteger(controls[key]) || controls[key] < 0 || controls[key] > 0xffffffff) throw new TypeError(`${key} must be an unsigned 32-bit integer`);
  }
  if (!Number.isInteger(controls.sequenceLength) || controls.sequenceLength < 1 || controls.sequenceLength > 4096) throw new TypeError("sequenceLength must be 1..4096");
  return Object.freeze(controls);
}
