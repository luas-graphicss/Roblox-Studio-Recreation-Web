import { validateSize, requireFiniteNumber } from "../../contracts/frameContract.js";
import { MAX_FOOTPRINT_EXTENT } from "./diaphragmContract.js";
import { diaphragmFootprintExtent } from "./diaphragmAperture.js";

export function createDiaphragmPlan(size, settings, maxima = { near: 0, far: 0 }, capabilities = {}) {
  validateSize(size, "CP-F19 size");
  const pixelCount = size.width * size.height;
  if (!Number.isSafeInteger(pixelCount)) throw new RangeError("CP-F19 unsafe pixel count");
  if (Math.max(size.width, size.height) > (capabilities.maxTextureSize ?? 16384)) throw new RangeError("CP-F19 target exceeds device texture extent");
  requireFiniteNumber(maxima.near, "CP-F19 maximum near CoC", 0, settings.maxRadiusPixels);
  requireFiniteNumber(maxima.far, "CP-F19 maximum far CoC", 0, settings.maxRadiusPixels);
  const nearExtent = diaphragmFootprintExtent(maxima.near, settings), farExtent = diaphragmFootprintExtent(maxima.far, settings);
  if ([...nearExtent, ...farExtent].some((value) => value > MAX_FOOTPRINT_EXTENT)) throw new RangeError("CP-F19 footprint exceeds shader limit");
  const count = (extent) => (extent[0] * 2 + 1) * (extent[1] * 2 + 1);
  const nearSamples = count(nearExtent), farSamples = count(farExtent);
  const holeSamples = (settings.holeFillRadiusPixels * 2 + 1) ** 2;
  const targetBytes = settings.enabled ? pixelCount * 36 : pixelCount * 8 + 28;
  const sampleVisits = settings.enabled ? pixelCount * (Math.max(nearSamples, farSamples) + nearSamples + farSamples + holeSamples + 1) : pixelCount + 4;
  if (!Number.isSafeInteger(sampleVisits) || sampleVisits > settings.sampleVisitBudget) throw new RangeError(`CP-F19 sample budget exceeded: ${sampleVisits}; no silent quality reduction`);
  if (targetBytes > settings.memoryBudgetBytes) throw new RangeError(`CP-F19 memory budget exceeded: ${targetBytes}`);
  return Object.freeze({ active: settings.enabled, width: size.width, height: size.height, nearExtent, farExtent,
    nearPath: maxima.near <= settings.smallRadiusPixels ? "small-full-resolution" : "large-full-resolution",
    farPath: maxima.far <= settings.smallRadiusPixels ? "small-full-resolution" : "large-full-resolution",
    nearSamples, farSamples, holeSamples, sampleVisits, targetBytes, drawCalls: 5,
    requiredOverlapPixels: Math.max(...nearExtent, ...farExtent) + settings.holeFillRadiusPixels,
    accounting: "upper-bound-source-visits-and-owned-target-bytes", performanceStatus: "not-production-timing" });
}
