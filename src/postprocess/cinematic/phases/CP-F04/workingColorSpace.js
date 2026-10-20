import { IDENTITY_MATRIX, invertMatrix, multiplyMatrices, multiplyMatrixVector, requireFiniteVector } from "./colorMatrix.js";

const definitions = {
  rec709: { primaries: [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]], whitePoint: [0.3127, 0.3290] },
  "display-p3": { primaries: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]], whitePoint: [0.3127, 0.3290] },
  rec2020: { primaries: [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]], whitePoint: [0.3127, 0.3290] },
  acescg: { primaries: [[0.713, 0.293], [0.165, 0.830], [0.128, 0.044]], whitePoint: [0.32168, 0.33767] }
};
const BRADFORD = Object.freeze([0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]);
const INVERSE_BRADFORD = Object.freeze(invertMatrix(BRADFORD));

function chromaticityToXyz(chromaticity, label, white = false) {
  const [x, y] = requireFiniteVector(chromaticity, 2, label);
  if (x < 0 || x > 1 || y <= 0 || y > 1 || (white && x + y >= 1)) throw new RangeError(`Invalid ${label} chromaticity`);
  return [x / y, 1, (1 - x - y) / y];
}

export function resolveWorkingColorSpace(input = "rec709") {
  const definition = typeof input === "string" ? definitions[input] : input;
  if (!definition || !Array.isArray(definition.primaries) || definition.primaries.length !== 3) throw new TypeError("Unknown or incomplete working color space");
  const whitePoint = Object.freeze(requireFiniteVector(definition.whitePoint, 2, "White point"));
  const whiteXyz = chromaticityToXyz(whitePoint, "white point", true);
  const primaries = Object.freeze(definition.primaries.map((primary) => Object.freeze(requireFiniteVector(primary, 2, "Primary"))));
  const columns = primaries.map((primary) => chromaticityToXyz(primary, "primary"));
  const unscaled = Array.from({ length: 9 }, (_, index) => columns[index % 3][Math.floor(index / 3)]);
  const scales = multiplyMatrixVector(invertMatrix(unscaled), whiteXyz);
  if (scales.some((scale) => scale <= 0 || !Number.isFinite(scale))) throw new RangeError("White point must have positive primary weights");
  const rgbToXyz = Object.freeze(unscaled.map((value, index) => value * scales[index % 3]));
  return Object.freeze({ name: typeof input === "string" ? input : definition.name ?? "custom", primaries, whitePoint, rgbToXyz, signature: JSON.stringify([primaries, whitePoint]) });
}

export function createWorkingColorTransform(sourceInput = "rec709", destinationInput = "rec709") {
  const source = resolveWorkingColorSpace(sourceInput);
  const destination = resolveWorkingColorSpace(destinationInput);
  if (source.signature === destination.signature) return IDENTITY_MATRIX;
  let adaptation = IDENTITY_MATRIX;
  if (source.whitePoint.some((value, index) => value !== destination.whitePoint[index])) {
    const sourceCone = multiplyMatrixVector(BRADFORD, chromaticityToXyz(source.whitePoint, "source white", true));
    const destinationCone = multiplyMatrixVector(BRADFORD, chromaticityToXyz(destination.whitePoint, "destination white", true));
    if (sourceCone.some((value) => Math.abs(value) < 1e-12)) throw new RangeError("Invalid chromatic adaptation");
    const diagonal = [destinationCone[0] / sourceCone[0], 0, 0, 0, destinationCone[1] / sourceCone[1], 0, 0, 0, destinationCone[2] / sourceCone[2]];
    adaptation = multiplyMatrices(INVERSE_BRADFORD, multiplyMatrices(diagonal, BRADFORD));
  }
  return Object.freeze(multiplyMatrices(invertMatrix(destination.rgbToXyz), multiplyMatrices(adaptation, source.rgbToXyz)));
}
