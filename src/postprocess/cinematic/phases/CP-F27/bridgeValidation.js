export function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`CP-F27 ${label} requires a plain object`);
  return value;
}

export function requireKeys(value, allowed, label) {
  requireRecord(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`CP-F27 unknown ${label} field: ${key}`);
  return value;
}

export function requireName(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_.:/-]*$/.test(value) || value.split(/[./]/).some((part) => ["__proto__", "prototype", "constructor"].includes(part))) throw new TypeError(`CP-F27 invalid ${label}`);
  return value;
}

export function requireNumber(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new TypeError(`CP-F27 invalid ${label}`);
  return value;
}

export function requireInteger(value, label, minimum, maximum) {
  requireNumber(value, label, minimum, maximum);
  if (!Number.isSafeInteger(value)) throw new TypeError(`CP-F27 ${label} must be an integer`);
  return value;
}

export function copyControlValue(value, label) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return requireNumber(value, label, -Number.MAX_VALUE, Number.MAX_VALUE);
  if (Array.isArray(value) && value.length > 0 && value.length <= 16) return Object.freeze(value.map((component) => requireNumber(component, label, -Number.MAX_VALUE, Number.MAX_VALUE)));
  throw new TypeError(`CP-F27 unsupported control value: ${label}`);
}

export function freezeData(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}
