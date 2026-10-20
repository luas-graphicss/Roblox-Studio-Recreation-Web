export function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(`${label} must be a plain object`);
  return value;
}

export function requireKeys(value, allowed, label) {
  requireRecord(value, label);
  for (const name of Object.keys(value)) if (!allowed.includes(name)) throw new TypeError(`${label} has an unknown field: ${name}`);
  return value;
}

export function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(value) || ["constructor", "prototype", "__proto__"].includes(value)) throw new TypeError(`${label} must be an explicit identifier`);
  return value;
}

export function requireNumber(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`${label} must be finite in [${minimum}, ${maximum}]`);
  return value;
}

export function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

export function inherit(value, fallback) {
  return value == null || value === "AUTO" ? fallback : value;
}

export function requireShader(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 24000) throw new TypeError("Material shader body must contain 1 to 24000 characters");
  if (/\b(?:uniform|varying|attribute|precision|gl_FragColor|gl_FragData|discard|while|do|for)\b|#|\/\*|\/\//.test(value)) throw new TypeError("Shader body cannot replace the wrapper, declare resources, discard pixels or contain loops/comments");
  return value;
}

export function validateParameter(type, value, name) {
  if (type === "bool") return requireBoolean(value, name);
  if (type === "float" || type === "int") {
    requireNumber(value, name, -65504, 65504);
    if (type === "int" && !Number.isInteger(value)) throw new TypeError(`${name} must be an integer`);
    return value;
  }
  if (!/^vec[234]$/.test(type) || !Array.isArray(value) || value.length !== Number(type.slice(-1))) throw new TypeError(`${name} has an invalid uniform type or vector length`);
  return Object.freeze(value.map((component) => requireNumber(component, name, -65504, 65504)));
}
