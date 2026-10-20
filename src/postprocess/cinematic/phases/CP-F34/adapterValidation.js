export function requireCallback(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

export function requireSynchronous(value, name) {
  if (value && typeof value.then === "function") {
    Promise.resolve(value).catch(() => {});
    throw new TypeError(`${name} must be synchronous`);
  }
  return value;
}

export function copySettings(value, name = "settings", ancestors = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) {
    throw new TypeError(`${name} must contain finite JSON values`);
  }
  if (ancestors.has(value)) throw new TypeError(`${name} must not contain cycles`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((entry, index) => copySettings(entry, `${name}[${index}]`, ancestors)));
    const copy = {};
    for (const [key, entry] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new TypeError(`Unsafe ${name} key`);
      copy[key] = copySettings(entry, `${name}.${key}`, ancestors);
    }
    return Object.freeze(copy);
  } finally { ancestors.delete(value); }
}

export function requireSettingsObject(value) {
  if (!value || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("settings must be a plain object");
  }
  return copySettings(value);
}

export function samePixelSize(left, right) {
  return left?.width === right?.width && left?.height === right?.height;
}
