import { makeTextureResource } from "../../contracts/frameContract.js";
import { BRIDGE_OWNER, BRIDGE_SIGNAL_ENCODINGS } from "./bridgeContract.js";

export function makeBridgeOutputs(targets, source, frame, layerIds, validationMode) {
  const outputs = {};
  outputs.color = Object.freeze({ ...source, ...makeTextureResource(targets.color, frame, "scene-linear-rec709"), transfer: "linear", preExposure: source.preExposure === undefined ? 1 : source.preExposure, alphaMode: "premultiplied", compositionOwner: BRIDGE_OWNER, compositedLayerIds: Object.freeze([...layerIds]), validationMode, referenceStatus: "BLOCKED_REFERENCE" });
  for (const [kind, encoding] of Object.entries(BRIDGE_SIGNAL_ENCODINGS)) outputs[kind] = Object.freeze({ ...makeTextureResource(targets[kind], frame, encoding), component: kind === "velocity" ? "rgba" : "r", compositionOwner: BRIDGE_OWNER, jitterPixels: frame.jitterPixels ? Object.freeze([...frame.jitterPixels]) : undefined });
  outputs.validation = Object.freeze({ ...makeTextureResource(targets.validation, frame, "CP-F27.invalid-sample-mask-v1"), component: "r", semantics: "zero-valid-one-invalid", validationMode });
  return Object.freeze(outputs);
}
