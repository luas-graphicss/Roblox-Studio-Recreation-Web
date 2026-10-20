import { makeTextureResource } from "../../contracts/frameContract.js";
import { DIAPHRAGM_OWNER, DIAPHRAGM_PROFILE } from "./diaphragmContract.js";

export function makeDiaphragmColor(target, frame, source, metadata) {
  return Object.freeze({ ...makeTextureResource(target, frame, source.encoding), colorSpace: source.colorSpace,
    transfer: source.transfer ?? "linear", preExposure: metadata.preExposure, alphaMode: metadata.alphaMode,
    jitterSignature: source.jitterSignature, sourceProvenance: source.provenance });
}

export function makeDiaphragmLayer(target, frame, encoding, source, metadata) {
  return Object.freeze({ ...makeTextureResource(target, frame, encoding), colorSpace: source.colorSpace,
    transfer: "linear", preExposure: metadata.preExposure, jitterSignature: source.jitterSignature,
    sourceProvenance: source.provenance });
}

export function makeDiaphragmDiagnostics(frame, settings, plan, bindings, source, coc, metadata) {
  return Object.freeze({ frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "gpu",
    value: Object.freeze({ owner: DIAPHRAGM_OWNER, profile: DIAPHRAGM_PROFILE, active: plan.active,
      reason: plan.active ? "explicit-CoC-and-surface-bindings" : "disabled-no-synthetic-runtime-provider",
      plan, settings, bindings, sourceProvenance: source.provenance, cocProvenance: coc?.provenance ?? null,
      preExposure: metadata.preExposure, referenceStatus: "BLOCKED_REFERENCE", integrationStatus: "external-provider-must-be-verified",
      inputValidation: "kernelNormalization.r < 0 marks invalid input; output is diagnostic magenta",
      nearEncoding: "straight-radiance-filtered-coverage", farEncoding: "straight-radiance-filtered-support",
      holeFillPolicy: "opaque-only-depth-aware; negative filledFar alpha marks unresolved hidden background",
      hiddenBackgroundFallback: "source-center-radiance-with-negative-confidence",
      boundaryPolicy: "zero-outside-input; tiled capture requires declared overlap",
      alphaPolicy: "single-visible-layer; no inferred multilayer translucency",
      highlightPolicy: "scene-linear integration; no boost or luminance clamp",
      readbackInRuntime: false, timing: "not-production-timing" }) });
}
