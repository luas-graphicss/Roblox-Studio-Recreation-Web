const defaults = Object.freeze({
  maxWarmupProgramsPerFrame: 2,
  warmupBudgetMilliseconds: 2,
  maxPendingPrograms: 128,
  maxTrackedMaterials: 256,
  maxViews: 16
});

export function resolveRobustnessSettings(input) {
  if (input === undefined || input === null) return defaults;
  if (typeof input !== "object" || Array.isArray(input))
    throw new TypeError("CP-F32 settings must be an object or AUTO");
  const result = { ...defaults };
  for (const [name, value] of Object.entries(input)) {
    if (!Object.hasOwn(defaults, name)) throw new TypeError(`Unknown CP-F32 setting: ${name}`);
    if (value === null || value === undefined) continue;
    const integer = name !== "warmupBudgetMilliseconds";
    const maximum = name === "warmupBudgetMilliseconds" ? 100 : 1024;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > maximum ||
      (integer && !Number.isInteger(value))
    )
      throw new RangeError(`Invalid CP-F32 setting: ${name}`);
    if (["maxPendingPrograms", "maxTrackedMaterials", "maxViews"].includes(name) && value === 0)
      throw new RangeError(`${name} must be positive`);
    result[name] = value;
  }
  return Object.freeze(result);
}
