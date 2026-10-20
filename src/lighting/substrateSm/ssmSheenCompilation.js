import { compileSubstrateSmSlab } from './ssmSlabCompilationCore.js';
import { createSubstrateSmCompiledRecipe } from './ssmCompiledRecipeCore.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { createSubstrateSmLossEntry } from './ssmLossReportCore.js';
import { createSubstrateSmCompilationRefusal } from './ssmValidationCore.js';
import { SSM_SHEEN_MINIMUM_ROUGHNESS, SSM_SHEEN_RECIPE_FIELDS } from './ssmSheenContract.js';

function refuse(node, code, reason) {
  return copySubstrateSmImmutableData({
    ok: false,
    surface: null,
    losses: [],
    refusals: [createSubstrateSmCompilationRefusal(code, node?.path ?? 'root', reason)],
  });
}

function isUnitInterval(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function compileSubstrateSmSheenSlab(node, { profile = 'Lite' } = {}) {
  if (node?.type !== 'bsdf' || node.bsdf !== 'slab' || !node.parameters) {
    return refuse(node, 'slabRequired', 'Sheen compilation requires a resolved F02 slab');
  }
  if (profile !== 'Lite' && profile !== 'Moderate') {
    return refuse(node, 'profileNotResolved', 'An effective Lite or Moderate profile is required');
  }
  const { fuzzAmount, fuzzRoughness, fuzzColor } = node.parameters;
  if (!isUnitInterval(fuzzAmount) || !isUnitInterval(fuzzRoughness) ||
      !Array.isArray(fuzzColor) || fuzzColor.length !== 3 || !fuzzColor.every(isUnitInterval)) {
    return refuse(node, 'invalidSheenParameters', 'Resolved fuzz amount, roughness and color must be finite values in [0, 1]');
  }
  if (fuzzAmount === 0) return compileSubstrateSmSlab(node);
  if (fuzzRoughness < SSM_SHEEN_MINIMUM_ROUGHNESS) {
    return refuse(node, 'invalidSheenParameters', `Fuzz roughness below ${SSM_SHEEN_MINIMUM_ROUGHNESS} is outside the authored domain`);
  }
  const base = compileSubstrateSmSlab({
    ...node,
    parameters: { ...node.parameters, fuzzAmount: 0 },
  });
  if (!base.ok) return base;
  const surface = {
    family: 'sheen',
    parameters: {
      ...base.surface.parameters,
      [SSM_SHEEN_RECIPE_FIELDS.amount]: fuzzAmount,
      [SSM_SHEEN_RECIPE_FIELDS.roughness]: fuzzRoughness,
      [SSM_SHEEN_RECIPE_FIELDS.tint]: fuzzColor,
    },
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
        operation: 'resolvedSheenSlab',
        replacement: 'lowOrderFiberAdjustment',
        reason: 'Fuzz amount, roughness and color are retained in the existing F07 extension fields; the fiber response is a separable grazing approximation bounded by the intercepted energy, not an LTC sheen lobe.',
        classification: 'fitted',
      }),
    ],
    refusals: [],
  });
}
