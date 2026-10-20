export function requireFiniteNumber(value, label, minimum = -Infinity, maximum = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be finite in [${minimum}, ${maximum}]`);
  }
  return value;
}

export function validateSize(size, label) {
  if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) {
    throw new TypeError(`${label} requires positive integer pixel dimensions`);
  }
  return size;
}

export function validateFrame(frame) {
  if (!frame || typeof frame.viewId !== "string" || frame.viewId.length === 0) throw new TypeError("Frame requires a viewId");
  for (const field of ["frameId", "generation"]) {
    if (!Number.isInteger(frame[field]) || frame[field] < 0) throw new TypeError(`Invalid ${field}`);
  }
  requireFiniteNumber(frame.timeSeconds, "timeSeconds", 0);
  requireFiniteNumber(frame.deltaSeconds, "deltaSeconds", 0, 1);
  requireFiniteNumber(frame.preExposure, "preExposure", Number.MIN_VALUE);
  requireFiniteNumber(frame.previousPreExposure, "previousPreExposure", Number.MIN_VALUE);
  validateSize(frame.renderSize, "renderSize");
  validateSize(frame.outputSize, "outputSize");
  return frame;
}

export function validateResource(resource, frame, label = "resource") {
  if (!resource || typeof resource !== "object") throw new TypeError(`Missing ${label}`);
  if (resource.frameId !== frame.frameId || resource.viewId !== frame.viewId || resource.generation !== frame.generation) {
    throw new Error(`Stale or cross-view ${label}`);
  }
  if (!["gpu", "synthetic", "reference"].includes(resource.provenance)) throw new TypeError(`Missing provenance for ${label}`);
  if (resource.texture) {
    validateSize(resource, label);
    if (!resource.format || !resource.encoding || resource.origin !== "bottom-left") throw new TypeError(`Invalid texture metadata for ${label}`);
  } else if (!("value" in resource)) {
    throw new TypeError(`${label} requires a texture or value`);
  }
  return resource;
}

export function makeTextureResource(target, frame, encoding, provenance = "gpu") {
  return Object.freeze({
    texture: target.texture,
    target,
    width: target.width,
    height: target.height,
    format: target.userData?.format ?? "rgba16f",
    encoding,
    origin: "bottom-left",
    frameId: frame.frameId,
    viewId: frame.viewId,
    generation: frame.generation,
    provenance
  });
}
