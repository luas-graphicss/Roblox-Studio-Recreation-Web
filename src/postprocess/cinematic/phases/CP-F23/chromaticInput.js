import { requireFiniteNumber, validateResource } from "../../contracts/frameContract.js";

export function validateChromaticInput(source, frame, settings) {
  validateResource(source, frame, "CP-F23 source");
  if (!source.texture || source.format !== "rgba16f")
    throw new TypeError("CP-F23 requires an RGBA16F color texture; no byte fallback");
  if (
    source.disposed === true ||
    source.target?.disposed === true ||
    (source.isAlive && !source.isAlive())
  )
    throw new Error("CP-F23 source is released or overwritten");
  if (
    source.target &&
    (source.texture !== source.target.texture ||
      source.width !== source.target.width ||
      source.height !== source.target.height)
  )
    throw new Error("CP-F23 source target metadata mismatch");
  if (source.preExposure !== undefined)
    requireFiniteNumber(source.preExposure, "CP-F23 source.preExposure", Number.MIN_VALUE);
  if (![undefined, "coverage", "straight", "premultiplied", "opaque"].includes(source.alphaMode))
    throw new TypeError("CP-F23 unsupported alphaMode");
  const transforms =
    settings.enabled &&
    ((settings.intensity > 0 && settings.startOffset < 1) || settings.cropMode !== "preserve");
  if (!transforms) return;
  if (frame.referenceMode)
    throw new Error("CP-F23 BLOCKED_REFERENCE: no verified UE5.9 lens profile");
  if (
    !/^(scene|display)-linear-(rec709|rec2020|display-p3|acescg)(-exposed)?$/.test(source.encoding)
  )
    throw new Error("CP-F23 requires explicitly encoded linear color while active");
  if (source.transfer !== undefined && source.transfer !== "linear")
    throw new Error("CP-F23 rejects a non-linear transfer before radial sampling");
  if (
    settings.intensity > 0 &&
    settings.startOffset < 1 &&
    source.colorMetadata?.chromaticAberration?.applied
  )
    throw new Error("CP-F23 rejects double chromatic aberration");
  if (settings.cropMode !== "preserve" && source.colorMetadata?.lensCrop?.applied)
    throw new Error("CP-F23 rejects double lens cropping");
}
