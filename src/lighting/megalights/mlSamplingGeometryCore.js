export const MINIMUM_VECTOR_LENGTH = 1e-12;
export const MINIMUM_COSINE_AT_LIGHT = 1e-9;

export function vector3(x, y, z) {
  return { x: x, y: y, z: z };
}

export function addVectors(first, second) {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

export function subtractVectors(first, second) {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

export function scaleVector(source, scalar) {
  return { x: source.x * scalar, y: source.y * scalar, z: source.z * scalar };
}

export function dotProduct(first, second) {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

export function crossProduct(first, second) {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

export function vectorLength(source) {
  return Math.sqrt(dotProduct(source, source));
}


export function normalizeVector(source) {
  const length = vectorLength(source);
  if (!(length > MINIMUM_VECTOR_LENGTH)) return { x: 0, y: 0, z: 0 };
  const inverseLength = 1 / length;
  return { x: source.x * inverseLength, y: source.y * inverseLength, z: source.z * inverseLength };
}


export function buildOrthonormalBasis(unitDirection) {
  const axisSign = unitDirection.z >= 0 ? 1 : -1;
  const a = -1 / (axisSign + unitDirection.z);
  const b = unitDirection.x * unitDirection.y * a;
  return {
    tangent: {
      x: 1 + axisSign * unitDirection.x * unitDirection.x * a,
      y: axisSign * b,
      z: -axisSign * unitDirection.x,
    },
    bitangent: {
      x: b,
      y: axisSign + unitDirection.y * unitDirection.y * a,
      z: -unitDirection.y,
    },
    normal: { x: unitDirection.x, y: unitDirection.y, z: unitDirection.z },
  };
}

export function directionFromFrame(frame, tangentAmount, bitangentAmount, normalAmount) {
  return {
    x: frame.tangent.x * tangentAmount + frame.bitangent.x * bitangentAmount + frame.normal.x * normalAmount,
    y: frame.tangent.y * tangentAmount + frame.bitangent.y * bitangentAmount + frame.normal.y * normalAmount,
    z: frame.tangent.z * tangentAmount + frame.bitangent.z * bitangentAmount + frame.normal.z * normalAmount,
  };
}

export function clampToUnitRange(value) {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return 0;
  if (asNumber < 0) return 0;
  if (asNumber > 1) return 1;
  return asNumber;
}

export function clampNumber(value, minimum, maximum) {
  if (!Number.isFinite(value)) return minimum;
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}


export function areaPdfToSolidAnglePdf(probabilityDensityPerArea, distanceToSample, cosineAtLight) {
  if (!(cosineAtLight > MINIMUM_COSINE_AT_LIGHT)) return 0;
  if (!(distanceToSample > MINIMUM_VECTOR_LENGTH)) return 0;
  return (probabilityDensityPerArea * distanceToSample * distanceToSample) / cosineAtLight;
}
