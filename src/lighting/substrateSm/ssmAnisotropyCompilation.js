import { compileSubstrateSmSlab } from './ssmSlabCompilationCore.js';
import { createSubstrateSmCompiledRecipe } from './ssmCompiledRecipeCore.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { createSubstrateSmLossEntry } from './ssmLossReportCore.js';
import { createSubstrateSmCompilationRefusal } from './ssmValidationCore.js';

function refuse(node, code, reason) {
  return copySubstrateSmImmutableData({
    ok: false,
    surface: null,
    losses: [],
    refusals: [createSubstrateSmCompilationRefusal(code, node?.path ?? 'root', reason)],
  });
}

export function compileSubstrateSmAnisotropicSlab(node, { profile = 'Lite' } = {}) {
  if (node?.type !== 'bsdf' || node.bsdf !== 'slab' || !node.parameters) {
    return refuse(node, 'slabRequired', 'Anisotropy compilation requires a resolved F02 slab');
  }
  if (profile !== 'Lite' && profile !== 'Moderate') {
    return refuse(node, 'profileNotResolved', 'An effective Lite or Moderate profile is required');
  }
  const { anisotropy, anisotropyRotation } = node.parameters;
  if (typeof anisotropy !== 'number' || !Number.isFinite(anisotropy) || anisotropy < 0 || anisotropy > 1 ||
      typeof anisotropyRotation !== 'number' || !Number.isFinite(anisotropyRotation) ||
      anisotropyRotation < 0 || anisotropyRotation > Math.PI) {
    return refuse(node, 'invalidAnisotropyParameters', 'Resolved authored strength must be in [0, 1] and rotation in [0, pi] radians');
  }
  if (anisotropy === 0) return compileSubstrateSmSlab(node);
  if (profile !== 'Moderate') {
    return refuse(node, 'anisotropyRequiresModerate', 'Lite requires an explicit isotropic budget fallback, not silent feature removal');
  }
  const base = compileSubstrateSmSlab({
    ...node,
    parameters: { ...node.parameters, anisotropy: 0, anisotropyRotation: 0 },
  });
  if (!base.ok) return base;
  const surface = {
    family: 'anisotropic',
    parameters: { ...base.surface.parameters, anisotropy, anisotropyRotation: anisotropyRotation % Math.PI },
  };
  const validation = createSubstrateSmCompiledRecipe(surface, profile);
  if (!validation.ok) return copySubstrateSmImmutableData({ ...base, ok: false, surface: null, refusals: validation.refusals });
  return copySubstrateSmImmutableData({
    ok: true,
    surface,
    losses: [
      ...base.losses.filter(entry => entry.operation !== 'inactiveSlabFeatures'),
      createSubstrateSmLossEntry({
        sourcePath: node.path,
        operation: 'resolvedAnisotropicSlab',
        replacement: 'oneAnisotropicSpecularResponse',
        reason: 'Strength and pi-periodic rotation are retained in the existing F07 fields; no additional optical family is active. Structural parameter transfer is not whole-renderer optical certification.',
      }),
    ],
    refusals: [],
  });
}
