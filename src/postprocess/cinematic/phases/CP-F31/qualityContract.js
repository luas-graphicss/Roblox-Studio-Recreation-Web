export const QUALITY_PHASE = "CP-F31";
export const QUALITY_RESOURCE = "CP-F31.qualityState";
export const QUALITY_VERSION = "quality-budget-v1";
export const MEBIBYTE = 1048576;
export const MAXIMUM_BUDGET_BYTES = 1073741824;

export function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be a safe integer in [${minimum}, ${maximum}]`);
  return value;
}

export function finite(value, name, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be finite in [${minimum}, ${maximum}]`);
  return value;
}

export function inherited(value) {
  return value === undefined || value === null || value === "AUTO";
}

export function record(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError(`${name} must be a plain object`);
  return value;
}

export function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function configurationKey(value) {
  if (Array.isArray(value)) return `[${value.map(configurationKey).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + configurationKey(value[key])).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function assertSynchronous(value, name) {
  if (value && typeof value.then === "function") throw new TypeError(`${name} must be synchronous`);
  return value;
}
