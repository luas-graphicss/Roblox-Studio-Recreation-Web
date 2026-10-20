export function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object`);
  return value;
}

export function requireNumber(value, label, minimum = -Infinity, maximum = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new TypeError(`${label} must be finite in [${minimum}, ${maximum}]`);
  return value;
}

export function requirePositiveGpuFloat(value, label) {
  const rounded = Math.fround(requireNumber(value, label, Number.MIN_VALUE));
  if (!Number.isFinite(rounded) || rounded <= 0) throw new RangeError(`${label} is outside positive GPU float range`);
  return value;
}

export function requireChoice(value, label, choices) {
  if (!choices.includes(value)) throw new TypeError(`${label} must be one of ${choices.join(", ")}`);
  return value;
}

export function requirePixelSize(size, label) {
  for (const axis of ["width", "height"]) if (!Number.isInteger(size?.[axis]) || size[axis] < 1 || size[axis] > 32768) throw new TypeError(`${label} must have integer pixel extents in [1, 32768]`);
  return Object.freeze({ width: size.width, height: size.height });
}

export function resolveCropRectangle(value) {
  requireRecord(value, "outputCropUv");
  const crop = {};
  for (const axis of ["x", "y", "width", "height"]) crop[axis] = requireNumber(value[axis], `outputCropUv.${axis}`, axis === "x" || axis === "y" ? 0 : 0.000001, 1);
  if (crop.x + crop.width > 1 + 1e-12 || crop.y + crop.height > 1 + 1e-12) throw new RangeError("outputCropUv must stay inside the captured image");
  return Object.freeze(crop);
}
