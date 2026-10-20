import { validateResource, requireFiniteNumber } from "../../contracts/frameContract.js";
import { COC_ENCODING, SURFACE_ENCODING } from "./diaphragmContract.js";

function requireTexture(resource, frame, label, formats) {
  validateResource(resource, frame, label);
  if (!resource.texture || !formats.includes(resource.format)) throw new TypeError(`${label} requires ${formats.join(" or ")} texture`);
  if (resource.disposed || resource.released) throw new Error(`${label} has been released`);
  if (resource.width !== frame.renderSize.width || resource.height !== frame.renderSize.height) throw new RangeError(`${label} must match render extent; CoC resampling is not implicit`);
}

export function validateDiaphragmInputs(source, coc, surface, frame, enabled) {
  requireTexture(source, frame, "CP-F19 color", ["rgba16f", "rgba32f"]);
  const preExposure = source.preExposure === undefined ? 1 : source.preExposure;
  requireFiniteNumber(preExposure, "CP-F19 source preExposure", Number.MIN_VALUE);
  if (!enabled) return { preExposure, alphaMode: source.alphaMode ?? "opaque" };
  if (frame.referenceMode) throw new Error("CP-F19 BLOCKED_REFERENCE: no verified UE5.9 diaphragm profile");
  if (!["scene-linear-rec709", "scene-linear-display-p3", "scene-linear-rec2020", "scene-linear-acescg"].includes(source.encoding) || source.transfer !== undefined && source.transfer !== "linear") throw new TypeError("CP-F19 requires scene-linear input");
  if (!["opaque", "straight", "premultiplied"].includes(source.alphaMode)) throw new TypeError("CP-F19 requires explicit alphaMode");
  requireTexture(coc, frame, "CP-F19 CoC", ["r16f", "r32f"]);
  requireTexture(surface, frame, "CP-F19 surface", ["rgba16f", "rgba32f"]);
  if (new Set([source.texture, coc.texture, surface.texture]).size !== 3) throw new Error("CP-F19 input textures must be distinct");
  if (coc.encoding !== COC_ENCODING || coc.units !== "render-pixel-radius") throw new TypeError("CP-F19 CoC must be signed render-pixel radius");
  if (surface.encoding !== SURFACE_ENCODING || surface.depthUnits !== "meters" || surface.coverageMatchesColorAlpha !== true) throw new TypeError("CP-F19 surface requires meters, alpha-matched coverage, sky and validity");
  if (surface.layerModel !== "single-visible-layer") throw new Error("CP-F19 multilayer transparency requires CP-F27 integration");
  if (typeof coc.jitterSignature !== "string" || coc.jitterSignature !== surface.jitterSignature || coc.jitterSignature !== source.jitterSignature) throw new Error("CP-F19 jitter signatures must match");
  requireFiniteNumber(coc.maxNearRadiusPixels, "CP-F19 advertised near radius", 0, 24);
  requireFiniteNumber(coc.maxFarRadiusPixels, "CP-F19 advertised far radius", 0, 24);
  return { preExposure, alphaMode: source.alphaMode, maxima: { near: coc.maxNearRadiusPixels, far: coc.maxFarRadiusPixels } };
}
