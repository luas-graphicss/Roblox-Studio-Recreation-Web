export function classifyMsmForwardReceiver(material, object = {}) {
  if (!material || material.visible === false) return { kind: 'ignored', reason: 'invisible-material' };
  const shaderName = material.isMeshPhysicalMaterial ? 'physical'
    : material.isMeshStandardMaterial ? 'standard'
    : material.isMeshPhongMaterial ? 'phong'
    : material.isMeshLambertMaterial ? 'lambert' : '';
  const unlit = material.isMeshBasicMaterial || material.isMeshDepthMaterial || material.isMeshDistanceMaterial
    || material.isMeshNormalMaterial || material.isShadowMaterial
    || ((material.isShaderMaterial || material.isRawShaderMaterial) && material.lights !== true);
  if (unlit) return { kind: 'ignored', reason: 'unlit-material' };


  if (!shaderName || material.transparent || material.depthWrite === false || object.userData?.msmIgnoreReceiver) {
    return { kind: 'unsupported', reason: 'unsupported-or-transparent-receiver' };
  }
  return { kind: 'supported', shaderName, reason: '' };
}
