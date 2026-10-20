import { MAX_PALETTE_BONES, MAX_PALETTE_INSTANCES } from '../skinnedPaletteCore.js';
import { getSubstrateSmHostTextureSize, hasSubstrateSmHostAttribute,
  inspectSubstrateSmDeformedMaterial, refuseSubstrateSmDeformedHost } from './ssmDeformedHostValidation.js';

const THREE_R161_FLOAT_TYPE = 1015;

function inspectPalette(mesh, paletteUniforms) {
  const texture = paletteUniforms?.tex?.value;
  const dimensions = paletteUniforms?.dim?.value;
  const size = getSubstrateSmHostTextureSize(texture);
  if (size === null || texture.type !== THREE_R161_FLOAT_TYPE || !(texture.image.data instanceof Float32Array)
    || texture.image.data.length < texture.image.width * texture.image.height * 4
    || dimensions?.x !== texture.image.width || dimensions?.y !== texture.image.height
    || dimensions.x % 4 !== 0 || dimensions.x / 4 > MAX_PALETTE_BONES
    || dimensions.y > MAX_PALETTE_INSTANCES) return null;
  if (!Number.isSafeInteger(mesh.count) || mesh.count < 1 || mesh.count > MAX_PALETTE_INSTANCES
    || !hasSubstrateSmHostAttribute(mesh.instanceMatrix, 16, mesh.count)) return null;
  const rows = mesh.geometry.attributes.rswPaletteRow;
  if (!hasSubstrateSmHostAttribute(rows, 1, mesh.count) || rows.isInstancedBufferAttribute !== true
    || rows.meshPerAttribute !== 1 || typeof rows.getX !== 'function') return null;
  for (let index = 0; index < mesh.count; index++) {
    const row = rows.getX(index);
    if (!Number.isSafeInteger(row) || row < 0 || row >= dimensions.y) return null;
  }
  return size;
}

export function inspectSubstrateSmSkinnedHost(mesh, { paletteUniforms } = {}) {
  const base = inspectSubstrateSmDeformedMaterial(mesh, 'skinned');
  if (!base.allowed) return base;
  const refuse = code => refuseSubstrateSmDeformedHost(code, 'skinned');
  const attributes = mesh.geometry.attributes;
  if (attributes.rswMats || attributes.rswWeights || attributes.rswAlpha) {
    return refuse('SSM_SKINNED_GEOMETRY_DELEGATED');
  }
  const count = attributes.position.count;
  if (!hasSubstrateSmHostAttribute(attributes.skinIndex, 4, count)
    || !hasSubstrateSmHostAttribute(attributes.skinWeight, 4, count)) {
    return refuse('SSM_SKINNED_ATTRIBUTES_REQUIRED');
  }
  let kind;
  let textureSize;
  let attributeSlots = 4;
  if (mesh.isSkinnedMesh === true && !mesh.isInstancedMesh
    && !mesh.geometry.isInstancedBufferGeometry && !attributes.rswPaletteRow) {
    kind = 'native-skinned';
    const skeleton = mesh.skeleton;
    textureSize = getSubstrateSmHostTextureSize(skeleton?.boneTexture);
    if (!skeleton?.bones?.length || textureSize === null || skeleton.boneTexture.type !== THREE_R161_FLOAT_TYPE
      || !(skeleton.boneTexture.image.data instanceof Float32Array)
      || skeleton.boneTexture.image.width * skeleton.boneTexture.image.height < skeleton.bones.length * 4) {
      return refuse('SSM_SKINNED_BONE_TEXTURE_NOT_PREPARED');
    }
    if (!mesh.bindMatrix?.isMatrix4 || !mesh.bindMatrixInverse?.isMatrix4) {
      return refuse('SSM_SKINNED_BIND_TRANSFORMS_REQUIRED');
    }
  } else if (mesh.isInstancedMesh === true && !mesh.isSkinnedMesh) {
    kind = 'palette-skinned';
    textureSize = inspectPalette(mesh, paletteUniforms);
    if (textureSize === null) return refuse('SSM_SKINNED_PALETTE_NOT_PREPARED');
    attributeSlots = 9 + (mesh.instanceColor ? 1 : 0);
  } else {
    return refuse('SSM_SKINNED_HOST_REQUIRED');
  }
  return Object.freeze({ ...base, kind, tangentValid: false,
    resourceFloor: Object.freeze({ fragmentSamplers: 0, vertexSamplers: 1,
      attributes: attributeSlots, varyingVectors: 2, maxTextureSize: textureSize }) });
}
