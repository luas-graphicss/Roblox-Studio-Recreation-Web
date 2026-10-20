import { isSubstrateSmSpatialBlendPlan } from '../../lighting/substrateSm/ssmSpatialBlendPlan.js';
import { writeSubstrateSmRecipePayload } from '../../lighting/substrateSm/ssmRecipeLayout.js';
import { SSM_RECIPE_UNIFORM_NAME } from '../../lighting/substrateSm/ssmRecipeLayoutGlsl.js';
import { buildSubstrateSmSpatialResolveGlsl, SSM_SPATIAL_TARGET_UNIFORM, SSM_SPATIAL_MASK_UNIFORM } from '../../lighting/substrateSm/ssmSpatialResolveGlsl.js';
import { createSubstrateSmRecipeKey, createSubstrateSmProgramKey } from '../../lighting/substrateSm/ssmRecipeKeys.js';
import { serializeSubstrateSmKeyDescriptor } from '../../lighting/substrateSm/ssmKeySerialization.js';
import { validateSubstrateSmSpatialTextures } from './ssmSpatialTextureValidation.js';

function programKey(plan) {
  return createSubstrateSmProgramKey({ family: plan.family, hostBackend: 'standard',
    structuralVariant: 'spatial-resolve-v1-prefix7-target1', patchGeneration: 1, mapBindings: plan.programBindings });
}

function recipeKey(plan, sourceKey, geometry) {
  return createSubstrateSmRecipeKey({ sourceKey, profile: plan.profile, compilerVersion: plan.zeroRecipe.compilerVersion,
    mapPlan: plan.keyDescriptor, geometry });
}

function storageCost(plan, key, glsl) {
  return { residentRecipes: 1, numericBufferBytes: 128,
    cpuCacheBytes: 4096 + 384 + 2 * (serializeSubstrateSmKeyDescriptor(plan.keyDescriptor).length
      + key.signature.length + glsl.declarations.length + glsl.resolve.length) };
}

export function createSubstrateSmSpatialBindingCandidate(input = {}) {
  const owner = {};
  let reserved = false;
  const memoryLedger = input.memoryLedger;
  try {
    const initialPlan = input.plan;
    if (!isSubstrateSmSpatialBlendPlan(initialPlan) || input.contextGeneration !== initialPlan.contextGeneration
      || !memoryLedger || memoryLedger.profile !== initialPlan.profile || typeof memoryLedger.reserve !== 'function') {
      throw new Error('Spatial bindings require a current admitted plan and matching F07 memory ledger');
    }
    if (initialPlan.zeroRecipe.parameters.opacity !== 1 || initialPlan.oneRecipe.parameters.opacity !== 1) {
      throw new Error('The current F18 candidate does not own transparency or partial opacity');
    }
    const geometry = JSON.parse(serializeSubstrateSmKeyDescriptor(input.geometry ?? {}));
    const texture = validateSubstrateSmSpatialTextures({ ...input, maskPlan: initialPlan.maskPlan });
    const glsl = buildSubstrateSmSpatialResolveGlsl(initialPlan);
    const structureKey = programKey(initialPlan);
    let currentKey = recipeKey(initialPlan, input.sourceKey, geometry);
    let currentPlan = initialPlan;
    let currentSourceKey = input.sourceKey;
    if (!memoryLedger.reserve(owner, storageCost(initialPlan, currentKey, glsl))) throw new Error('SSM_SPATIAL_CPU_BUDGET_UNAVAILABLE');
    reserved = true;
    const storage = new ArrayBuffer(128);
    const prefix = new Float32Array(storage, 0, 28);
    const target = new Float32Array(storage, 112, 4);
    const uniforms = {
      [SSM_RECIPE_UNIFORM_NAME]: { value: prefix },
      [SSM_SPATIAL_TARGET_UNIFORM]: { value: target },
    };
    if (initialPlan.maskPlan.mode === 'optional') uniforms[SSM_SPATIAL_MASK_UNIFORM] = { value: texture };
    let disposed = false;

    function writeParameters(plan) {
      const payload = writeSubstrateSmRecipePayload(plan.zeroRecipe.parameters);
      prefix.set(payload.subarray(0, 28));
      target.fill(0);
      for (const channel of plan.channels) target[channel.targetIndex] = channel.targetValue;
    }
    writeParameters(initialPlan);

    function updateParameters(nextPlan, nextSourceKey = currentSourceKey) {
      if (disposed) return 'disposed';
      try {
        if (!isSubstrateSmSpatialBlendPlan(nextPlan) || nextPlan.zeroRecipe.parameters.opacity !== 1
          || nextPlan.oneRecipe.parameters.opacity !== 1 || nextPlan.contextGeneration !== initialPlan.contextGeneration
          || nextPlan.profile !== initialPlan.profile || programKey(nextPlan).signature !== structureKey.signature
          || serializeSubstrateSmKeyDescriptor(nextPlan.maskPlan.keyDescriptor) !== serializeSubstrateSmKeyDescriptor(initialPlan.maskPlan.keyDescriptor)) {
          return 'replacement-required';
        }
        validateSubstrateSmSpatialTextures({ ...input, maskPlan: nextPlan.maskPlan });
        const nextKey = recipeKey(nextPlan, nextSourceKey, geometry);
        if (nextKey.signature === currentKey.signature) return 'unchanged';
        if (!memoryLedger.reserve(owner, storageCost(nextPlan, nextKey, glsl))) return 'budget-fallback';
        writeParameters(nextPlan);
        currentPlan = nextPlan;
        currentKey = nextKey;
        currentSourceKey = nextSourceKey;
        return 'updated';
      } catch {
        return 'refused';
      }
    }

    function dispose() {
      if (disposed) return false;
      disposed = true;
      prefix.fill(0);
      target.fill(0);
      if (uniforms[SSM_SPATIAL_MASK_UNIFORM]) uniforms[SSM_SPATIAL_MASK_UNIFORM].value = null;
      memoryLedger.release(owner);
      return true;
    }

    return Object.freeze({ ok: true, applied: false, integrationStatus: initialPlan.integrationStatus,
      glsl, uniforms: Object.freeze(uniforms), programKey: structureKey, resourceContract: initialPlan.resourceContract,
      textureOwnership: 'borrowed-resource-caller-retains-cache-lease', updateParameters, dispose,
      readPlan: () => currentPlan, readRecipeKey: () => currentKey, isAlive: () => !disposed });
  } catch (error) {
    if (reserved) memoryLedger.release(owner);
    return Object.freeze({ ok: false, applied: false, code: 'SSM_SPATIAL_BINDING_REFUSED',
      reason: String(error?.message ?? error), fallback: 'keep-last-valid-binding-or-host' });
  }
}
