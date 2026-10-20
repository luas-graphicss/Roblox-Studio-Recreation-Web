import {
  SSM_TANGENT_MINIMUM_ORIENTATION,
  SSM_TANGENT_ORTHONORMAL_TOLERANCE,
  isFiniteTangentVector,
  tangentDotProduct,
  tangentCrossProduct,
  normalizeTangentVector,
  projectTangentVector,
} from './ssmTangentMath.js';

export function createSubstrateSmTangentFrame() {
  return {
    valid: false,
    source: 'none',
    reasonCode: 'SSM_TANGENT_UNAVAILABLE',
    normal: [0, 0, 0],
    tangent: [0, 0, 0],
    bitangent: [0, 0, 0],
    handedness: 0,
    rotationRadians: 0,
  };
}

export function invalidateSubstrateSmTangentFrame(target, reasonCode) {
  target.valid = false;
  target.source = 'none';
  target.reasonCode = reasonCode;
  target.normal.fill(0);
  target.tangent.fill(0);
  target.bitangent.fill(0);
  target.handedness = 0;
  target.rotationRadians = 0;
  return target;
}

export function buildSubstrateSmTangentFrame({
  normal,
  tangent,
  bitangent,
  handedness = 1,
  rotationRadians = 0,
  source = 'geometry',
} = {}, target = createSubstrateSmTangentFrame()) {
  const unitNormal = normalizeTangentVector(normal);
  if (unitNormal === null) return invalidateSubstrateSmTangentFrame(target, 'SSM_NORMAL_INVALID');
  const unitTangent = projectTangentVector(tangent, unitNormal);
  if (unitTangent === null) return invalidateSubstrateSmTangentFrame(target, 'SSM_TANGENT_UNAVAILABLE');
  if (!Number.isFinite(rotationRadians)) return invalidateSubstrateSmTangentFrame(target, 'SSM_TANGENT_ROTATION_INVALID');
  const perpendicular = tangentCrossProduct(unitNormal, unitTangent);
  if (bitangent !== undefined) {
    const unitBitangent = normalizeTangentVector(bitangent);
    const orientation = unitBitangent === null ? 0 : tangentDotProduct(perpendicular, unitBitangent);
    if (Math.abs(orientation) <= SSM_TANGENT_MINIMUM_ORIENTATION) {
      return invalidateSubstrateSmTangentFrame(target, 'SSM_TANGENT_HANDEDNESS_INVALID');
    }
    handedness = Math.sign(orientation);
  }
  if (handedness !== 1 && handedness !== -1) {
    return invalidateSubstrateSmTangentFrame(target, 'SSM_TANGENT_HANDEDNESS_INVALID');
  }
  if (source !== 'geometry' && source !== 'uvDerivatives') {
    return invalidateSubstrateSmTangentFrame(target, 'SSM_TANGENT_SOURCE_INVALID');
  }
  const rotation = ((rotationRadians % Math.PI) + Math.PI) % Math.PI;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  for (let index = 0; index < 3; index += 1) {
    const orientedBitangent = perpendicular[index] * handedness;
    target.normal[index] = unitNormal[index];
    target.tangent[index] = unitTangent[index] * cosine + orientedBitangent * sine;
    target.bitangent[index] = orientedBitangent * cosine - unitTangent[index] * sine;
  }
  target.valid = true;
  target.source = source;
  target.reasonCode = null;
  target.handedness = handedness;
  target.rotationRadians = rotation;
  return target;
}

export function isSubstrateSmTangentFrameValid(frame, normal = frame?.normal) {
  if (frame?.valid !== true || !isFiniteTangentVector(normal)) return false;
  const vectors = [frame.normal, frame.tangent, frame.bitangent];
  const tolerance = SSM_TANGENT_ORTHONORMAL_TOLERANCE;
  if (vectors.some(vector => !isFiniteTangentVector(vector) || Math.abs(tangentDotProduct(vector, vector) - 1) > tolerance)) return false;
  if (Math.abs(tangentDotProduct(vectors[0], vectors[1])) > tolerance ||
      Math.abs(tangentDotProduct(vectors[0], vectors[2])) > tolerance ||
      Math.abs(tangentDotProduct(vectors[1], vectors[2])) > tolerance) return false;
  return Math.abs(tangentDotProduct(frame.normal, normal) - 1) <= tolerance;
}
