import { requireFiniteNumber, validateResource } from "../../contracts/frameContract.js";
import { VIGNETTE_OWNER, VIGNETTE_PROFILE, VIGNETTE_PRECISION } from "./vignetteContract.js";

const linearEncodings = new Set(["display-linear-rec709", "display-linear-rec2020", "display-linear-display-p3"]);
const primariesByEncoding = Object.freeze({ "display-linear-rec709": "rec709", "display-linear-rec2020": "rec2020", "display-linear-display-p3": "display-p3" });
const preservedFields = ["colorSpace", "transfer", "preExposure", "samplerDecoded", "alphaMode"];

export function validateVignetteInput(source, frame, settings) {
  validateResource(source, frame, "CP-F24 source");
  if (!source.texture || source.format !== "rgba16f") throw new TypeError("CP-F24 requires an RGBA16F texture; no byte fallback");
  if (source.disposed === true || source.target?.disposed === true) throw new Error("CP-F24 source has been disposed");
  if (source.target && (source.target.texture !== source.texture || source.target.width !== source.width || source.target.height !== source.height)) throw new Error("CP-F24 source target metadata mismatch");
  if (source.preExposure !== undefined) requireFiniteNumber(source.preExposure, "CP-F24 source.preExposure", Number.MIN_VALUE);
  const enabled = settings.enabled && settings.intensity > 0;
  if (!enabled) return;
  if (frame.referenceMode) throw new Error("CP-F24 BLOCKED_REFERENCE: a verified UE5.9 vignette profile is unavailable");
  if (!linearEncodings.has(source.encoding)) throw new Error(`CP-F24 requires post-film display-linear color, not ${source.encoding}`);
  if (source.transfer !== undefined && source.transfer !== "linear") throw new Error("CP-F24 cannot apply a linear vignette after an output transfer");
  if (source.preExposure !== undefined && source.preExposure !== 1) throw new Error("CP-F24 requires pre-exposure removed by the film producer");
  const primaryName = typeof source.colorSpace === "string" ? source.colorSpace : source.colorSpace?.name;
  if (source.colorSpace !== undefined && primaryName !== primariesByEncoding[source.encoding]) throw new Error("CP-F24 color primaries disagree with the encoding");
  if (source.colorMetadata?.vignette?.applied) throw new Error("CP-F24 rejects double vignette application");
}

export function createVignetteMetadata(source, settings) {
  const transport = {};
  for (const key of preservedFields) if (source[key] !== undefined) transport[key] = source[key];
  const applied = settings.enabled && settings.intensity > 0;
  const colorMetadata = { ...(source.colorMetadata ?? {}) };
  if (applied) {
    colorMetadata.referenceVerified = false;
    colorMetadata.vignette = Object.freeze({ owner: VIGNETTE_OWNER, profile: VIGNETTE_PROFILE, applied: true, intensity: settings.intensity, precision: VIGNETTE_PRECISION, referenceVerified: false });
  }
  return { ...transport, colorMetadata: Object.freeze(colorMetadata), sourceProvenance: source.provenance };
}
