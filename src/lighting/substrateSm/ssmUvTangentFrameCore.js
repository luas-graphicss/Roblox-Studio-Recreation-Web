import {
  SSM_TANGENT_MINIMUM_ORIENTATION,
  isFiniteTangentVector,
  normalizeTangentVector,
} from './ssmTangentMath.js';
import {
  buildSubstrateSmTangentFrame,
  createSubstrateSmTangentFrame,
  invalidateSubstrateSmTangentFrame,
} from './ssmTangentFrameCore.js';

export function deriveSubstrateSmUvTangentFrame({
  normal,
  positionDx,
  positionDy,
  uvDx,
  uvDy,
  rotationRadians = 0,
} = {}, target = createSubstrateSmTangentFrame()) {
  if (!isFiniteTangentVector(positionDx) || !isFiniteTangentVector(positionDy) ||
      !isFiniteTangentVector(uvDx, 2) || !isFiniteTangentVector(uvDy, 2)) {
    return invalidateSubstrateSmTangentFrame(target, 'SSM_UV_DERIVATIVES_INVALID');
  }
  const uvScale = Math.max(...uvDx.map(Math.abs), ...uvDy.map(Math.abs));
  const positionScale = Math.max(...positionDx.map(Math.abs), ...positionDy.map(Math.abs));
  if (uvScale === 0 || positionScale === 0) return invalidateSubstrateSmTangentFrame(target, 'SSM_UV_DEGENERATE');
  const scaledUvDx = uvDx.map(value => value / uvScale);
  const scaledUvDy = uvDy.map(value => value / uvScale);
  const determinant = scaledUvDx[0] * scaledUvDy[1] - scaledUvDx[1] * scaledUvDy[0];
  if (Math.abs(determinant) <= SSM_TANGENT_MINIMUM_ORIENTATION) {
    return invalidateSubstrateSmTangentFrame(target, 'SSM_UV_DEGENERATE');
  }
  const orientation = Math.sign(determinant);
  const tangent = normalizeTangentVector(positionDx.map((value, index) =>
    (value / positionScale * scaledUvDy[1] - positionDy[index] / positionScale * scaledUvDx[1]) * orientation));
  const bitangent = normalizeTangentVector(positionDy.map((value, index) =>
    (value / positionScale * scaledUvDx[0] - positionDx[index] / positionScale * scaledUvDy[0]) * orientation));
  if (tangent === null || bitangent === null) return invalidateSubstrateSmTangentFrame(target, 'SSM_UV_DEGENERATE');
  return buildSubstrateSmTangentFrame({ normal, tangent, bitangent, rotationRadians, source: 'uvDerivatives' }, target);
}
