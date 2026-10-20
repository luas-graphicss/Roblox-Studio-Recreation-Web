import { multiplyMatrixVector, requireFiniteVector } from "./colorMatrix.js";
import { createWorkingColorTransform, resolveWorkingColorSpace } from "./workingColorSpace.js";
import { decodeSrgbChannel, resolveTransferDecode } from "./transferFunctions.js";
import { preExposureRatio, requirePreExposure } from "./preExposure.js";
import { assertFiniteHdrChannels } from "./hdrFormatPolicy.js";

export function createColorTransportPlan({ sourceSpace = "rec709", workingSpace = "rec709", sourceTransfer = "linear", samplerDecoded = false, sourcePreExposure = 1, destinationPreExposure = 1, negativePolicy = "preserve", formatPolicy }) {
  if (!formatPolicy || !["rgba16f", "rgba8"].includes(formatPolicy.format)) throw new TypeError("A negotiated output format is required");
  if (!["preserve", "clamp-zero"].includes(negativePolicy)) throw new TypeError("Unknown negative radiance policy");
  const source = resolveWorkingColorSpace(sourceSpace);
  const destination = resolveWorkingColorSpace(workingSpace);
  const decodeSrgb = resolveTransferDecode(sourceTransfer, samplerDecoded);
  requirePreExposure(sourcePreExposure);
  requirePreExposure(destinationPreExposure);
  if (sourceTransfer === "srgb" && sourcePreExposure !== 1) throw new Error("sRGB assets must be decoded before applying pre-exposure");
  return Object.freeze({ source, destination, sourceTransfer, samplerDecoded, sourcePreExposure, destinationPreExposure, decodeSrgb, matrix: createWorkingColorTransform(source, destination), exposureRatio: preExposureRatio(sourcePreExposure, destinationPreExposure), negativePolicy, formatPolicy });
}

export function transportRadianceRgb(rgb, plan) {
  let color = requireFiniteVector(rgb, 3, "RGB input");
  if (plan.decodeSrgb) color = color.map(decodeSrgbChannel);
  color = multiplyMatrixVector(plan.matrix, color).map((channel) => channel * plan.exposureRatio);
  if (plan.negativePolicy === "clamp-zero") color = color.map((channel) => Math.max(0, channel));
  assertFiniteHdrChannels(color, plan.formatPolicy);
  return plan.formatPolicy.hdr ? color : color.map((channel) => Math.min(1, Math.max(0, channel)));
}
