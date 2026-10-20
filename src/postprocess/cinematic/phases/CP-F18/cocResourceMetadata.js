import { makeTextureResource } from "../../contracts/frameContract.js";
import { COC_ENCODINGS, COC_OWNER } from "./cocContract.js";

export function createCocResource(name, target, frame, plan, color = null) {
  const encoding = name === "nearColor" || name === "farColor" ? color.encoding : COC_ENCODINGS[name] ?? COC_ENCODINGS.tiles;
  const transport = color ? Object.fromEntries(["colorSpace", "transfer", "samplerDecoded", "preExposure", "exposureApplied", "exposureResource"].filter((key) => color[key] !== undefined).map((key) => [key, color[key]])) : {};
  return Object.freeze({
    ...transport,
    ...makeTextureResource(target, frame, encoding),
    owner: COC_OWNER,
    inputProvenance: color?.provenance ?? "declared-depth-and-camera",
    jitterPixels: Object.freeze([...(frame.jitterPixels ?? [0, 0])]),
    ...(color ? { preExposure: color.preExposure ?? 1, alphaMode: "premultiplied", coverageApplied: true, layer: name === "nearColor" ? "near" : "focus-and-far" } : { radiusUnits: "render-pixels" }),
    downsampleFactor: plan.settings.downsampleFactor,
    referenceVerified: false
  });
}

export function createCocParameters(frame, plan, source, inputPolicy) {
  return Object.freeze({
    value: Object.freeze({ ...plan, inputPolicy, sourceColorEncoding: source.encoding, sourcePreExposure: source.preExposure ?? 1, colorUntouched: true, outputAlphaMode: "premultiplied", classificationDilatedConservatively: true }),
    frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "gpu"
  });
}
