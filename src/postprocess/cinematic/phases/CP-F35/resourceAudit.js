import { validateResource } from "../../contracts/frameContract.js";
import { measurePixelBuffer } from "./pixelMetrics.js";

export function inspectResource(resource, frame, name, adapter, capturePixels) {
  validateResource(resource, frame, name);
  if (resource.isAlive && !resource.isAlive())
    throw new Error(`Released resource: ${name}`);
  const stamp = {
    frameId: resource.frameId,
    viewId: resource.viewId,
    generation: resource.generation,
  };
  if (!resource.texture) {
    const state = resource.value;
    const blocked =
      state?.active === false ||
      /blocked|failed|missing/.test(state?.status ?? "");
    return Object.freeze({
      name,
      ...stamp,
      kind: "value",
      provenance: resource.provenance,
      status: blocked ? "blocked-value" : "value-observed",
      reason: state?.reason ?? null,
      pixelProof: false,
    });
  }
  if (
    resource.preExposure !== undefined &&
    (typeof resource.preExposure !== "number" ||
      !Number.isFinite(resource.preExposure) ||
      resource.preExposure <= 0)
  )
    throw new TypeError(`Invalid pre-exposure: ${name}`);
  const metadata = {
    name,
    ...stamp,
    kind: "texture",
    provenance: resource.provenance,
    width: resource.width,
    height: resource.height,
    format: resource.format,
    encoding: resource.encoding,
    origin: resource.origin,
    preExposure: resource.preExposure ?? null,
  };
  if (!capturePixels)
    return Object.freeze({
      ...metadata,
      status: "metadata-only",
      pixelProof: false,
    });
  if (!resource.target || typeof adapter?.readTarget !== "function")
    throw new Error(`No readback target for ${name}`);
  const pixels = adapter.readTarget(resource.target);
  const channels = pixels.length / (resource.width * resource.height);
  const measured = measurePixelBuffer(pixels, {
    width: resource.width,
    height: resource.height,
    channels,
    domain: resource.encoding,
  });
  return Object.freeze({
    ...metadata,
    status: "readback-observed",
    pixelProof: true,
    measurement: measured,
    timing: "synchronous-diagnostic-readback",
  });
}
