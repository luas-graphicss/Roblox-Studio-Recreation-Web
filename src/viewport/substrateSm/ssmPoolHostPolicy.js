function refusal(reason) {
  return Object.freeze({ ok: false, reason });
}

export function inspectSubstrateSmPoolHost(mesh, { promoted = false } = {}) {
  if (mesh?.isMesh !== true || Boolean(mesh.isInstancedMesh) === promoted) {
    return refusal(promoted ? "SSM_PROMOTED_MESH_REQUIRED" : "SSM_INSTANCED_POOL_REQUIRED");
  }
  if (!promoted && mesh.userData?.__rswPool !== true) return refusal("SSM_ENGINE_POOL_REQUIRED");
  const attributes = mesh.geometry?.attributes;
  if (mesh.isSkinnedMesh || mesh.isBatchedMesh || attributes?.rswMats || attributes?.rswWeights
    || attributes?.skinIndex || attributes?.skinWeight || mesh.userData?.__rswPalettePool
    || (promoted && mesh.geometry?.isInstancedBufferGeometry)) {
    return refusal("SSM_POOL_GEOMETRY_DELEGATED");
  }
  const material = mesh.material;
  if (!material || Array.isArray(material) || material.isMeshPhysicalMaterial
    || (!material.isMeshPhongMaterial && !material.isMeshStandardMaterial)) {
    return refusal("SSM_POOL_STANDARD_OR_PHONG_REQUIRED");
  }
  if (material.transparent || material.opacity !== 1 || material.alphaHash || material.alphaTest > 0
    || material.transmission > 0 || attributes?.rswAlpha) {
    return refusal("SSM_POOL_TRANSPARENCY_DELEGATED");
  }
  if (material.wireframe || material.flatShading) return refusal("SSM_POOL_VARIANT_DELEGATED");
  if (!attributes?.position || !attributes?.normal) return refusal("SSM_POOL_NORMALS_REQUIRED");
  const family = material.isMeshPhongMaterial ? "Phong" : "Standard";
  return Object.freeze({ ok: true, materialPath: promoted ? family.toLowerCase() : `pool${family}` });
}
