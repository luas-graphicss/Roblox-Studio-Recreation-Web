export const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export function requireFiniteVector(value, length, label) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== length || !Array.from(value).every(Number.isFinite)) {
    throw new TypeError(`${label} requires ${length} finite numbers`);
  }
  return Array.from(value);
}

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
  const [a, b, c, d, e, f, g, h, i] = requireFiniteVector(matrix, 9, "Color matrix");
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new RangeError("Singular color primaries");
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d].map((value) => value / determinant);
}
