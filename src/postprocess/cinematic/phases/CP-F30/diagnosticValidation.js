import { DIAGNOSTIC_KINDS, DEFAULT_DIAGNOSTIC_BINDINGS, DIAGNOSTIC_LIMITS } from "./diagnosticsContract.js";

export function requireFinite(value, label, minimum = -Infinity, maximum = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new TypeError(`${label} must be a finite number in [${minimum}, ${maximum}]`);
  return value;
}

export function requireExtent(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new TypeError("Positive integer pixel dimensions are required");
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(pixels * 16)) throw new RangeError("Capture byte size is not a safe integer");
  return pixels;
}

export function validateBindings(bindings = DEFAULT_DIAGNOSTIC_BINDINGS) {
  if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > DIAGNOSTIC_LIMITS.maxBindings) throw new TypeError("Diagnostics requires 1..32 explicit bindings");
  const ids = new Set();
  return Object.freeze(bindings.map((binding) => {
    if (!binding || !/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(binding.id) || ids.has(binding.id)) throw new TypeError("Binding identifiers must be unique and explicit");
    if (typeof binding.resource !== "string" || !binding.resource || !DIAGNOSTIC_KINDS.includes(binding.kind)) throw new TypeError("Every binding requires a resource and supported kind");
    if (binding.channel !== undefined && (!Number.isInteger(binding.channel) || binding.channel < 0 || binding.channel > 3)) throw new TypeError("Binding channel must be 0..3");
    if (binding.range !== undefined && (!Array.isArray(binding.range) || binding.range.length !== 2 || !binding.range.every(Number.isFinite) || binding.range[1] <= binding.range[0])) throw new TypeError("Display range requires two increasing finite values");
    for (const name of ["encoding", "unit", "domain", "label"]) if (binding[name] !== undefined && (typeof binding[name] !== "string" || !binding[name].length)) throw new TypeError(`Binding ${name} must be a nonempty string`);
    ids.add(binding.id);
    return Object.freeze({ ...binding, label: binding.label ?? binding.id, ...(binding.range ? { range: Object.freeze([...binding.range]) } : {}) });
  }));
}

export function validateTexture(resource, frame, binding) {
  if (!resource?.texture || resource.available === false) throw new Error(`Unavailable texture: ${binding.resource}`);
  requireExtent(resource.width, resource.height);
  if (resource.frameId !== frame.frameId || resource.viewId !== frame.viewId || resource.generation !== frame.generation) throw new Error(`Stale or cross-view resource: ${binding.resource}`);
  if (resource.origin !== "bottom-left" || typeof resource.encoding !== "string" || !resource.format) throw new Error(`Incomplete texture metadata: ${binding.resource}`);
  if (!["gpu", "synthetic", "reference"].includes(resource.provenance)) throw new Error(`Missing source provenance: ${binding.resource}`);
  if (resource.disposed === true || (resource.isAlive && !resource.isAlive())) throw new Error(`Released resource: ${binding.resource}`);
  if (binding.encoding && binding.encoding !== resource.encoding) throw new Error(`Encoding mismatch for ${binding.resource}`);
  return resource;
}

export function validatePixels(pixels, width, height) {
  const count = requireExtent(width, height);
  if (!(pixels instanceof Float32Array) || pixels.length !== count * 4) throw new TypeError("A complete RGBA float32 pixel readback is required");
  for (const value of pixels) if (!Number.isFinite(value)) throw new Error("Non-finite GPU pixel");
  return pixels;
}

export function sameFrame(left, right) {
  return Boolean(left && right && left.frameId === right.frameId && left.viewId === right.viewId && left.generation === right.generation);
}
