export function refuseSubstrateSmDeformedHost(code, materialPath = null) {
  return Object.freeze({ allowed: false, code, materialPath });
}

export function hasSubstrateSmHostAttribute(attribute, itemSize, minimumCount = 1) {
  return Boolean(attribute && attribute.itemSize === itemSize
    && Number.isSafeInteger(attribute.count) && attribute.count >= minimumCount);
}

export function inspectSubstrateSmDeformedMaterial(mesh, materialPath) {
  const refuse = code => refuseSubstrateSmDeformedHost(code, materialPath);
  if (mesh?.isMesh !== true) return refuse('SSM_DEFORMED_MESH_REQUIRED');
  const material = mesh.material;
  if (!material || Array.isArray(material)) return refuse('SSM_DEFORMED_SINGLE_MATERIAL_REQUIRED');
  if (material.isMeshStandardMaterial !== true || material.isMeshPhysicalMaterial === true) {
    return refuse('SSM_DEFORMED_STANDARD_REQUIRED');
  }
  if (material.transparent || material.alphaHash || material.transmission > 0
    || material.opacity !== 1 || material.premultipliedAlpha) {
    return refuse('SSM_DEFORMED_TRANSPARENCY_DELEGATED');
  }
  if (material.wireframe || material.flatShading || mesh.isBatchedMesh) {
    return refuse('SSM_DEFORMED_VARIANT_DELEGATED');
  }
  const attributes = mesh.geometry?.attributes;
  if (!hasSubstrateSmHostAttribute(attributes?.position, 3)
    || !hasSubstrateSmHostAttribute(attributes?.normal, 3, attributes.position.count)) {
    return refuse('SSM_DEFORMED_NORMALS_REQUIRED');
  }
  if (!Number.isFinite(material.alphaTest) || material.alphaTest < 0 || material.alphaTest > 1) {
    return refuse('SSM_DEFORMED_ALPHA_TEST_INVALID');
  }
  return Object.freeze({ allowed: true, materialPath, code: null,
    blendMode: material.alphaTest > 0 ? 'alphaTest' : 'opaque' });
}

export function getSubstrateSmHostTextureSize(texture) {
  const image = texture?.image;
  return texture?.isTexture === true && Number.isSafeInteger(image?.width) && image.width > 0
    && Number.isSafeInteger(image?.height) && image.height > 0
    ? Math.max(image.width, image.height) : null;
}
