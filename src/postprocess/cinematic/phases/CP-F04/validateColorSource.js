import { validateFrame, validateResource } from "../../contracts/frameContract.js";
import { resolveWorkingColorSpace } from "./workingColorSpace.js";
import { requirePreExposure } from "./preExposure.js";

export function validateColorSource(source, frame, plan, history = false) {
  validateFrame(frame);
  if (history && (frame.cameraCut || frame.frameId === 0)) throw new Error("History is invalid on a first frame or camera cut");
  validateResource(source, history ? { ...frame, frameId: frame.frameId - 1 } : frame, "CP-F04 source");
  if (!source.texture || source.width !== frame.renderSize.width || source.height !== frame.renderSize.height) throw new Error("CP-F04 source extent must match the frame render size");
  if (source.isAlive && !source.isAlive()) throw new Error("Released or overwritten HDR resource");
  if (!source.encoding.startsWith("scene-linear") && source.encoding !== "asset-srgb") throw new Error("HDR ingest rejects display-encoded or unknown color buffers");
  const isFoundationColor = source.encoding === "scene-linear-rec709";
  const space = resolveWorkingColorSpace(source.colorSpace ?? (isFoundationColor ? "rec709" : undefined));
  if (!source.colorSpace && !isFoundationColor) throw new Error("Explicit source primaries and white point are required");
  const transfer = source.transfer ?? (source.encoding.startsWith("scene-linear") ? "linear" : "srgb");
  if (source.encoding.startsWith("scene-linear") && transfer !== "linear") throw new Error("Scene-linear metadata cannot request another sRGB decode");
  const preExposure = requirePreExposure(source.preExposure ?? (!history && isFoundationColor ? frame.preExposure : undefined), "source preExposure");
  if (space.signature !== plan.source.signature || transfer !== plan.sourceTransfer || preExposure !== plan.sourcePreExposure || (source.samplerDecoded ?? false) !== plan.samplerDecoded) throw new Error("Source color metadata does not match its transport plan");
  if (history && source.preExposure !== frame.previousPreExposure) throw new Error("History pre-exposure disagrees with the previous frame");
  return source;
}
