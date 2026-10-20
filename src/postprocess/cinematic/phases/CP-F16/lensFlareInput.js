import { validateResource } from "../../contracts/frameContract.js";

export function readLensFlarePreExposure(source) {
  const value = source.preExposure === undefined ? 1 : source.preExposure;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 2 ** -20 || value > 2 ** 20) throw new RangeError("CP-F16 requires source preExposure in [2^-20, 2^20]; frame exposure is not a fallback");
  return value;
}

export function validateLensFlareInput(source, frame, capabilities, active = true) {
  validateResource(source, frame, "CP-F16 HDR image");
  if (!source.texture || source.format !== "rgba16f") throw new TypeError("CP-F16 requires an explicit RGBA16F texture");
  if (source.isAlive !== undefined) {
    if (typeof source.isAlive !== "function") throw new TypeError("CP-F16 input lease requires an isAlive predicate");
    if (source.isAlive() !== true) throw new Error("CP-F16 input lease has expired or is not explicitly alive");
  }
  if (source.width > capabilities.maxTextureSize || source.height > capabilities.maxTextureSize) throw new RangeError("CP-F16 input exceeds maximum texture dimensions");
  if (!active) return;
  if (frame.referenceMode) throw new Error("CP-F16 BLOCKED_REFERENCE: the diagnostic profile has no verified UE5.9 reference");
  const colorSpace = typeof source.colorSpace === "string" ? source.colorSpace : source.colorSpace?.name;
  if (source.encoding !== "scene-linear-rec709" || source.colorSpace !== undefined && colorSpace !== "rec709") throw new TypeError("CP-F16 only accepts scene-linear Rec709; no implicit primaries or exposure conversion");
  if (source.transfer !== undefined && source.transfer !== "linear" || source.samplerDecoded !== undefined && source.samplerDecoded !== false) throw new TypeError("CP-F16 refuses encoded or implicitly decoded color");
  readLensFlarePreExposure(source);
}

export function makeLensFlareColorMetadata(source, active) {
  const metadata = {};
  for (const key of ["colorSpace", "transfer", "samplerDecoded", "preExposure", "alphaMode", "formatPolicy", "rangeValidation"]) if (source[key] !== undefined) metadata[key] = source[key];
  if (active) {
    metadata.transfer = "linear";
    metadata.samplerDecoded = false;
    metadata.preExposure = readLensFlarePreExposure(source);
    metadata.rangeValidation = "diagnostic-output-mask-CP-F16.rangeMask";
    if (source.formatPolicy) metadata.formatPolicy = Object.freeze({ ...source.formatPolicy, exactHdrEligible: false });
  }
  return metadata;
}
