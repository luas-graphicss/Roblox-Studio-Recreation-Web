import { validateResource } from "../../contracts/frameContract.js";
import { DOF_INPUT_ENCODINGS } from "./dofTemporalContract.js";

export function validateDofInput(resource, frame, key) {
  validateResource(resource, frame, `CP-F20 ${key}`);
  if (!resource.texture || resource.width !== frame.renderSize.width || resource.height !== frame.renderSize.height) throw new Error(`CP-F20 ${key} must match the full render extent`);
  if (resource.encoding !== DOF_INPUT_ENCODINGS[key]) throw new Error(`CP-F20 ${key} requires ${DOF_INPUT_ENCODINGS[key]}`);
  const floatFormats = ["rgba16f", "rg16f", "r16f", "r32f"];
  if (["circleOfConfusion", "linearDepth", "velocity"].includes(key) && !floatFormats.includes(resource.format)) throw new Error(`CP-F20 ${key} requires a floating-point texture`);
  if (key === "velocity" && resource.format !== "rgba16f") throw new Error("CP-F20 velocity requires RGBA16F with validity in alpha");
  if (["coverage", "reactiveMask"].includes(key) && ![...floatFormats, "rgba8"].includes(resource.format)) throw new Error(`Unsupported CP-F20 ${key} format`);
  if (resource.released === true || resource.disposed === true) throw new Error(`CP-F20 ${key} has been released`);
  return resource;
}

export function isRepresentableDofExposure(value) {
  return typeof value === "number" && Number.isFinite(Math.fround(value)) && Math.fround(value) >= 2 ** -126;
}

export function readDofPreExposure(source) {
  const value = source.preExposure === undefined ? 1 : source.preExposure;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError("CP-F20 source preExposure must be finite and positive");
  if (!isRepresentableDofExposure(value)) throw new RangeError("CP-F20 source preExposure must be representable as a normal GPU float");
  return value;
}

export function validateDofColor(source, frame) {
  validateResource(source, frame, "CP-F20 source color");
  if (!source.texture || source.format !== "rgba16f" || source.encoding !== "scene-linear-rec709" || source.width !== frame.renderSize.width || source.height !== frame.renderSize.height) throw new Error("CP-F20 requires full-render RGBA16F scene-linear-rec709 color after bokeh recombination");
  if (source.transfer != null && source.transfer !== "linear") throw new Error("CP-F20 does not accept display-encoded color");
  if (source.alphaMode != null && !["opaque", "premultiplied"].includes(source.alphaMode)) throw new Error("CP-F20 requires opaque or premultiplied color");
  if (source.colorSpace != null) {
    const space = source.colorSpace;
    if (typeof space === "string" ? space !== "rec709" : space.name !== "rec709") throw new Error("CP-F20 working primaries must be Rec709");
    if (typeof space === "object") {
      const expectedPrimaries = [0.64, 0.33, 0.3, 0.6, 0.15, 0.06];
      const actualPrimaries = space.primaries?.flat?.();
      if (!actualPrimaries || actualPrimaries.length !== 6 || actualPrimaries.some((value, index) => !Number.isFinite(value) || Math.abs(value - expectedPrimaries[index]) > 0.000001)) throw new Error("CP-F20 contradictory Rec709 primary metadata");
      if (!Array.isArray(space.whitePoint) || space.whitePoint.length !== 2 || space.whitePoint.some((value, index) => !Number.isFinite(value) || Math.abs(value - [0.3127, 0.329][index]) > 0.000001)) throw new Error("CP-F20 requires the Rec709 D65 white point");
    }
  }
  readDofPreExposure(source);
  return source;
}

export function dofColorSignature(source) {
  return JSON.stringify([source.encoding, source.colorSpace ?? "B00-rec709", source.alphaMode ?? "opaque"]);
}

export function readDofJitter(frame) {
  const current = frame.jitterPixels ?? [0, 0];
  const previous = frame.previousJitterPixels ?? [0, 0];
  for (const values of [current, previous]) if (!Array.isArray(values) || values.length !== 2 || !values.every(Number.isFinite)) throw new TypeError("CP-F20 jitter requires two finite pixel components");
  return [previous[0] - current[0], previous[1] - current[1]];
}
