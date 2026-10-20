import { requireKeys, requireNumber, requireBoolean, requireIdentifier, requireVector, freezeData } from "./settingsValidation.js";

const schemas = new WeakSet();
const kinds = ["number", "integer", "vector", "boolean", "enum", "asset"];

export function validatePropertyValue(property, value) {
  const { name, kind, minimum, maximum } = property;
  if (kind === "number" || kind === "integer") {
    const checked = requireNumber(value, name, minimum, maximum);
    if (kind === "integer" && !Number.isSafeInteger(checked)) throw new TypeError(`${name} must be a safe integer`);
    return checked;
  }
  if (kind === "vector") return requireVector(value, property.size, name, minimum, maximum);
  if (kind === "boolean") return requireBoolean(value, name);
  if (kind === "enum" && property.options.includes(value)) return value;
  if (kind === "asset" && (value === null || typeof value === "string" && value.length > 0 && value !== "AUTO")) return value;
  throw new TypeError(`${name} has an invalid ${kind} value`);
}

export function createSettingsSchema(definition) {
  requireKeys(definition, ["id", "version", "properties"], "Schema");
  const id = requireIdentifier(definition.id, "Schema id");
  const version = requireNumber(definition.version, "Schema version", 1);
  if (!Number.isSafeInteger(version)) throw new TypeError("Schema version must be an integer");
  if (!Array.isArray(definition.properties) || definition.properties.length === 0) throw new TypeError("Schema requires properties");
  const byName = new Map();
  const properties = Array.from(definition.properties, (input) => {
    requireKeys(input, ["name", "kind", "defaultValue", "minimum", "maximum", "size", "options", "blend"], "Property");
    const name = requireIdentifier(input.name, "Property name");
    if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/.test(name) || name.split(".").some((part) => ["__proto__", "constructor", "prototype"].includes(part)) || byName.has(name)) throw new TypeError(`Invalid or duplicate property ${name}`);
    if (!kinds.includes(input.kind)) throw new TypeError(`Unsupported property kind ${input.kind}`);
    const property = { name, kind: input.kind, blend: ["number", "vector"].includes(input.kind) ? "linear" : "last-positive" };
    if (input.blend !== undefined && input.blend !== property.blend) throw new TypeError(`${name}: unsupported blend policy`);
    if (["number", "integer", "vector"].includes(input.kind)) {
      property.minimum = input.minimum === undefined ? -Number.MAX_VALUE : requireNumber(input.minimum, `${name}.minimum`);
      property.maximum = input.maximum === undefined ? Number.MAX_VALUE : requireNumber(input.maximum, `${name}.maximum`, property.minimum);
    }
    if (input.kind === "vector") {
      property.size = requireNumber(input.size, `${name}.size`, 2, 4);
      if (!Number.isInteger(property.size)) throw new TypeError(`${name}.size must be integer`);
    }
    if (input.kind === "enum") {
      if (!Array.isArray(input.options) || input.options.length === 0 || new Set(input.options).size !== input.options.length) throw new TypeError(`${name} requires unique enum options`);
      property.options = input.options.map((option) => {
        requireIdentifier(option, `${name} option`);
        if (option === "AUTO") throw new TypeError("AUTO is reserved for inheritance");
        return option;
      });
    }
    property.defaultValue = validatePropertyValue(property, input.defaultValue);
    freezeData(property);
    byName.set(name, property);
    return property;
  });
  const schema = Object.freeze({ id, version, properties: Object.freeze(properties), get: (name) => byName.get(name), referenceStatus: "unverified" });
  schemas.add(schema);
  return schema;
}

export function requireSettingsSchema(schema) {
  if (!schemas.has(schema)) throw new TypeError("Expected a validated settings schema");
  return schema;
}

export const DEFAULT_SETTINGS_SCHEMA = createSettingsSchema({
  id: "CP-F02.engineering-neutral",
  version: 1,
  properties: [
    { name: "exposure.compensationEv", kind: "number", defaultValue: 0, minimum: -32, maximum: 32 },
    { name: "exposure.mode", kind: "enum", defaultValue: "manual", options: ["manual", "basic", "histogram"] },
    { name: "bloom.enabled", kind: "boolean", defaultValue: true },
    { name: "bloom.intensity", kind: "number", defaultValue: 0, minimum: 0, maximum: 128 },
    { name: "bloom.method", kind: "enum", defaultValue: "standard", options: ["standard", "convolution"] },
    { name: "lensFlare.bokehShape", kind: "asset", defaultValue: null },
    { name: "grading.gain", kind: "vector", size: 3, defaultValue: [1, 1, 1], minimum: 0, maximum: 16 },
    { name: "vignette.intensity", kind: "number", defaultValue: 0, minimum: 0, maximum: 1 },
    { name: "motionBlur.amount", kind: "number", defaultValue: 0, minimum: 0, maximum: 2 },
    { name: "filmGrain.intensity", kind: "number", defaultValue: 0, minimum: 0, maximum: 10 }
  ]
});
