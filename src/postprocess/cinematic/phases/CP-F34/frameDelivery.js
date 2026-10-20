import { validateFrame, validateResource } from "../../contracts/frameContract.js";
import { samePixelSize } from "./adapterValidation.js";

export function validateHostFrame(frame, dimensions) {
  validateFrame(frame);
  if (!samePixelSize(frame.renderSize, dimensions.renderSize) || !samePixelSize(frame.outputSize, dimensions.outputSize)) {
    throw new Error("Host frame dimensions do not match physical render and output sizes");
  }
  return frame;
}

export function captureFrameIdentity(frame) {
  return JSON.stringify([frame.frameId, frame.viewId, frame.generation, frame.timeSeconds, frame.deltaSeconds, frame.renderSize, frame.outputSize]);
}

export function validateCapturedInputs(inputs, frame) {
  if (!inputs || typeof inputs !== "object") throw new TypeError("Captured inputs are required");
  for (const [name, resource] of Object.entries(inputs)) validateResource(resource, frame, name);
  const color = inputs.sceneColor;
  if (!color?.texture || !samePixelSize(color, frame.renderSize)) throw new Error("Missing or incorrectly sized captured sceneColor");
  if (color.format !== "rgba16f" || color.encoding !== "scene-linear-rec709") throw new Error("Host must supply B00 scene-linear Rec.709 HDR color");
  if (color.preExposure !== 1) throw new Error("B00 captured color requires preExposure equal to one");
  if (color.transfer !== undefined && color.transfer !== "linear") throw new Error("Captured color transfer contradicts scene-linear encoding");
  if (color.colorSpace !== undefined && color.colorSpace !== "rec709") throw new Error("Captured color primaries contradict Rec.709 encoding");
  return inputs;
}

function resolveColorSpaceName(color) {
  if (typeof color.colorSpace === "string") return color.colorSpace;
  if (color.colorSpace && typeof color.colorSpace === "object" && typeof color.colorSpace.name === "string") return color.colorSpace.name;
  return color.colorMetadata?.colorPrimaries;
}

export function validateOutputColor(color, frame, contract) {
  validateResource(color, frame, "presented color");
  if (!color.texture || !samePixelSize(color, frame.outputSize)) throw new Error("Output must match physical display dimensions");
  for (const key of ["encoding", "transfer"]) {
    if (color[key] !== contract[key]) throw new Error(`Output ${key} does not match the presentation contract`);
  }
  if (resolveColorSpaceName(color) !== contract.colorSpace) throw new Error("Output colorSpace does not match the presentation contract");
  const transform = color.outputTransform;
  if (!transform || transform.enabled !== true) throw new Error("Output transform was not applied by the display output stage");
  if (transform.oetfCount !== contract.outputTransferApplications) throw new Error("Invalid output outputTransferApplications");
  if (transform.appliedExposureCount !== 0 || transform.appliedToneMappingCount !== 0) throw new Error("Output stage must not re-apply exposure or tone mapping");
  const toneMapped = typeof transform.upstreamToneMapper === "string" && transform.upstreamToneMapper.length > 0;
  if (toneMapped !== (contract.toneMappingApplications === 1)) throw new Error("Invalid output toneMappingApplications");
  return color;
}
