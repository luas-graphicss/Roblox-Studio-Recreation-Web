import { inspectSubstrateSmMaterialBlend } from './ssmMaterialBlendPolicy.js';
import { inspectSubstrateSmMaterialDomain } from './ssmMaterialDomainPolicy.js';

export const SSM_MATERIAL_BOUNDARY_VERSION = 1;

export function inspectSubstrateSmMaterialBoundary(input = {}) {
  const settings = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const domain = inspectSubstrateSmMaterialDomain(settings);
  const blend = inspectSubstrateSmMaterialBlend(settings.material);
  const refusal = !domain.allowed ? domain : !blend.allowed ? blend : null;
  return Object.freeze({
    version: SSM_MATERIAL_BOUNDARY_VERSION,
    decisionType: 'material-boundary',
    allowed: refusal === null,
    blendMode: blend.blendMode,
    code: refusal?.code ?? null,
    reason: refusal?.reason ?? null,
    fallbackOwner: refusal ? 'existing-host' : null,
    applied: false,
    opticalSupportCertified: false,
    alphaOwner: 'host',
    sortingOwner: 'host',
    depthOwner: 'host',
    shadowCasterOwner: 'host',
    emissionOwner: 'host',
  });
}
