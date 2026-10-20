import { CAPTURE_COLOR_SCHEMA } from "./captureContract.js";
import { finite, choice } from "./captureValidation.js";

export function validateCaptureColor(color, format) {
  if (!color || color.schema !== CAPTURE_COLOR_SCHEMA) throw new TypeError("Capture requires explicit color metadata; color domains are never inferred");
  choice(color.domain, "color domain", ["scene-linear", "display-linear", "display-encoded"]);
  choice(color.alphaMode, "source alpha", ["straight", "premultiplied", "opaque"]);
  if (typeof color.primaries !== "string" || !color.primaries || typeof color.whitePoint !== "string" || !color.whitePoint) throw new TypeError("Capture primaries and white point are required");
  finite(color.preExposure, "preExposure", Number.MIN_VALUE, Number.MAX_VALUE);
  if (!Array.isArray(color.transforms) || color.transforms.some((entry) => typeof entry !== "string") || new Set(color.transforms).size !== color.transforms.length) throw new Error("Color transforms must be uniquely identified");
  if (format === "png") {
    if (color.domain !== "display-encoded" || color.transfer !== "srgb" || color.primaries !== "rec709" || color.whitePoint !== "D65" || color.oetfApplications !== 1 || color.preExposure !== 1) throw new Error("PNG requires an already encoded sRGB/Rec709 D65 output with exactly one OETF");
    if (color.alphaMode === "premultiplied") throw new Error("Encoded premultiplied RGB cannot be safely unassociated; resolve alpha before the output transform");
  } else if (color.domain === "display-encoded" || color.transfer !== "linear" || color.oetfApplications !== 0) throw new Error("Float/EXR export requires linear color without baked OETF");
  if (color.domain !== "scene-linear" && color.preExposure !== 1) throw new Error("Display-referred color cannot contain scene pre-exposure");
  return Object.freeze({ ...color, transforms: Object.freeze([...color.transforms]) });
}

export function captureColorSignature(color) {
  return JSON.stringify([color.domain, color.primaries, color.whitePoint, color.transfer, color.alphaMode, color.oetfApplications, color.transforms]);
}
