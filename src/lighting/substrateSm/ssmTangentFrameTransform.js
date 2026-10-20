import {
  SSM_TANGENT_MINIMUM_ORIENTATION,
  isFiniteTangentVector,
  tangentCrossProduct,
  tangentDotProduct,
  normalizeTangentVector,
} from './ssmTangentMath.js';
import {
  buildSubstrateSmTangentFrame,
  createSubstrateSmTangentFrame,
  invalidateSubstrateSmTangentFrame,
} from './ssmTangentFrameCore.js';

function transformDirection(columns, direction) {
  return [0, 1, 2].map(row => columns[0][row] * direction[0] +
    columns[1][row] * direction[1] + columns[2][row] * direction[2]);
}

export function transformSubstrateSmTangentFrame({
  normal,
  tangent,
  handedness = 1,
  linearTransform,
  shadingNormal,
  rotationRadians = 0,
} = {}, target = createSubstrateSmTangentFrame()) {
  const source = buildSubstrateSmTangentFrame({ normal, tangent, handedness });
  if (!source.valid) return invalidateSubstrateSmTangentFrame(target, source.reasonCode);
  if (!isFiniteTangentVector(linearTransform, 9)) {
    return invalidateSubstrateSmTangentFrame(target, 'SSM_TANGENT_TRANSFORM_INVALID');
  }
  const scale = Math.max(...Array.from(linearTransform, Math.abs));
  if (scale === 0) return invalidateSubstrateSmTangentFrame(target, 'SSM_TANGENT_TRANSFORM_SINGULAR');
  const columns = [0, 3, 6].map(offset => Array.from(linearTransform).slice(offset, offset + 3).map(value => value / scale));
  const cofactors = [
    tangentCrossProduct(columns[1], columns[2]),
    tangentCrossProduct(columns[2], columns[0]),
    tangentCrossProduct(columns[0], columns[1]),
  ];
  const determinant = tangentDotProduct(columns[0], cofactors[0]);
  if (Math.abs(determinant) <= SSM_TANGENT_MINIMUM_ORIENTATION) {
    return invalidateSubstrateSmTangentFrame(target, 'SSM_TANGENT_TRANSFORM_SINGULAR');
  }
  const transformedNormal = normalizeTangentVector(
    transformDirection(cofactors, source.normal).map(value => value * Math.sign(determinant)),
  );
  return buildSubstrateSmTangentFrame({
    normal: shadingNormal === undefined ? transformedNormal : shadingNormal,
    tangent: transformDirection(columns, source.tangent),
    bitangent: transformDirection(columns, source.bitangent),
    rotationRadians,
  }, target);
}
