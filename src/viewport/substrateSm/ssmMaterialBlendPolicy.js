const admittedBlends = Object.freeze({
  opaque: Object.freeze({ allowed: true, blendMode: 'opaque', code: null, reason: null }),
  alphaTest: Object.freeze({ allowed: true, blendMode: 'alphaTest', code: null, reason: null }),
});

function refuse(code, reason, blendMode = null) {
  return Object.freeze({ allowed: false, blendMode, code, reason });
}

function isUnitInterval(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function inspectSubstrateSmMaterialBlend(material) {
  if (!material || typeof material !== 'object' || Array.isArray(material)) {
    return refuse('SSM_SINGLE_MATERIAL_REQUIRED', 'A single host material is required.');
  }
  const alphaTest = material.alphaTest === undefined ? 0 : material.alphaTest;
  const transmission = material.transmission === undefined ? 0 : material.transmission;
  if (!isUnitInterval(material.opacity)) return refuse('SSM_OPACITY_INVALID', 'Host opacity must be finite and between zero and one.');
  if (!isUnitInterval(alphaTest)) return refuse('SSM_ALPHA_TEST_INVALID', 'Host alphaTest must be finite and between zero and one.');
  if (!isUnitInterval(transmission)) return refuse('SSM_TRANSMISSION_INVALID', 'Host transmission must be finite and between zero and one.');
  for (const field of ['transparent', 'alphaHash', 'premultipliedAlpha']) {
    if (material[field] !== undefined && typeof material[field] !== 'boolean') {
      return refuse('SSM_BLEND_STATE_INVALID', `Host ${field} must be a boolean.`);
    }
  }
  if (material.transparent === true || material.opacity !== 1 || transmission > 0) {
    return refuse('SSM_BLEND_MODE_DELEGATED', 'Transparency and transmission retain their existing host path.', 'transparent');
  }
  if (material.alphaHash === true) {
    return refuse('SSM_BLEND_MODE_DELEGATED', 'Stochastic coverage retains its existing host path.', 'alphaHash');
  }
  const blending = material.blending === undefined ? 1 : material.blending;
  if ((blending !== 0 && blending !== 1) || material.premultipliedAlpha === true) {
    return refuse('SSM_BLEND_MODE_DELEGATED', 'Nonstandard blending retains its existing host path.', 'custom');
  }
  return admittedBlends[alphaTest > 0 ? 'alphaTest' : 'opaque'];
}
