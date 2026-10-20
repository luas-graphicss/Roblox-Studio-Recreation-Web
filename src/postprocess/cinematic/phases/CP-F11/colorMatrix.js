export function multiplyMatrixVector(matrix, vector) {
  return [0, 1, 2].map((row) => matrix[row * 3] * vector[0] + matrix[row * 3 + 1] * vector[1] + matrix[row * 3 + 2] * vector[2]);
}

export function multiplyMatrices(left, right) {
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    return left[row * 3] * right[column] + left[row * 3 + 1] * right[column + 3] + left[row * 3 + 2] * right[column + 6];
  });
}

export function invertMatrix(matrix) {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const cofactors = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
  const determinant = a * cofactors[0] + b * cofactors[3] + c * cofactors[6];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new RangeError("Color matrix is singular");
  return cofactors.map((value) => value / determinant);
}

export function chromaticityToXyz([x, y]) {
  return [x / y, 1, (1 - x - y) / y];
}

export function deriveRgbToXyz(primaries, whitePoint) {
  const columns = primaries.map(chromaticityToXyz);
  const matrix = Array.from({ length: 9 }, (_, index) => columns[index % 3][Math.floor(index / 3)]);
  const scales = multiplyMatrixVector(invertMatrix(matrix), chromaticityToXyz(whitePoint));
  return matrix.map((value, index) => value * scales[index % 3]);
}

export function deriveBradfordAdaptation(sourceWhite, targetWhite) {
  const bradford = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
  const sourceCone = multiplyMatrixVector(bradford, chromaticityToXyz(sourceWhite));
  const targetCone = multiplyMatrixVector(bradford, chromaticityToXyz(targetWhite));
  const scale = [targetCone[0] / sourceCone[0], 0, 0, 0, targetCone[1] / sourceCone[1], 0, 0, 0, targetCone[2] / sourceCone[2]];
  return multiplyMatrices(invertMatrix(bradford), multiplyMatrices(scale, bradford));
}
