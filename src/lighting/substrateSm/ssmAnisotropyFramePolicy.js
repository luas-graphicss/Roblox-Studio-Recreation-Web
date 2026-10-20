import { SSM_REFUSAL_CODES } from './ssmContract.js';

export function resolveSubstrateSmAnisotropyFramePolicy({
  enabled = false,
  profile = 'Lite',
  frameSource = 'none',
  certification,
  skinned = false,
} = {}) {
  let reasonCode = null;
  if (enabled !== true) reasonCode = 'SSM_ANISOTROPY_DISABLED';
  else if (profile !== 'Moderate') reasonCode = 'SSM_ANISOTROPY_REQUIRES_MODERATE';
  else if (frameSource !== 'geometry' && frameSource !== 'uvDerivatives') reasonCode = SSM_REFUSAL_CODES.tangentUnavailable;
  else if (!certification || certification.space !== 'view' ||
      certification.postDeformation !== true || certification.postNormalMap !== true ||
      certification.mirroredUv !== true || certification.nonUniformScale !== true ||
      certification.existingVaryings !== true || certification.fragmentHighp !== true ||
      typeof certification.evidenceId !== 'string' || certification.evidenceId.length === 0) {
    reasonCode = 'SSM_TANGENT_FRAME_UNCERTIFIED';
  } else if (skinned && certification.skinning !== true) reasonCode = 'SSM_TANGENT_SKINNING_UNCERTIFIED';
  else if (frameSource === 'uvDerivatives' && certification.derivatives !== true) reasonCode = 'SSM_UV_DERIVATIVES_UNCERTIFIED';
  return Object.freeze({
    enabled: reasonCode === null,
    effectiveFamily: reasonCode === null ? 'anisotropic' : 'base',
    frameSource: reasonCode === null ? frameSource : 'none',
    reasonCode,
    isotropicFallback: reasonCode !== null,
    releaseAuthorized: false,
    productionHostCertified: false,
    evidenceId: reasonCode === null ? certification.evidenceId : null,
  });
}
