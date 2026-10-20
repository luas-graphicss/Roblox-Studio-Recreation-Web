import { inspectSubstrateSmPhongHostMaterial } from "./ssmPhongMaterialPolicy.js";

function reject(code, materialPath = null) {
  return Object.freeze({ allowed: false, materialPath, code });
}

export function inspectSubstrateSmPhongHost(mesh) {
  if (mesh?.isMesh !== true) return reject("SSM_PHONG_MESH_REQUIRED");
  const materialPath = mesh.isInstancedMesh ? "poolPhong" : "phong";
  if (mesh.isSkinnedMesh || mesh.isBatchedMesh || mesh.geometry?.attributes?.rswMats || mesh.geometry?.attributes?.rswWeights) {
    return reject("SSM_PHONG_GEOMETRY_DELEGATED", materialPath);
  }
  if (mesh.isInstancedMesh && mesh.userData?.__rswPool !== true) {
    return reject("SSM_SIMPLE_POOL_REQUIRED", materialPath);
  }
  if (!mesh.isInstancedMesh && mesh.geometry?.isInstancedBufferGeometry) {
    return reject("SSM_PHONG_GEOMETRY_DELEGATED", materialPath);
  }
  if (!mesh.material || Array.isArray(mesh.material)) return reject("SSM_PHONG_SINGLE_MATERIAL_REQUIRED", materialPath);
  const material = inspectSubstrateSmPhongHostMaterial({ material: mesh.material, materialPath });
  if (!material.supported) return reject(material.reason, materialPath);
  if (mesh.geometry?.attributes?.rswAlpha) return reject("SSM_POOL_TRANSPARENCY_DELEGATED", materialPath);
  if (!mesh.geometry?.attributes?.position || !mesh.geometry?.attributes?.normal) {
    return reject("SSM_PHONG_NORMALS_REQUIRED", materialPath);
  }
  return Object.freeze({ allowed: true, materialPath, code: null, material });
}
