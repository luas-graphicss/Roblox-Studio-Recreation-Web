export const hasOwn = (record, key) => Object.prototype.hasOwnProperty.call(record, key);

export function requireRecord(value, label) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor.enumerable || !hasOwn(descriptor, "value") || descriptor.value === undefined || ["__proto__", "prototype", "constructor"].includes(key)) throw new TypeError(`${label} contains an unsafe property`);
  }
  return value;
}

export function requireKeys(value, allowed, label) {
  requireRecord(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`${label}: unknown field ${key}`);
  return value;
}

export function requireNumber(value, label, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new TypeError(`${label} must be a finite number in [${minimum}, ${maximum}]`);
  return Object.is(value, -0) ? 0 : value;
}

export function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

export function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || ["__proto__", "prototype", "constructor"].includes(value)) throw new TypeError(`${label} must be a nonempty safe identifier`);
  return value;
}

export function requireVector(value, size, label, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE) {
  if (!Array.isArray(value) || value.length !== size) throw new TypeError(`${label} requires ${size} components`);
  return Array.from(value, (component, index) => requireNumber(component, `${label}[${index}]`, minimum, maximum));
}

export function freezeData(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
}
