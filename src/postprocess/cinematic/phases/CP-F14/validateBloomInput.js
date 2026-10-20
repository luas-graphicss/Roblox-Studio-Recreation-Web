import { validateResource } from "../../contracts/frameContract.js";
import { readBloomPreExposure } from "./bloomInputExposure.js";

export function validateBloomServices(services) {
  const { rendererAdapter: adapter, pool, capabilities } = services;
  if (!capabilities?.webgl2 || !capabilities?.floatColorBuffer) throw new Error("CP-F14 requires WebGL2 and float color buffers");
  if (![adapter?.createMaterial, adapter?.draw, pool?.acquire, pool?.release].every((operation) => typeof operation === "function")) {
    throw new TypeError("CP-F14 requires material, draw and resource-pool services");
  }
}

export function validateBloomInput(source, frame, capabilities) {
  validateResource(source, frame, "CP-F14 scene input");
  if (!source.texture || source.format !== "rgba16f" || source.encoding !== "scene-linear-rec709") {
    throw new Error("CP-F14 requires scene-linear-rec709 RGBA16F input; no implicit color conversion");
  }
  if (source.isAlive && !source.isAlive()) throw new Error("CP-F14 input lease has expired");
  if (source.transfer !== undefined && source.transfer !== "linear") throw new Error("CP-F14 requires a linear transfer function");
  if (source.samplerDecoded === true) throw new Error("CP-F14 input cannot be implicitly sampler-decoded");
  if (source.width > capabilities.maxTextureSize || source.height > capabilities.maxTextureSize) throw new RangeError("CP-F14 exceeds maximum texture dimensions");
  readBloomPreExposure(source);
  if (frame.referenceMode) throw new Error("CP-F14 BLOCKED_REFERENCE: diagnostic profile has no verified UE5.9 reference");
}
