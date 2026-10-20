import { inspectSubstrateSmMaterialBoundary } from './ssmMaterialBoundaryPolicy.js';

export const SSM_STANDARD_ADAPTER_VERSION = 1;
export const SSM_STANDARD_MATERIAL_PATH = 'standard';

function reject(code, reason) {
  return Object.freeze({ allowed: false, materialPath: SSM_STANDARD_MATERIAL_PATH, code, reason });
}

const supportedHost = Object.freeze({
  allowed: true,
  materialPath: SSM_STANDARD_MATERIAL_PATH,
  code: null,
  reason: null,
  blendMode: 'opaque',
});

const supportedAlphaTestHost = Object.freeze({ ...supportedHost, blendMode: 'alphaTest' });

export function inspectSubstrateSmStandardHost(mesh) {
  if (!mesh || mesh.isMesh !== true) {
    return reject('SSM_STANDARD_MESH_REQUIRED', 'A single rendered mesh is required.');
  }
  if (mesh.isInstancedMesh || mesh.isBatchedMesh || mesh.geometry?.isInstancedBufferGeometry) {
    return reject('SSM_STANDARD_INSTANCING_DELEGATED', 'Instanced materials require their own adapter.');
  }
  if (mesh.isSkinnedMesh || mesh.geometry?.attributes?.rswMats || mesh.geometry?.attributes?.rswWeights) {
    return reject('SSM_STANDARD_GEOMETRY_DELEGATED', 'Terrain and skinned materials require their own adapter.');
  }
  const material = mesh.material;
  if (!material || Array.isArray(material)) {
    return reject('SSM_STANDARD_SINGLE_MATERIAL_REQUIRED', 'A single material binding is required.');
  }
  if (material.isMeshStandardMaterial !== true || material.isMeshPhysicalMaterial === true) {
    return reject('SSM_STANDARD_MATERIAL_REQUIRED', 'Only an opaque MeshStandardMaterial is supported.');
  }
  if (material.transparent || material.alphaHash || material.transmission > 0 || material.opacity !== 1) {
    return reject('SSM_STANDARD_TRANSPARENCY_DELEGATED', 'Transparent and stochastic-coverage paths retain their current backend.');
  }
  if (material.wireframe || material.flatShading) {
    return reject('SSM_STANDARD_VARIANT_DELEGATED', 'Wireframe and flat-shaded variants are outside this first slice.');
  }
  const boundary = inspectSubstrateSmMaterialBoundary({ material });
  if (!boundary.allowed) return reject(boundary.code, boundary.reason);
  if (!mesh.geometry?.attributes?.position || !mesh.geometry?.attributes?.normal) {
    return reject('SSM_STANDARD_NORMALS_REQUIRED', 'Position and normal attributes are required.');
  }
  return boundary.blendMode === 'alphaTest' ? supportedAlphaTestHost : supportedHost;
}
