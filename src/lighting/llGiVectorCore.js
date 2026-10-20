export function readVector3(value, fallback) {
  const defaultValue = Number.isFinite(fallback) ? fallback : 0;
  if (!value) return [defaultValue, defaultValue, defaultValue];
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  return [
    Number.isFinite(x) ? x : defaultValue,
    Number.isFinite(y) ? y : defaultValue,
    Number.isFinite(z) ? z : defaultValue,
  ];
}

export function subtractVectors(left, right) {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

export function addVectors(left, right) {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

export function scaleVector(vector, factor) {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

export function dotProduct(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function vectorLength(vector) {
  return Math.sqrt(dotProduct(vector, vector));
}

export function normalizeVector(vector, fallback) {
  const length = vectorLength(vector);
  if (!(length > 0)) return fallback ? readVector3(fallback) : [0, 1, 0];
  return scaleVector(vector, 1 / length);
}

export function clamp01(value) {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}


export function luminanceOfRgb(rgb) {
  if (!rgb) return 0;
  return 0.2126 * (Number(rgb[0]) || 0) + 0.7152 * (Number(rgb[1]) || 0) + 0.0722 * (Number(rgb[2]) || 0);
}


export function transformDirectionByMatrix4(direction, matrixElements) {
  const x = direction[0];
  const y = direction[1];
  const z = direction[2];
  return [
    matrixElements[0] * x + matrixElements[4] * y + matrixElements[8] * z,
    matrixElements[1] * x + matrixElements[5] * y + matrixElements[9] * z,
    matrixElements[2] * x + matrixElements[6] * y + matrixElements[10] * z,
  ];
}


export function transformPointByMatrix4(point, matrixElements) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  return [
    matrixElements[0] * x + matrixElements[4] * y + matrixElements[8] * z + matrixElements[12],
    matrixElements[1] * x + matrixElements[5] * y + matrixElements[9] * z + matrixElements[13],
    matrixElements[2] * x + matrixElements[6] * y + matrixElements[10] * z + matrixElements[14],
  ];
}
