import { resolveWorkingColorSpace } from "../CP-F04/workingColorSpace.js";
import { validateResource } from "../../contracts/frameContract.js";
import { resolveOutputWhitePoint } from "./outputWhitePoint.js";

const encodings = Object.freeze({
  "display-linear-rec709": ["rec709", "linear"],
  "display-linear-rec2020": ["rec2020", "linear"],
  "display-linear-display-p3": ["display-p3", "linear"],
  "display-srgb": ["rec709", "srgb"]
});

export function validateOutputInput(source, frame, settings, plan) {
  validateResource(source, frame, "CP-F28 source");
  if (source.isAlive !== undefined && (typeof source.isAlive !== "function" || source.isAlive() !== true)) throw new Error("CP-F28 source texture lease is expired or invalid");
  const definition = encodings[source.encoding];
  if (!definition) throw new Error(`CP-F28 requires a declared display-referred input, not ${source.encoding}`);
  const [gamut, transfer] = definition;
  if (!source.texture || !["rgba16f", "rgba8"].includes(source.format)) throw new TypeError("CP-F28 requires a supported color texture");
  if (transfer === "linear" && source.format !== "rgba16f") throw new Error("CP-F28 linear transport requires RGBA16F");
  if (source.preExposure !== 1 || source.transfer !== transfer) throw new Error("CP-F28 requires preExposure 1 and matching explicit transfer");
  if (source.samplerDecoded !== undefined && typeof source.samplerDecoded !== "boolean") throw new TypeError("CP-F28 sampler decode state must be boolean");
  if (source.samplerDecoded === true || ["srgb", "display-p3"].includes(source.texture.colorSpace)) throw new Error("CP-F28 cannot decode a sampler-decoded texture twice");
  if (source.width !== frame.outputSize.width || source.height !== frame.outputSize.height) throw new Error("CP-F28 requires output-sized input; it is not an upscaler");
  if (source.outputTransform?.owner === "CP-F28") throw new Error("CP-F28 refuses a second output transform");
  const metadata = source.colorMetadata ?? {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) throw new TypeError("CP-F28 color metadata must be an object");
  if (source.colorSpace != null && ((typeof source.colorSpace !== "string" && typeof source.colorSpace !== "object") || Array.isArray(source.colorSpace))) throw new TypeError("CP-F28 color space must be a name or object");
  if (metadata.transferFunction != null && metadata.transferFunction !== transfer) throw new Error("CP-F28 source transfer metadata contradicts its encoding");
  const declaredGamuts = [metadata.colorPrimaries, typeof source.colorSpace === "string" ? source.colorSpace : source.colorSpace?.name];
  if (declaredGamuts.some(value => value != null && value !== gamut)) throw new Error("CP-F28 source gamut contradicts its encoding");
  const declaredWhite = metadata.whitePoint ?? source.colorSpace?.whitePoint ?? "D65";
  const whitePoint = resolveOutputWhitePoint(declaredWhite);
  if (source.colorSpace?.whitePoint != null) {
    const transportWhite = resolveOutputWhitePoint(source.colorSpace.whitePoint);
    if (transportWhite.some((value, index) => Math.abs(value - whitePoint[index]) > 1e-7)) throw new Error("CP-F28 source white-point metadata is contradictory");
  }
  const standard = resolveWorkingColorSpace(gamut);
  const colorSpace = resolveWorkingColorSpace({ name: gamut, primaries: standard.primaries, whitePoint });
  if (source.colorSpace?.primaries && JSON.stringify(source.colorSpace.primaries) !== JSON.stringify(standard.primaries)) throw new Error("CP-F28 source primary coordinates contradict its encoding");
  const referenceWhiteNits = metadata.referenceWhiteNits ?? (gamut === "rec2020" ? null : settings.paperWhiteNits);
  if (!Number.isFinite(referenceWhiteNits) || referenceWhiteNits <= 0) throw new TypeError("CP-F28 HDR input requires referenceWhiteNits metadata");
  if (metadata.peakNits != null && (!Number.isFinite(metadata.peakNits) || metadata.peakNits < referenceWhiteNits)) throw new TypeError("CP-F28 input peak luminance is invalid");
  const alphaMode = source.alphaMode ?? "straight";
  if (!["straight", "premultiplied", "opaque"].includes(alphaMode)) throw new TypeError("CP-F28 input alpha mode is unsupported");
  const inheritedOetf = transfer === "srgb";
  if (settings.enabled && inheritedOetf && (plan.mode !== "srgb" || plan.dither !== "none" || plan.blackNits !== 0 || colorSpace.signature !== standard.signature || referenceWhiteNits !== settings.paperWhiteNits)) throw new Error("CP-F28 encoded input is copy-only; output changes require a linear provider");
  if (settings.enabled && frame.referenceMode) throw new Error("CP-F28 BLOCKED_REFERENCE: no verified UE5.9 output profile");
  return Object.freeze({ gamut, transfer, colorSpace, referenceWhiteNits, peakNits: metadata.peakNits ?? referenceWhiteNits, alphaMode, alphaModeAssumed: source.alphaMode == null, inheritedOetf, sourceProvenance: source.provenance, inputEncoding: source.encoding });
}
