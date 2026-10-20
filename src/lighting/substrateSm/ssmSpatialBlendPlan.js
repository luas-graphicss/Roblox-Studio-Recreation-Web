import { SSM_RECIPE_VERSION } from './ssmContract.js';
import { createSubstrateSmCompiledRecipe, SSM_COMPILER_VERSION } from './ssmCompiledRecipeCore.js';
import { readSubstrateSmRecipePayload, writeSubstrateSmRecipePayload } from './ssmRecipeLayout.js';
import { isSubstrateSmMaskPlan } from './ssmMaskPlanCore.js';
import { isSubstrateSmMapPlan } from './ssmMapPlanCore.js';
import { planSubstrateSmSpatialChannels } from './ssmSpatialChannels.js';
import { readSubstrateSmMapProperty } from './ssmMapValidation.js';
import { serializeSubstrateSmKeyDescriptor } from './ssmKeySerialization.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { createSubstrateSmLossEntry, createSubstrateSmLossReport } from './ssmLossReportCore.js';

export const SSM_SPATIAL_BLEND_VERSION = 1;
export const SSM_SPATIAL_RECIPE_VECTORS = 7;
export const SSM_SPATIAL_TARGET_VECTORS = 1;
const admittedPlans = new WeakSet();

export function isSubstrateSmSpatialBlendPlan(plan) {
  return admittedPlans.has(plan);
}

function normalizeRecipe(input, profile) {
  const recipe = JSON.parse(serializeSubstrateSmKeyDescriptor(input));
  if (recipe.version !== SSM_RECIPE_VERSION || recipe.compilerVersion !== SSM_COMPILER_VERSION || recipe.profile !== profile) {
    throw new Error('Spatial endpoints require matching admitted recipe, compiler and profile versions');
  }
  const validated = createSubstrateSmCompiledRecipe(recipe, profile);
  if (!validated.ok) throw new Error(validated.refusals.map(entry => entry.reason).join('; '));
  return Object.freeze({ ...validated.recipe, parameters: readSubstrateSmRecipePayload(writeSubstrateSmRecipePayload(validated.recipe.parameters)) });
}

export function planSubstrateSmSpatialBlend(input = {}) {
  try {
    const get = (name, fallback) => readSubstrateSmMapProperty(input, name, fallback);
    const maskPlan = get('maskPlan');
    if (!isSubstrateSmMaskPlan(maskPlan)) throw new Error('Spatial mixing requires an admitted mask plan');
    const alternateMapPlan = get('alternateMapPlan');
    if (!isSubstrateSmMapPlan(alternateMapPlan) || alternateMapPlan.contextGeneration !== maskPlan.contextGeneration
      || serializeSubstrateSmKeyDescriptor(alternateMapPlan.keyDescriptor) !== serializeSubstrateSmKeyDescriptor(maskPlan.mapPlan.keyDescriptor)) {
      throw new Error('Different endpoint maps, UVs or normal spaces require an explicit reduction, not per-slab sampling');
    }
    const zeroRecipe = normalizeRecipe(get('zeroRecipe'), maskPlan.profile);
    const oneRecipe = normalizeRecipe(get('oneRecipe'), maskPlan.profile);
    if (zeroRecipe.family !== oneRecipe.family) throw new Error('One spatial resolve cannot switch or combine shader families');
    const channels = planSubstrateSmSpatialChannels(get('channels'),
      writeSubstrateSmRecipePayload(zeroRecipe.parameters), writeSubstrateSmRecipePayload(oneRecipe.parameters));
    const structure = channels.map(channel => channel.components.map(component => component.name).join('=')).join(',');
    const keyDescriptor = copySubstrateSmImmutableData({ version: SSM_SPATIAL_BLEND_VERSION, zeroRecipe, oneRecipe,
      channels, mask: maskPlan.keyDescriptor });
    const lossReport = createSubstrateSmLossReport([
      ...maskPlan.lossReport.entries,
      createSubstrateSmLossEntry({ sourcePath: 'surface/spatial-blend', operation: 'limitedParameterMixture',
        replacement: 'oneEffectiveSurfaceBeforeLighting', classification: 'fitted',
        reason: 'Mask endpoints retain their compiled parameters. Interior weights fit one closure; linear reflectance and GGX alpha-squared interpolation do not equal two independently lit slabs',
        estimatedLoss: null, measuredLoss: null, evidenceStatus: 'unmeasured' }),
    ]);
    const plan = Object.freeze({ ok: true, version: SSM_SPATIAL_BLEND_VERSION, profile: maskPlan.profile,
      family: zeroRecipe.family, contextGeneration: maskPlan.contextGeneration, applied: false,
      status: maskPlan.status, maskPlan, zeroRecipe, oneRecipe, channels,
      keyDescriptor, programBindings: Object.freeze([...maskPlan.mapPlan.programBindings,
        maskPlan.programBinding, `ssm-spatial-v1:${zeroRecipe.family}:${structure}`]),
      resourceContract: Object.freeze({ fragmentUniformVectors: 8, numericBytes: 128, recipePrefixVectors: 7,
        targetVectors: 1, extraMaterialSamplers: maskPlan.extraSamplers, additionalTextureReads: maskPlan.additionalTextureReads,
        materialResolves: 1, effectiveClosures: 1, lightLoopVisits: 1, perSlabMapLoops: 0,
        vertexUniformVectors: 0, varyingVectors: 0, attributes: 0, fullscreenPasses: 0,
        screenTargetBytes: 0, temporalHistories: 0, descriptorTextureReads: 0 }),
      budget: maskPlan.budget, lossReport, integrationStatus: 'requires-host-prelight-composition-and-family-admission',
      fallback: 'keep-last-valid-binding-or-host' });
    admittedPlans.add(plan);
    return plan;
  } catch (error) {
    const reason = String(error?.message ?? error);
    return Object.freeze({ ok: false, status: 'fallback', applied: false, code: 'SSM_SPATIAL_BLEND_REFUSED', reason,
      fallback: 'keep-last-valid-binding-or-host', lossReport: createSubstrateSmLossReport([
        createSubstrateSmLossEntry({ sourcePath: 'surface/spatial-blend', operation: 'limitedParameterMixture',
          replacement: 'preservedHostMaterial', classification: 'unsupported', reason }),
      ]) });
  }
}
