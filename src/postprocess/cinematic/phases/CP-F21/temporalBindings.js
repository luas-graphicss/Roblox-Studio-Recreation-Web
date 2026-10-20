export const TEMPORAL_RECONSTRUCTION_RESOURCES = Object.freeze({
  velocity: "CP-F21.dilatedVelocity",
  output: "CP-F21.output",
  rejection: "CP-F21.rejection",
  depth: "CP-F21.historyDepth",
  metadata: "CP-F21.metadata"
});

const completeBindings = Object.freeze({
  profile: "complete-motion",
  color: "$color",
  depth: "sceneDepth",
  velocity: "CP-F06.velocity",
  motionValidity: "CP-F06.reprojectionValidity",
  reactiveMask: null,
  translucencyMask: null
});

export function resolveTemporalBindings(value) {
  if (value == null) return completeBindings;
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("CP-F21 bindings must be an object");
  const bindings = { ...completeBindings };
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(completeBindings, key)) throw new TypeError(`Unknown CP-F21 binding: ${key}`);
    if (value[key] !== undefined) bindings[key] = value[key];
  }
  if (!["complete-motion", "foundation-rigid"].includes(bindings.profile)) throw new TypeError("CP-F21 motion profile must be explicit");
  if (bindings.profile === "foundation-rigid") {
    bindings.velocity = value.velocity ?? "sceneVelocity";
    bindings.motionValidity = value.motionValidity ?? null;
  }
  for (const key of ["color", "depth", "velocity", "motionValidity", "reactiveMask", "translucencyMask"]) {
    const name = bindings[key];
    if (name === null && ["motionValidity", "reactiveMask", "translucencyMask"].includes(key)) continue;
    if (typeof name !== "string" || !name.trim() || name.startsWith("CP-F21.") || (name === "$color" && key !== "color")) throw new TypeError(`Invalid CP-F21 binding: ${key}`);
  }
  if (bindings.profile === "complete-motion" && !bindings.motionValidity) throw new Error("Complete motion requires visibility, validity, coverage and reactive signals");
  return Object.freeze(bindings);
}

export function temporalInputNames(bindings) {
  return [...new Set([bindings.color, bindings.depth, bindings.velocity, bindings.motionValidity, bindings.reactiveMask, bindings.translucencyMask, "CP-F07.temporalFrame"].filter(Boolean))];
}
