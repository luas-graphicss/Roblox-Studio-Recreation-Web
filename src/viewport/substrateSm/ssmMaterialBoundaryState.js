const materialFields = Object.freeze([
  'version', 'opacity', 'transparent', 'alphaTest', 'alphaHash', 'alphaToCoverage',
  'transmission', 'premultipliedAlpha', 'blending', 'blendSrc', 'blendDst',
  'blendEquation', 'blendSrcAlpha', 'blendDstAlpha', 'blendEquationAlpha', 'blendAlpha',
  'depthWrite', 'depthTest', 'depthFunc', 'colorWrite', 'side', 'shadowSide',
  'forceSinglePass', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
  'wireframe', 'flatShading', 'visible', 'onBeforeCompile', 'customProgramCacheKey',
  'isShaderMaterial', 'isRawShaderMaterial', 'isNodeMaterial', 'isMeshBasicMaterial',
  'isMeshPhysicalMaterial', 'isMeshStandardMaterial', 'isMeshPhongMaterial',
]);

const metadataFields = Object.freeze(['sbBsdfKind', 'sbAuthoredTree', 'sbSceneTree', '__rswMatName', '__rswGlassRefr', '__rswBasePatch', '__rswBaseKey']);

export function captureSubstrateSmMaterialBoundaryState(mesh) {
  const material = mesh.material;
  const instanceAlpha = mesh.geometry?.attributes?.rswAlpha;
  const state = [
    material, mesh.geometry, mesh.renderOrder, mesh.castShadow, mesh.receiveShadow,
    mesh.visible, mesh.layers?.mask, mesh.customDepthMaterial, mesh.customDepthMaterial?.version,
    mesh.customDistanceMaterial, mesh.customDistanceMaterial?.version,
    instanceAlpha, instanceAlpha?.version, mesh.userData?.__rswPool,
    mesh.isMesh, mesh.isInstancedMesh, mesh.isSkinnedMesh, mesh.isBatchedMesh,
    mesh.geometry?.isInstancedBufferGeometry, mesh.instanceMatrix?.version, mesh.count,
    mesh.geometry?.attributes?.rswMats, mesh.geometry?.attributes?.rswWeights,
  ];
  for (const field of materialFields) state.push(material[field]);
  for (const field of metadataFields) state.push(material.userData?.[field]);
  state.push(material.blendColor?.r, material.blendColor?.g, material.blendColor?.b);
  for (const shadowMaterial of [mesh.customDepthMaterial, mesh.customDistanceMaterial]) {
    for (const field of ['opacity', 'alphaTest', 'side', 'depthWrite', 'map', 'alphaMap', 'onBeforeCompile', 'customProgramCacheKey']) {
      state.push(shadowMaterial?.[field]);
    }
  }
  for (const field of ['map', 'alphaMap', 'emissiveMap']) {
    const texture = material[field];
    state.push(texture, texture?.version, texture?.channel);
    for (let index = 0; index < 9; index++) state.push(texture?.matrix?.elements?.[index]);
  }
  return Object.freeze(state);
}

export function sameSubstrateSmMaterialBoundaryState(previous, current) {
  return previous.length === current.length && previous.every((value, index) => Object.is(value, current[index]));
}
