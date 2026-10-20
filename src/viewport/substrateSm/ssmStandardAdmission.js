import { inspectSubstrateSmMaterialBoundary } from './ssmMaterialBoundaryPolicy.js';
import { resolveSubstrateSmBackend } from '../../lighting/substrateSm/ssmBackendPolicyCore.js';
import { resolveSubstrateSmOwnership } from '../../lighting/substrateSm/ssmOwnershipCore.js';
import { inspectSubstrateSmStandardHost, SSM_STANDARD_MATERIAL_PATH } from './ssmStandardHostPolicy.js';

export function resolveSubstrateSmStandardAdmission(mesh, input = {}) {
  const settings = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const host = inspectSubstrateSmStandardHost(mesh);
  const materialBoundary = inspectSubstrateSmMaterialBoundary({ material: mesh?.material, bsdfKind: settings.bsdfKind });
  const materialPath = settings.materialPath ?? SSM_STANDARD_MATERIAL_PATH;
  const pathMatches = materialPath === SSM_STANDARD_MATERIAL_PATH;
  const blendMode = settings.blendMode === undefined ? host.blendMode : settings.blendMode;
  const blendMatches = blendMode === host.blendMode;
  const supportedBlend = blendMode === 'opaque' || blendMode === 'alphaTest';
  const decision = resolveSubstrateSmBackend({
    ...settings,
    materialPath,
    blendMode,
    hostPathReady: settings.hostPathReady === true && host.allowed && materialBoundary.allowed && pathMatches && (!supportedBlend || blendMatches),
  });
  const profile = decision.effectiveQuality ?? decision.proposedQuality;
  const recipe = settings.candidates?.[profile]?.recipe;
  const familyDelegated = decision.family !== 'base';
  if (decision.eligible && (familyDelegated || recipe?.parameters?.opacity !== 1)) {
    return Object.freeze({
      ...decision,
      backend: 'legacy',
      targetBackend: 'legacy',
      state: 'fallback',
      eligible: false,
      ready: false,
      applied: false,
      effectiveQuality: null,
      code: familyDelegated ? 'SSM_STANDARD_FAMILY_DELEGATED' : 'SSM_RECIPE_TRANSPARENCY_DELEGATED',
      field: familyDelegated ? 'family' : 'recipe.parameters.opacity',
      ownership: resolveSubstrateSmOwnership('legacy'),
      host,
      materialBoundary,
      pathMatches,
      blendMatches,
    });
  }
  return Object.freeze({
    ...decision,
    host,
    materialBoundary,
    pathMatches,
    blendMatches,
  });
}
