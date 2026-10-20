import { makeTextureResource } from "../../contracts/frameContract.js";
import { describeLookColor } from "./lookColorMetadata.js";

const preservedColorFields = Object.freeze(["colorSpace", "transfer", "samplerDecoded", "formatPolicy", "alphaMode"]);

export function createLookOutput(input, target, frame, plan, transport, isAlive) {
  const metadata = {};
  if (!plan.changesEncoding) {
    for (const field of preservedColorFields) if (input[field] !== undefined) metadata[field] = input[field];
    if (input.format !== "rgba16f") delete metadata.formatPolicy;
  } else {
    Object.assign(metadata, describeLookColor(transport.outputEncoding));
    if (input.alphaMode !== undefined) metadata.alphaMode = input.alphaMode;
    const look = plan.looks[0].look;
    metadata.lutTransform = Object.freeze({ id: look.id, kind: look.kind, inputEncoding: look.inputEncoding, outputEncoding: look.outputEncoding, provenance: look.provenance, externalTransform: look.externalTransform });
  }
  return Object.freeze({
    ...metadata,
    ...makeTextureResource(target, frame, transport.outputEncoding),
    preExposure: plan.enabled ? transport.outputScale : transport.preExposure,
    isAlive
  });
}
