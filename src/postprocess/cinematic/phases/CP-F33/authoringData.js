import { AUTHORING_TEXT_LIMIT } from "./authoringContract.js";

export class AuthoringValidationError extends TypeError {
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = "AuthoringValidationError";
    this.diagnostics = Object.freeze([Object.freeze({ code, path, message })]);
  }
}

export function reject(code, path, message) { throw new AuthoringValidationError(code, path, message); }
export function requireRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("invalid-record", path, "Expected a plain record");
  return value;
}
export function requireKeys(value, allowed, path) {
  requireRecord(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) reject("unknown-field", `${path}.${key}`, "Unknown field; explicit migration is required");
  return value;
}
export function requireIdentifier(value, path) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value) || value.split(/[.-]/).some(part => ["constructor", "prototype", "__proto__"].includes(part))) reject("invalid-identifier", path, "Expected a safe identifier");
  return value;
}
export function requireNumber(value, path, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) reject("invalid-number", path, `Expected a finite number in [${minimum}, ${maximum}]`);
  return value;
}
export function validateDependency(path, operation) {
  try { return operation(); }
  catch (error) {
    if (error instanceof AuthoringValidationError) throw error;
    reject("dependency-validation", path, error.message);
  }
}
export function copyAuthoringData(input) {
  const ancestors = new Set();
  let nodes = 0;
  let characters = 0;
  function visit(value, path, depth) {
    if (++nodes > 60000 || depth > 32) reject("data-limit", path, "Document exceeds the safe data budget");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return requireNumber(value, path) === 0 ? 0 : value;
    if (typeof value === "string") {
      characters += value.length;
      if (value.length > 262144 || characters > AUTHORING_TEXT_LIMIT) reject("text-limit", path, "Document text exceeds the safe budget");
      return value;
    }
    if (typeof value !== "object") reject("unsafe-data", path, "Only plain JSON data is supported");
    if (ancestors.has(value)) reject("cyclic-data", path, "Cycles are not supported");
    const array = Array.isArray(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject("unsafe-object", path, "Only plain records are supported");
    ancestors.add(value);
    const result = array ? [] : {};
    const keys = Reflect.ownKeys(value).filter(key => !(array && key === "length"));
    if (array && keys.length !== value.length) reject("sparse-array", path, "Array must be dense without extra properties");
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) reject("unsafe-key", path, "Unsafe key, symbol or accessor");
      characters += key.length;
      if (characters > AUTHORING_TEXT_LIMIT) reject("text-limit", path, "Document keys exceed the safe budget");
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) reject("invalid-array-key", path, "Invalid array index");
      result[key] = visit(descriptor.value, `${path}.${key}`, depth + 1);
    }
    ancestors.delete(value);
    return result;
  }
  return visit(input, "$", 0);
}
export function freezeAuthoringData(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeAuthoringData(child);
    Object.freeze(value);
  }
  return value;
}
export function canonicalJson(value) {
  return JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export function translateAuto(record) { return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value === "AUTO" ? null : value])); }
