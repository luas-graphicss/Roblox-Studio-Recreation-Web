import { hasSubstrateSmHostAttribute, inspectSubstrateSmDeformedMaterial,
  refuseSubstrateSmDeformedHost } from './ssmDeformedHostValidation.js';

export function inspectSubstrateSmTerrainHost(mesh) {
  const base = inspectSubstrateSmDeformedMaterial(mesh, 'terreno');
  if (!base.allowed) return base;
  const refuse = code => refuseSubstrateSmDeformedHost(code, 'terreno');
  if (mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.geometry.isInstancedBufferGeometry) {
    return refuse('SSM_TERRAIN_GEOMETRY_DELEGATED');
  }
  const attributes = mesh.geometry.attributes;
  const vertexCount = attributes.position.count;
  if (!hasSubstrateSmHostAttribute(attributes.rswMats, 3, vertexCount)
    || !hasSubstrateSmHostAttribute(attributes.rswWeights, 3, vertexCount)) {
    return refuse('SSM_TERRAIN_BLEND_ATTRIBUTES_REQUIRED');
  }
  return Object.freeze({ ...base, kind: 'terrain', tangentValid: false,
    resourceFloor: Object.freeze({ fragmentSamplers: 1, vertexSamplers: 0,
      attributes: 4, varyingVectors: 6, maxTextureSize: 0 }) });
}
