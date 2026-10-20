const refractiveNames = new Set(['Glass', 'Ice', 'Glacier', 'ForceField']);
const admittedDomain = Object.freeze({ allowed: true, code: null, reason: null });

function refuse(code, reason) {
  return Object.freeze({ allowed: false, code, reason });
}

function hasUnrecognizedShaderHook(material) {
  const callback = material.onBeforeCompile;
  if (callback === undefined) return false;
  if (typeof callback !== 'function') return true;
  let prototype = Object.getPrototypeOf(material);
  let nativeCallback;
  while (prototype) {
    if (Object.hasOwn(prototype, 'onBeforeCompile')) nativeCallback = prototype.onBeforeCompile;
    prototype = Object.getPrototypeOf(prototype);
  }
  return callback !== nativeCallback && callback !== material.userData?.__rswBasePatch;
}

export function inspectSubstrateSmMaterialDomain({ material, materialDomain = 'surface', bsdfKind = 'slab' } = {}) {
  if (!material || typeof material !== 'object' || Array.isArray(material)) {
    return refuse('SSM_SINGLE_MATERIAL_REQUIRED', 'A single host material is required.');
  }
  if (materialDomain !== 'surface') return refuse('SSM_DOMAIN_DELEGATED', 'Nonsurface domains retain their existing host path.');
  const authoredKind = material.userData?.sbBsdfKind;
  if (bsdfKind !== 'slab' || (authoredKind !== undefined && authoredKind !== 'slab')) {
    return refuse('SSM_DOMAIN_DELEGATED', 'Hair, eye, water, volume, unlit and unknown BSDF domains remain delegated.');
  }
  if (material.userData?.__rswGlassRefr || refractiveNames.has(material.userData?.__rswMatName)) {
    return refuse('SSM_REFRACTION_DELEGATED', 'Refractive materials retain their host grab, composition and shadow owners.');
  }
  if (material.userData?.__rswMatName === 'Water') {
    return refuse('SSM_WATER_DELEGATED', 'Water retains its existing waves, refraction and reflection path.');
  }
  if (material.isShaderMaterial || material.isRawShaderMaterial || material.isNodeMaterial) {
    return refuse('SSM_CUSTOM_SHADER_DELEGATED', 'Custom shader materials retain their existing programs.');
  }
  if (material.isMeshBasicMaterial) return refuse('SSM_UNLIT_DELEGATED', 'Unlit materials retain their existing response.');
  if (material.isMeshPhysicalMaterial) return refuse('SSM_PHYSICAL_MATERIAL_DELEGATED', 'Physical materials require their existing host adapter.');
  if (hasUnrecognizedShaderHook(material)) {
    return refuse('SSM_CUSTOM_SHADER_DELEGATED', 'Unrecognized compile hooks require a compatible host transaction before admission.');
  }
  return admittedDomain;
}
