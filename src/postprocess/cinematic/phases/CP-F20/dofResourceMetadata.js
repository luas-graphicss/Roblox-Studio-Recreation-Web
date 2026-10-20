import { makeTextureResource } from "../../contracts/frameContract.js";
import { readDofPreExposure } from "./dofInputValidation.js";

export function makeDofColorResource(target, frame, source) {
  return Object.freeze({ ...source, ...makeTextureResource(target, frame, source.encoding, source.provenance), preExposure: readDofPreExposure(source), alphaMode: source.alphaMode ?? "opaque", transfer: "linear", processedBy: "CP-F20" });
}

export function makeDofValueResource(frame, value) {
  return Object.freeze({ frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "gpu", value });
}
