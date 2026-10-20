export function requireRecord(value, label, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowedKeys.includes(key)) throw new TypeError(`${label}: unknown property ${key}`);
  return value;
}

export function requireScalar(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new TypeError(`${label} must be finite in [${minimum}, ${maximum}]`);
  return value;
}

export function resolveScalar(value, fallback, label, minimum, maximum) {
  return value === undefined || value === null || value === "AUTO" ? fallback : requireScalar(value, label, minimum, maximum);
}

export function resolveTint(value, fallback, label) {
  if (value === undefined || value === null || value === "AUTO") return fallback;
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${label} requires three linear RGB channels`);
  return Object.freeze(value.map((channel) => requireScalar(channel, label, 0, 4)));
}
