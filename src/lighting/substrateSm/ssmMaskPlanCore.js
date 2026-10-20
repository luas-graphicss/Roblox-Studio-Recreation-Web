import { getSubstrateSmProfile } from './ssmContract.js';
import { isSubstrateSmMapPlan } from './ssmMapPlanCore.js';
import { normalizeSubstrateSmMapAsset, readSubstrateSmMapProperty } from './ssmMapValidation.js';
import { serializeSubstrateSmKeyDescriptor } from './ssmKeySerialization.js';
import { describeSubstrateSmBakeMemory } from './ssmTextureFootprint.js';
import { evaluateSubstrateSmProgramBudget } from './ssmProgramBudgetCore.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { createSubstrateSmLossEntry, createSubstrateSmLossReport } from './ssmLossReportCore.js';

export const SSM_MASK_PLAN_VERSION = 1;
export const SSM_MASK_UV_EXPRESSIONS = Object.freeze({
  color: 'vMapUv', normal: 'vNormalMapUv', roughness: 'vRoughnessMapUv',
  metalness: 'vMetalnessMapUv', occlusion: 'vAoMapUv', emissive: 'vEmissiveMapUv', alpha: 'vAlphaMapUv',
});
const admittedPlans = new WeakSet();

export function isSubstrateSmMaskPlan(plan) {
  return admittedPlans.has(plan);
}

function requireSameSampling(mask, reference) {
  if (serializeSubstrateSmKeyDescriptor(mask.sampling) !== serializeSubstrateSmKeyDescriptor(reference.sampling)) {
    throw new Error('Mask sampling must reuse an identical existing UV set, transform, filtering and orientation');
  }
}

function requireSamePacking(mask, reference) {
  requireSameSampling(mask, reference);
  for (const field of ['width', 'height', 'format', 'mipMode', 'mipLevels']) {
    if (mask[field] !== reference[field]) throw new Error(`Mask packing requires identical ${field}`);
  }
}

export function planSubstrateSmMask(input = {}) {
  try {
    const get = (name, fallback) => readSubstrateSmMapProperty(input, name, fallback);
    const mapPlan = get('mapPlan');
    if (!isSubstrateSmMapPlan(mapPlan)) throw new TypeError('An admitted F08 map plan is required');
    const profile = mapPlan.profile;
    const settings = getSubstrateSmProfile(profile);
    const mask = JSON.parse(serializeSubstrateSmKeyDescriptor(get('mask')));
    const allowed = ['mode', 'asset', 'channel', 'uvRole', 'alphaOwnership', 'dynamicInputs'];
    if (Object.keys(mask).some(name => !allowed.includes(name))) throw new TypeError('Unknown mask descriptor field');
    if (!Array.isArray(mask.dynamicInputs) || mask.dynamicInputs.length !== 0) {
      throw new Error('Dynamic, time, world, camera, light and exposure inputs are unsupported, never a static bake');
    }
    if (!['packed', 'optional', 'bake'].includes(mask.mode) || !['r', 'g', 'b', 'a'].includes(mask.channel)) {
      throw new TypeError('The mask requires an explicit mode and linear channel');
    }
    const source = normalizeSubstrateSmMapAsset(mask.asset, 'mask');
    if (source.format !== 'rgba8') throw new TypeError('Limited masks require static linear RGBA8 data');
    const aliases = mapPlan.bindings.filter(binding => binding.id === source.id);
    for (const alias of aliases) {
      requireSamePacking(source, alias);
      for (const field of ['revision', 'uploadVersion', 'colorSpace', 'residentBytes', 'retainedBytes']) {
        if (source[field] !== alias[field]) throw new Error(`One mask resource cannot have conflicting ${field} descriptors`);
      }
    }
    const sourceResidency = Object.freeze({ sourceResidentBytes: source.residentBytes,
      sourceRetainedBytes: source.retainedBytes,
      additionalOriginalResidentBytes: aliases.length ? 0 : source.residentBytes,
      additionalOriginalRetainedBytes: aliases.length ? 0 : source.retainedBytes,
      ownership: 'borrowed-static-original-caller-accounts-global-residency' });
    const extraMaterialSamplersInUse = get('extraMaterialSamplersInUse');
    if (!Number.isSafeInteger(extraMaterialSamplersInUse) || extraMaterialSamplersInUse < 0
      || extraMaterialSamplersInUse > settings.limits.extraMaterialSamplers) {
      throw new RangeError('Existing optional material sampler usage must be explicitly accounted');
    }
    const extraSamplers = mask.mode === 'optional' ? 1 : 0;
    if (extraSamplers + extraMaterialSamplersInUse > settings.limits.extraMaterialSamplers) {
      throw new RangeError('No optional mask sampler fits the effective profile');
    }
    let uvRole = mask.uvRole;
    let bake = null;
    if (mask.mode === 'optional') {
      const reference = mapPlan.bindings.find(binding => binding.role === uvRole);
      if (!reference || !Object.hasOwn(SSM_MASK_UV_EXPRESSIONS, uvRole)) throw new Error('An existing host map UV varying is required');
      if (mask.alphaOwnership !== undefined) throw new TypeError('Optional masks do not claim packed alpha');
      requireSameSampling(source, reference);
    } else {
      const orm = mapPlan.orm;
      if (!orm || orm.mode !== (mask.mode === 'bake' ? 'bake' : 'shared')) {
        throw new Error('Packed masks require the corresponding admitted shared or bake ORM plan');
      }
      if (uvRole !== undefined && uvRole !== 'roughness') throw new Error('ORM alpha must use the existing ORM sampling domain');
      uvRole = 'roughness';
      requireSamePacking(source, orm.roughness);
      if (mask.mode === 'packed') {
        if (mask.channel !== 'a' || mask.alphaOwnership !== 'spatial-mask'
          || source.id !== orm.roughness.id || source.revision !== orm.roughness.revision
          || source.uploadVersion !== orm.roughness.uploadVersion) {
          throw new Error('Existing packed alpha requires an explicit spatial-mask owner and the same versioned image');
        }
        if (mapPlan.bindings.some(binding => binding.id === source.id
          && !['roughness', 'metalness', 'occlusion'].includes(binding.role))) {
          throw new Error('Authored transparency, tint, normal or color alpha cannot be reused as a spatial mask');
        }
      } else {
        if (mask.alphaOwnership !== 'derived-free' || source.mipMode === 'provided') {
          throw new Error('Static mask bake requires explicitly free derived alpha and regenerable mips');
        }
        const sources = [orm.roughness, orm.metalness, ...(orm.occlusion ? [orm.occlusion] : []), source];
        bake = { sources, output: orm.output, channel: 'rgba'.indexOf(mask.channel),
          memory: describeSubstrateSmBakeMemory(sources, orm.output.layout) };
        if (bake.memory.incrementalPeakBytes > settings.limits.derivedTexturePeakBytes) {
          throw new RangeError('Static mask bake exceeds the texture peak budget before allocation');
        }
      }
    }
    const contextGeneration = mapPlan.contextGeneration;
    const hostUsage = get('hostUsage');
    if (!hostUsage || hostUsage.fragmentSamplers < mapPlan.bindings.length) throw new Error('The full host sampler ledger is required');
    const budget = evaluateSubstrateSmProgramBudget({ capabilities: get('capabilities'), contextGeneration, hostUsage,
      additionalUsage: { contextGeneration, fragmentSamplers: extraSamplers + extraMaterialSamplersInUse,
        vertexSamplers: 0, fragmentUniformVectors: 8, vertexUniformVectors: 0, varyingVectors: 0, attributes: 0,
        maxTextureSize: Math.max(source.width, source.height, mapPlan.budget.totals.maxTextureSize) } });
    if (!budget.ok) throw new RangeError(`${budget.code}: ${budget.field}`);
    const descriptor = copySubstrateSmImmutableData({ version: SSM_MASK_PLAN_VERSION, mode: mask.mode,
      source, channel: mask.channel, uvRole, alphaOwnership: mask.alphaOwnership ?? null,
      hostMaps: mapPlan.keyDescriptor, dynamicInputs: [], bake });
    const lossReport = createSubstrateSmLossReport([createSubstrateSmLossEntry({ sourcePath: 'surface/spatial-mask',
      operation: mask.mode === 'bake' ? 'packStaticOrmMask' : 'sampleStaticMask',
      replacement: mask.mode === 'bake' ? 'ownedLinearOrmAlphaWithMips' : 'singleSharedSpatialWeight',
      reason: mask.mode === 'bake' ? 'Copies a static UV field into free derived alpha; originals remain untouched; linear area mips are not a closure prefilter'
        : 'One linear mask weight reused before lighting; no descriptor or per-slab reads',
      classification: mask.mode === 'bake' ? 'baked' : 'exact' })]);
    const plan = Object.freeze({ ok: true, version: SSM_MASK_PLAN_VERSION, profile, contextGeneration,
      status: bake ? 'bakeRequired' : 'planned', applied: false, staticBake: bake !== null,
      mode: mask.mode, source, channel: mask.mode === 'optional' ? mask.channel : 'a', uvRole, mapPlan,
      bake: descriptor.bake, sourceResidency, extraSamplers, extraMaterialSamplersInUse,
      additionalTextureReads: extraSamplers, budget, keyDescriptor: descriptor,
      programBinding: `ssm-mask-v1:${mask.mode === 'optional' ? 'optional' : 'orm-alpha'}:${uvRole}:${mask.mode === 'optional' ? mask.channel : 'a'}`,
      lossReport, fallback: 'keep-last-valid-binding-or-host' });
    admittedPlans.add(plan);
    return plan;
  } catch (error) {
    const reason = String(error?.message ?? error);
    return Object.freeze({ ok: false, status: 'fallback', applied: false, staticBake: false,
      code: 'SSM_MASK_PLAN_REFUSED', reason, fallback: 'keep-last-valid-binding-or-host' });
  }
}
