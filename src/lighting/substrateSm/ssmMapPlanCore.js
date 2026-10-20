import { planSurfaceMaps, SA_ALPHA_MODES, SA_NORMAL_CONVENTIONS } from '../surfaceAppearanceCore.js';
import { getSubstrateSmProfile } from './ssmContract.js';
import { evaluateSubstrateSmProgramBudget } from './ssmProgramBudgetCore.js';
import { readSubstrateSmMapProperty, normalizeSubstrateSmMapAsset } from './ssmMapValidation.js';
import { planSubstrateSmOrmPacking, SSM_MAP_PLAN_VERSION } from './ssmOrmPackingPlan.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { createSubstrateSmLossEntry, createSubstrateSmLossReport } from './ssmLossReportCore.js';
import { sumSubstrateSmBytes } from './ssmTextureFootprint.js';

const admittedPlans = new WeakSet();
const mapFields = Object.freeze(['colorMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'heightMap', 'detailColorMap', 'detailNormalMap']);
const roleSamplers = Object.freeze({ color: 'map', normal: 'normalMap', roughness: 'roughnessMap', metalness: 'metalnessMap', occlusion: 'aoMap', emissive: 'emissiveMap', alpha: 'alphaMap', detailColor: 'uSaDetailColor', detailNormal: 'uSaDetailNormal' });

export function isSubstrateSmMapPlan(plan) {
  return admittedPlans.has(plan);
}

export function planSubstrateSmMaps(input = {}) {
  let surfacePlan = null;
  let profile = 'Lite';
  try {
    const get = (name, fallback) => readSubstrateSmMapProperty(input, name, fallback);
    profile = get('profile', 'Lite');
    const settings = getSubstrateSmProfile(profile);
    if (!settings) throw new TypeError('Map planning requires an effective Lite or Moderate profile');
    const surfaceInput = get('surface', {});
    const surface = {};
    for (const field of mapFields) {
      const value = readSubstrateSmMapProperty(surfaceInput, field, '');
      if (value !== null && typeof value !== 'string') throw new TypeError(`Invalid SurfaceAppearance ${field}`);
      surface[field] = value ?? '';
    }
    for (const [field, fallback] of [['alphaMode', 'Overlay'], ['normalMapConvention', 'Auto']]) {
      surface[field] = readSubstrateSmMapProperty(surfaceInput, field, fallback) ?? fallback;
    }
    if (!SA_ALPHA_MODES.includes(surface.alphaMode) || !SA_NORMAL_CONVENTIONS.includes(surface.normalMapConvention)) {
      throw new TypeError('Invalid SurfaceAppearance alpha or normal convention');
    }
    for (const field of ['detailTiling', 'heightScale', 'pomSteps']) {
      const value = readSubstrateSmMapProperty(surfaceInput, field);
      if (value !== undefined) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid numeric SurfaceAppearance ${field}`);
        surface[field] = value;
      }
    }
    surfacePlan = planSurfaceMaps(surface, { weakGpu: true });
    const dynamicInputs = get('dynamicInputs', []);
    if (!Array.isArray(dynamicInputs) || dynamicInputs.length !== 0) throw new Error('Dynamic, camera, light, world and time inputs cannot be baked statically');
    if (surface.heightMap || surface.detailColorMap || surface.detailNormalMap) {
      throw new Error('POM and detail-map processing require a separate admitted reduction; F08 never silently removes them');
    }
    const hostMaps = get('hostMaps', {});
    const requests = [];
    const add = (role, id) => {
      if (id === null || id === undefined || id === '') return;
      if (typeof id !== 'string') throw new TypeError(`Invalid ${role} map reference`);
      requests.push({ role, id });
    };
    add('color', surfacePlan.maps.color?.id);
    add('normal', surfacePlan.maps.normal?.id);
    add('roughness', surfacePlan.maps.orm?.id ?? surfacePlan.maps.roughness?.id);
    add('metalness', surfacePlan.maps.orm?.id ?? surfacePlan.maps.metalness?.id);
    add('occlusion', readSubstrateSmMapProperty(hostMaps, 'aoMap', surfacePlan.maps.orm?.id));
    add('emissive', readSubstrateSmMapProperty(hostMaps, 'emissiveMap'));
    add('alpha', readSubstrateSmMapProperty(hostMaps, 'alphaMap'));
    if (Object.keys(hostMaps).some(key => !['aoMap', 'emissiveMap', 'alphaMap'].includes(key))) throw new TypeError('Unknown host map role');
    const assets = get('assets', []);
    if (!Array.isArray(assets) || assets.length > 256) throw new TypeError('Assets must be a bounded descriptor list');
    const assetIndex = new Map();
    for (const asset of assets) {
      const id = readSubstrateSmMapProperty(asset, 'id');
      if (assetIndex.has(id)) throw new TypeError('Ambiguous duplicate asset metadata');
      assetIndex.set(id, asset);
    }
    const sampling = get('sampling', {});
    if (Object.keys(sampling).some(role => !requests.some(request => request.role === role))) throw new TypeError('Sampling supplied for an unused map role');
    const bindings = requests.map(({ role, id }) => ({
      ...normalizeSubstrateSmMapAsset(assetIndex.get(id), role, readSubstrateSmMapProperty(sampling, role)),
      sampler: roleSamplers[role], ownership: 'borrowed-host',
    }));
    const orm = planSubstrateSmOrmPacking(bindings, get('ormMode', 'host'));
    if (orm?.memory && orm.memory.incrementalPeakBytes > settings.limits.derivedTexturePeakBytes) {
      throw new RangeError('Derived texture peak exceeds the effective SSM profile before allocation');
    }
    const contextGeneration = get('contextGeneration');
    const hostUsage = get('hostUsage');
    if (!hostUsage || hostUsage.fragmentSamplers < bindings.length) throw new Error('Full host sampler ledger must include every material sampler slot');
    const maxTextureSize = Math.max(0, ...bindings.map(binding => Math.max(binding.width, binding.height)));
    const budget = evaluateSubstrateSmProgramBudget({
      capabilities: get('capabilities'), contextGeneration, hostUsage,
      additionalUsage: { contextGeneration, fragmentSamplers: 0, vertexSamplers: 0,
        fragmentUniformVectors: 0, vertexUniformVectors: 0, varyingVectors: 0, attributes: 0, maxTextureSize },
    });
    if (!budget.ok) throw new Error(`${budget.code}: ${budget.field}`);
    const uniqueResources = new Map();
    for (const binding of bindings) uniqueResources.set(JSON.stringify([binding.id, binding.revision, binding.colorSpace]), binding);
    let originalTextureBytes = 0;
    for (const resource of uniqueResources.values()) originalTextureBytes = sumSubstrateSmBytes(originalTextureBytes, resource.residentBytes);
    const structuralBindings = bindings.filter(binding => !orm || !['roughness', 'metalness', 'occlusion'].includes(binding.role))
      .map(binding => `${binding.role}:uv${binding.sampling.uvSet}:${binding.colorSpace || 'data'}`);
    if (orm) structuralBindings.push(`orm:uv${orm.output.sampling.uvSet}:rgb:${orm.occlusionEnabled ? 'ao' : 'no-ao'}`);
    structuralBindings.sort();
    const keyDescriptor = copySubstrateSmImmutableData({
      version: SSM_MAP_PLAN_VERSION, profile, bindings,
      alpha: surfacePlan.alpha, normalScaleY: surfacePlan.normalScaleY,
      orm: orm === null ? null : { mode: orm.mode, output: orm.output, channels: orm.channels, requiredPatch: orm.requiredPatch },
    });
    const lossReport = createSubstrateSmLossReport([createSubstrateSmLossEntry({
      sourcePath: 'surface/maps', operation: orm?.mode === 'bake' ? 'packOrm' : 'reuseSurfaceMaps',
      replacement: orm?.mode === 'bake' ? 'linearOrmWithMips' : 'unchangedHostMapSemantics',
      reason: orm?.mode === 'bake' ? 'Static linear channel packing; mip averages preserve the host convention, not a new normal-variance prefilter'
        : 'Authored alpha, UV transforms, normal convention and slot color spaces remain host-owned',
      classification: orm?.mode === 'bake' ? 'baked' : 'exact',
    })]);
    const plan = copySubstrateSmImmutableData({
      ok: true, version: SSM_MAP_PLAN_VERSION, profile, contextGeneration,
      status: orm?.mode === 'bake' ? 'bakeRequired' : 'planned', applied: false,
      surfacePlan, bindings, orm, keyDescriptor, programBindings: structuralBindings,
      sampling: { hostSamplerSlots: bindings.length, conservativeSamplerSlots: bindings.length,
        candidateSamplerSlots: bindings.length - (orm ? orm.sourceSamplerSlots - 1 : 0),
        candidateTextureReads: bindings.length - (orm ? orm.sourceSamplerSlots - 1 : 0),
        requiredPatch: orm?.requiredPatch ?? null, measured: false },
      originalTextureBytes, budget, lossReport, refusals: [],
      fallback: 'keep-last-valid-binding-or-host',
    });
    admittedPlans.add(plan);
    return plan;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Map planning failed';
    const budgetFailure = error instanceof RangeError && /peak|budget/i.test(reason);
    return copySubstrateSmImmutableData({
      ok: false, version: SSM_MAP_PLAN_VERSION, profile: typeof profile === 'string' ? profile : null, status: 'fallback', applied: false,
      surfacePlan, fallback: 'keep-last-valid-binding-or-host',
      refusals: [{ code: budgetFailure ? 'SSM_MAP_BUDGET_EXCEEDED' : 'SSM_MAP_PLAN_REFUSED', sourcePath: 'surface/maps', reason }],
      lossReport: createSubstrateSmLossReport([createSubstrateSmLossEntry({
        sourcePath: 'surface/maps', operation: 'mapPlanning', replacement: 'preservedHostMaterial', reason,
        classification: budgetFailure ? 'budgetFallback' : 'unsupported',
      })]),
    });
  }
}
