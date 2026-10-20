import { validateUnitInterval } from "./depthMath.js";
import { validateIdentifier } from "./identifierCodec.js";

export function resolveGeometrySamples(samples) {
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 8) throw new TypeError("CP-F05 requires 1..8 explicit geometry samples");
  let selected = null;
  let coverageSum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!sample || !("coverage" in sample)) throw new Error("CP-F05 multisample resolve requires coverage for every sample");
    const coverage = validateUnitInterval(sample.coverage, "sample coverage");
    coverageSum += coverage;
    if (coverage === 0) continue;
    validateUnitInterval(sample.depth, "sample depth");
    if (!sample.normal || sample.normal.length !== 3 || !sample.normal.every(Number.isFinite) || Math.hypot(...sample.normal) < 1e-10) throw new TypeError("CP-F05 covered samples require a valid normal");
    validateIdentifier(sample.objectId, "sample object ID");
    validateIdentifier(sample.materialId, "sample material ID");
    validateIdentifier(sample.stencil ?? 0, "sample stencil", 255);
    if (!selected || sample.depth < selected.sample.depth) selected = { sample, index };
  }
  if (!selected) return Object.freeze({ available: true, coverage: 0, valid: false, depth: 1, normal: null, objectId: null, materialId: null, stencil: null, selectedSample: -1 });
  const { sample, index } = selected;
  const magnitude = Math.hypot(...sample.normal);
  return Object.freeze({ available: true, coverage: coverageSum / samples.length, valid: true, depth: sample.depth, normal: Object.freeze(sample.normal.map((component) => component / magnitude)), objectId: sample.objectId, materialId: sample.materialId, stencil: sample.stencil ?? 0, selectedSample: index });
}
