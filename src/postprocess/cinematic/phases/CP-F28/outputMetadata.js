import { makeTextureResource } from "../../contracts/frameContract.js";
import { OUTPUT_OWNER, OUTPUT_LINEAR_COLOR, OUTPUT_COLOR, OUTPUT_PROFILE } from "./outputContract.js";

export function createLinearOutputResource(target, source, info, frame) {
  return Object.freeze({
    ...makeTextureResource(target, frame, `display-linear-${info.gamut}`),
    preExposure: 1, transfer: "linear", samplerDecoded: false, alphaMode: "straight", colorSpace: info.colorSpace,
    colorMetadata: Object.freeze({ ...(source.colorMetadata ?? {}), colorPrimaries: info.gamut, whitePoint: info.colorSpace.whitePoint, transferFunction: "linear", referenceWhiteNits: info.referenceWhiteNits }),
    sourceProvenance: source.provenance,
    captureMetadata: Object.freeze({ owner: OUTPUT_OWNER, resource: OUTPUT_LINEAR_COLOR, domain: "display-referred", stage: "before-output-gamut-and-transfer", transfer: "linear", oetfCount: 0, includesUi: false, unpremultiplied: true, sceneLinear: false })
  });
}

export function createEncodedOutputResource(target, source, state, frame) {
  const { settings, info, plan, transform } = state;
  const oetfCount = info.inheritedOetf ? 1 : settings.enabled && plan.transfer !== "linear" ? 1 : 0;
  const appliedOetfCount = settings.enabled && !info.inheritedOetf && plan.transfer !== "linear" ? 1 : 0;
  const encoding = settings.enabled ? plan.encoding : source.encoding;
  const colorMetadata = settings.enabled ? {
    colorPrimaries: plan.gamut, whitePoint: plan.whitePoint, referenceWhiteNits: plan.mode === "scrgb" ? 80 : plan.paperWhiteNits,
    paperWhiteNits: plan.paperWhiteNits, peakNits: plan.peakNits, blackNits: plan.blackNits, transferFunction: plan.transfer,
    contentLightLevel: null, masteringLuminanceSource: "authored-target-not-measured-display", nativeHdrVerified: false, referenceVerified: false
  } : { ...(source.colorMetadata ?? {}) };
  return Object.freeze({
    ...makeTextureResource(target, frame, encoding), preExposure: 1,
    transfer: settings.enabled ? plan.transfer : source.transfer, samplerDecoded: false, alphaMode: info.alphaMode,
    colorSpace: settings.enabled ? transform.destination : info.colorSpace,
    colorMetadata: Object.freeze(colorMetadata), sourceProvenance: source.provenance,
    outputTransform: Object.freeze({ owner: OUTPUT_OWNER, profile: OUTPUT_PROFILE, enabled: settings.enabled, inheritedOetf: info.inheritedOetf, oetfCount, appliedOetfCount, appliedExposureCount: 0, appliedToneMappingCount: 0, upstreamToneMapper: source.colorMetadata?.toneMapper ?? null, upstreamExposureCount: null, plan }),
    captureMetadata: Object.freeze({ owner: OUTPUT_OWNER, resource: OUTPUT_COLOR, domain: "display-referred", stage: "after-output-transform", transfer: settings.enabled ? plan.transfer : source.transfer, oetfCount, includesUi: false, sceneLinear: false })
  });
}

export function describeOutputCapture(resource, { includeUi = false } = {}) {
  if (includeUi !== false) throw new Error("CP-F28 UI is composed by the host outside post processing; an explicit host capture is required to include it");
  if (resource?.captureMetadata?.owner !== OUTPUT_OWNER) throw new TypeError("CP-F28 capture requires an owned output resource");
  return Object.freeze({
    ...resource.captureMetadata, encoding: resource.encoding, format: resource.format, width: resource.width, height: resource.height,
    origin: resource.origin, alphaMode: resource.alphaMode, preExposure: resource.preExposure,
    frameId: resource.frameId, viewId: resource.viewId, generation: resource.generation,
    primaries: resource.colorSpace.primaries, whitePoint: resource.colorSpace.whitePoint,
    referenceWhiteNits: resource.colorMetadata.referenceWhiteNits,
    sourceProvenance: resource.sourceProvenance, producerProvenance: resource.provenance,
    applyAdditionalOetf: false, encoderImplementedBy: "CP-F29", nativeHdrVerified: false, referenceVerified: false
  });
}
