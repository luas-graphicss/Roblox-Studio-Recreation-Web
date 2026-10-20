import { validateResource } from "../../contracts/frameContract.js";
import { BRIDGE_SIGNAL_ENCODINGS, BRIDGE_OWNER } from "./bridgeContract.js";
import { requireNumber } from "./bridgeValidation.js";

export function validateBridgeTexture(resource, frame, label, extent) {
  validateResource(resource, frame, `CP-F27 ${label}`);
  if (!resource.texture || resource.available === false || resource.disposed === true || resource.released === true || resource.target?.disposed === true) throw new Error(`CP-F27 missing or released texture: ${label}`);
  if (extent && (resource.width !== extent.width || resource.height !== extent.height)) throw new Error(`CP-F27 incompatible extent: ${label}; explicit resampling provider required`);
  if (resource.jitterPixels && (!frame.jitterPixels || resource.jitterPixels.length !== 2 || resource.jitterPixels.some((value, index) => !Number.isFinite(value) || value !== frame.jitterPixels[index]))) throw new Error(`CP-F27 mismatched jitter: ${label}`);
  return resource;
}

export function readBridgePreExposure(resource) {
  return requireNumber(resource.preExposure === undefined ? 1 : resource.preExposure, "source preExposure", Number.MIN_VALUE, Number.MAX_VALUE);
}

export function validateBridgeColor(resource, frame, label = "color", extent) {
  validateBridgeTexture(resource, frame, label, extent);
  if (resource.format !== "rgba16f" || resource.encoding !== "scene-linear-rec709" || resource.transfer !== undefined && resource.transfer !== "linear" || resource.displayEncoded === true || resource.toneMapped === true) throw new Error(`CP-F27 requires scene-linear Rec709 RGBA16F, not tonemapped/display color: ${label}`);
  if (resource.alphaMode !== undefined && !["opaque", "premultiplied"].includes(resource.alphaMode)) throw new Error(`CP-F27 requires premultiplied or opaque alpha: ${label}`);
  const space = resource.colorSpace;
  if (space !== undefined) {
    if (typeof space === "string" ? space !== "rec709" : !space || space.name !== "rec709") throw new Error("CP-F27 unsupported working primaries; convert explicitly through CP-F04");
    if (typeof space === "object") {
      const primaries = space.primaries?.flat?.();
      const expected = [0.64, 0.33, 0.3, 0.6, 0.15, 0.06];
      if (!primaries || primaries.length !== 6 || primaries.some((value, index) => !Number.isFinite(value) || Math.abs(value - expected[index]) > 1e-6) || !Array.isArray(space.whitePoint) || space.whitePoint.length !== 2 || space.whitePoint.some((value, index) => !Number.isFinite(value) || Math.abs(value - [0.3127, 0.329][index]) > 1e-6)) throw new Error("CP-F27 contradictory Rec709 color metadata");
    }
  }
  readBridgePreExposure(resource);
  return resource;
}

export function validateBridgeSignals(signals, frame, extent, label) {
  for (const [kind, encoding] of Object.entries(BRIDGE_SIGNAL_ENCODINGS)) {
    const resource = validateBridgeTexture(signals[kind], frame, `${label}.${kind}`, extent);
    if (resource.encoding !== encoding) throw new Error(`CP-F27 ${label}.${kind} requires ${encoding}`);
    if (kind === "velocity" ? resource.format !== "rgba16f" : !["r16f", "r32f", "rgba16f", "rgba8"].includes(resource.format)) throw new Error(`CP-F27 invalid ${kind} format`);
    if (kind !== "velocity" && resource.component !== undefined && resource.component !== "r") throw new Error(`CP-F27 ${kind} must be in the red channel`);
  }
  return signals;
}

export function validateBridgeLayer(color, definition, stage, frame, extent, composedIds) {
  validateBridgeColor(color, frame, definition.id, extent);
  if (color.alphaMode !== "premultiplied" || color.layerId !== definition.id || color.domain !== definition.domain || color.compositionStage !== stage || color.compositionOwner !== BRIDGE_OWNER || color.depthTested !== true || color.sortPolicy !== "back-to-front" || color.includesBackground !== false) throw new Error(`CP-F27 invalid layer ownership, sorting, visibility or premultiplication: ${definition.id}`);
  if (color.composited === true || composedIds.includes(definition.id)) throw new Error(`CP-F27 duplicate composition: ${definition.id}`);
  return color;
}
