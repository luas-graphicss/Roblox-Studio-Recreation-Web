export const SSM_TANGENT_MINIMUM_LENGTH_SQUARED = 1e-12;
export const SSM_TANGENT_MINIMUM_ORIENTATION = 1e-6;
export const SSM_TANGENT_ORTHONORMAL_TOLERANCE = 1e-5;

export function isFiniteTangentVector(vector, componentCount = 3) {
  if (!vector || vector.length !== componentCount) return false;
  for (let index = 0; index < componentCount; index += 1) {
    if (!Number.isFinite(vector[index])) return false;
  }
  return true;
}

export function tangentDotProduct(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

export function tangentCrossProduct(first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

export function normalizeTangentVector(vector) {
  if (!isFiniteTangentVector(vector)) return null;
  const largest = Math.max(Math.abs(vector[0]), Math.abs(vector[1]), Math.abs(vector[2]));
  if (largest === 0) return null;
  const scaled = vector.map(component => component / largest);
  const length = Math.sqrt(tangentDotProduct(scaled, scaled));
  return scaled.map(component => component / length);
}

export function projectTangentVector(vector, normal) {
  const direction = normalizeTangentVector(vector);
  if (direction === null) return null;
  const normalComponent = tangentDotProduct(direction, normal);
  const projected = direction.map((component, index) => component - normal[index] * normalComponent);
  if (tangentDotProduct(projected, projected) <= SSM_TANGENT_MINIMUM_LENGTH_SQUARED) return null;
  return normalizeTangentVector(projected);
}
