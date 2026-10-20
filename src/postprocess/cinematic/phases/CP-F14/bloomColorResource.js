import { readBloomPreExposure } from "./bloomInputExposure.js";
import { makeTextureResource } from "../../contracts/frameContract.js";

export function makeBloomColorResource(target, frame, source) {
  return Object.freeze({
    ...makeTextureResource(target, frame, source.encoding),
    ...(source.colorSpace === undefined ? {} : { colorSpace: source.colorSpace }),
    ...(source.formatPolicy === undefined ? {} : { formatPolicy: Object.freeze({ ...source.formatPolicy, exactHdrEligible: false }) }),
    transfer: "linear",
    samplerDecoded: false,
    preExposure: readBloomPreExposure(source),
    sourceProvenance: source.provenance,
    rangeValidation: "diagnostic-output-mask-CP-F14.rangeMask"
  });
}
