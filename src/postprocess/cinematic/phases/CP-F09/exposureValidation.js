export function requireExposureNumber(value, name, minimum = -Infinity, maximum = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be a finite number in [${minimum}, ${maximum}]`);
  }
  return value;
}

export function isAutomaticValue(value) {
  return value === null || value === undefined || value === "AUTO";
}

export function resolveExposureNumber(value, fallback, name, minimum, maximum) {
  return requireExposureNumber(isAutomaticValue(value) ? fallback : value, name, minimum, maximum);
}

export function requireExposureObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

export function clampExposureValue(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
