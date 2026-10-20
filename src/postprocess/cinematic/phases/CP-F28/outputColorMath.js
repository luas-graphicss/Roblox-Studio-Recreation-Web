import { createWorkingColorTransform, resolveWorkingColorSpace } from "../CP-F04/workingColorSpace.js";
import { multiplyMatrixVector, requireFiniteVector } from "../CP-F04/colorMatrix.js";
import { OUTPUT_WHITE_POINTS } from "./outputContract.js";

export function createOutputColorTransform(sourceInfo, plan) {
  const standard = resolveWorkingColorSpace(plan.gamut);
  const destination = resolveWorkingColorSpace({ name: plan.gamut, primaries: standard.primaries, whitePoint: OUTPUT_WHITE_POINTS[plan.whitePoint] });
  const sourceReferenceWhiteNits = sourceInfo.referenceWhiteNits ?? plan.paperWhiteNits;
  if (!Number.isFinite(sourceReferenceWhiteNits) || sourceReferenceWhiteNits <= 0) throw new RangeError("CP-F28 source luminance unit must be positive and finite");
  const luminanceUnitScale = sourceReferenceWhiteNits / plan.paperWhiteNits;
  const matrix = createWorkingColorTransform(sourceInfo.colorSpace, destination).map((value) => value * luminanceUnitScale);
  return Object.freeze({ matrix: Object.freeze(matrix), luminanceUnitScale, luminance: Object.freeze(destination.rgbToXyz.slice(3, 6)), destination });
}

export function mapOutputGamut(color, luminance, maximum, mapping) {
  const input = requireFiniteVector(color, 3, "CP-F28 color");
  if (mapping === "preserve") return input;
  if (mapping === "clip") return input.map((value) => Math.max(0, Math.min(maximum, value)));
  if (mapping !== "compress") throw new TypeError("Unknown CP-F28 gamut mapping");
  const gray = Math.max(0, Math.min(maximum, input.reduce((sum, value, index) => sum + value * luminance[index], 0)));
  let saturation = 1;
  for (const value of input) {
    const difference = value - gray;
    if (difference > 0) saturation = Math.min(saturation, (maximum - gray) / difference);
    else if (difference < 0) saturation = Math.min(saturation, -gray / difference);
  }
  return input.map((value) => Math.max(0, Math.min(maximum, gray + saturation * (value - gray))));
}

export function transformOutputLinear(color, transform, plan) {
  const converted = multiplyMatrixVector(transform.matrix, requireFiniteVector(color, 3, "CP-F28 linear color"));
  const mapped = mapOutputGamut(converted, transform.luminance, plan.maximum, plan.mapping);
  const black = plan.blackNits / plan.paperWhiteNits;
  return mapped.map((value) => black + value * (1 - black / plan.maximum));
}
