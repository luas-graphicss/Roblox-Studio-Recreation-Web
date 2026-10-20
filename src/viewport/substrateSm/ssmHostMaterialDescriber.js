import { compileSubstrateSmMaterial } from '../../lighting/substrateSm/ssmCompilerCore.js';
import { SSM_COMPILER_VERSION } from '../../lighting/substrateSm/ssmCompiledRecipeCore.js';
import { createSubstrateSmSourceKey, createSubstrateSmRecipeKey } from '../../lighting/substrateSm/ssmRecipeKeys.js';
import { SSM_PROFILES, SSM_FAMILY_CONTRACTS, SSM_THREE_REVISION } from '../../lighting/substrateSm/ssmContract.js';
import { legacyMaterialNames } from '../../lighting/substrate/sbLegacyMaterialTable.js';
import { readSubstrateSmHostCapabilities, estimateSubstrateSmHostUsage } from './ssmHostCapabilities.js';

export const SSM_HOST_DESCRIBER_VERSION = 1;
export const SSM_HOST_STRUCTURAL_VARIANT_VERSION = 1;

const RECIPE_PAYLOAD_BYTES = 128;
const RECIPE_UNIFORM_VECTORS = 8;
const COST = Object.freeze({ residentRecipes: 1, numericBufferBytes: RECIPE_PAYLOAD_BYTES, cpuCacheBytes: 1024, derivedTextureBytes: 0 });

function firstMesh(record) {
  for (const mesh of record.meshes) return mesh;
  return null;
}

function refusal(base, reason, details = {}) {
  return Object.freeze({ ...base, ok: false, reason, adapter: null, request: null, identity: null, cost: null, ...details });
}

export function resolveSubstrateSmHostMaterialPath(mesh, material) {
  if (!mesh || mesh.isMesh !== true) return Object.freeze({ ok: false, code: 'SSM_HOST_MESH_REQUIRED' });
  if (!material || Array.isArray(material)) return Object.freeze({ ok: false, code: 'SSM_HOST_SINGLE_MATERIAL_REQUIRED' });
  if (mesh.isSkinnedMesh || mesh.isBatchedMesh || mesh.geometry?.attributes?.rswMats || mesh.geometry?.attributes?.rswWeights) {
    return Object.freeze({ ok: false, code: 'SSM_HOST_GEOMETRY_DELEGATED' });
  }
  if (material.isMeshStandardMaterial === true && material.isMeshPhysicalMaterial !== true) {
    if (mesh.isInstancedMesh || mesh.geometry?.isInstancedBufferGeometry) return Object.freeze({ ok: false, code: 'SSM_HOST_POOL_STANDARD_DELEGATED' });
    return Object.freeze({ ok: true, materialPath: 'standard', hostBackend: 'standard' });
  }
  if (material.isMeshPhongMaterial === true) {
    return Object.freeze({ ok: true, materialPath: mesh.isInstancedMesh ? 'poolPhong' : 'phong', hostBackend: 'phong' });
  }
  if (material.isMeshPhysicalMaterial === true) return Object.freeze({ ok: false, code: 'SSM_HOST_PHYSICAL_DELEGATED' });
  return Object.freeze({ ok: false, code: 'SSM_HOST_PATH_UNSUPPORTED' });
}

export function buildSubstrateSmHostSourceRequest(material, sourceRevision) {
  const data = material?.userData ?? {};
  if (data.sbAuthoredTree) {
    return Object.freeze({ sourceKind: 'tree', tintMode: 'none', request: { tree: data.sbAuthoredTree, sourceRevision } });
  }
  const legacy = {};
  if (typeof data.__rswMatName === 'string' && legacyMaterialNames().includes(data.__rswMatName)) legacy.materialName = data.__rswMatName;
  return Object.freeze({ sourceKind: 'legacy', tintMode: 'host-diffuse', request: { legacy, sourceRevision } });
}

export function buildSubstrateSmHostUsage(profile, family, contextGeneration) {
  const limits = SSM_PROFILES[profile].limits;
  const usage = Object.fromEntries(Object.keys(limits).map(field => [field, 0]));
  return Object.freeze({
    ...usage,
    contextGeneration,
    maxTextureSize: 0,
    effectiveClosures: 1,
    lightLoopVisits: 1,
    specularTerms: SSM_FAMILY_CONTRACTS[family].specularTerms,
    payloadBytes: RECIPE_PAYLOAD_BYTES,
    fragmentUniformVectors: RECIPE_UNIFORM_VECTORS,
    residentRecipes: 1,
    numericBufferBytes: RECIPE_PAYLOAD_BYTES,
    cpuCacheBytes: RECIPE_PAYLOAD_BYTES * 2,
    familyVariants: 1,
    uploadRecordsPerSlice: 1,
    uploadBytesPerSlice: RECIPE_PAYLOAD_BYTES,
  });
}

function summarizeCompilation(compilation) {
  return Object.freeze({
    status: compilation.status,
    refusals: compilation.refusals.map(refusal => Object.freeze({ code: refusal.code, sourcePath: refusal.sourcePath })),
    losses: compilation.lossReport?.entries?.length ?? compilation.lossReport?.losses?.length ?? 0,
  });
}

export function createSubstrateSmHostMaterialDescriber({ THREE, renderer } = {}) {
  if (!THREE || !renderer) throw new TypeError('SSM_HOST_DESCRIBER_SERVICES_REQUIRED');
  let cachedHost = null;
  let cachedGeneration = -1;

  function readHost(configuration) {
    const generation = configuration?.contextGeneration ?? 0;
    if (cachedHost && cachedGeneration === generation) return cachedHost;
    cachedHost = readSubstrateSmHostCapabilities(renderer, generation);
    cachedGeneration = generation;
    return cachedHost;
  }

  function invalidateHost() {
    cachedHost = null;
    cachedGeneration = -1;
  }

  function describe(record, configuration, release) {
    const base = {
      describerVersion: SSM_HOST_DESCRIBER_VERSION,
      sourceRevision: record.revision,
      contextGeneration: configuration.contextGeneration,
      projectGeneration: configuration.projectGeneration,
      materialPath: null,
      hostBackend: null,
      family: null,
      profile: null,
      sourceKind: null,
      softwareRenderer: true,
      releaseTargets: Object.freeze([]),
      compilation: null,
    };
    const host = readHost(configuration);
    if (!host) return refusal(base, 'SSM_CONTEXT_UNAVAILABLE');
    base.softwareRenderer = host.softwareRenderer;
    if (String(THREE.REVISION) !== SSM_THREE_REVISION) return refusal(base, 'SSM_HOST_ADAPTER_UNAVAILABLE');
    const material = record.material;
    const mesh = firstMesh(record);
    const path = resolveSubstrateSmHostMaterialPath(mesh, material);
    if (!path.ok) return refusal(base, path.code);
    base.materialPath = path.materialPath;
    base.hostBackend = path.hostBackend;
    if (material.transparent || material.alphaHash || material.opacity !== 1 || material.transmission > 0) return refusal(base, 'SSM_HOST_TRANSPARENCY_DELEGATED');
    if (material.wireframe || material.flatShading) return refusal(base, 'SSM_HOST_VARIANT_DELEGATED');
    if (material.roughnessMap || material.metalnessMap || material.specularMap) return refusal(base, 'SSM_MAPPED_RESPONSE_REQUIRES_ADAPTER');
    const blendMode = material.alphaTest > 0 ? 'alphaTest' : 'opaque';
    const source = buildSubstrateSmHostSourceRequest(material, record.revision);
    base.sourceKind = source.sourceKind;
    const profiles = configuration.quality === 'Moderate' ? ['Moderate', 'Lite'] : ['Lite'];
    const permitted = Array.isArray(release?.permittedProfiles) ? release.permittedProfiles : [];
    const candidates = {};
    let primary = null;
    let lastCompilation = null;
    for (const profile of profiles) {
      if (!permitted.includes(profile)) continue;
      const compilation = compileSubstrateSmMaterial(source.request, { profile, blendMode, materialDomain: 'surface' });
      lastCompilation = compilation;
      if (!compilation.ok) continue;
      if (compilation.recipe.family !== 'base' || compilation.recipe.parameters.opacity !== 1) continue;
      candidates[profile] = Object.freeze({
        recipe: compilation.recipe,
        sourceRevision: record.revision,
        contextGeneration: configuration.contextGeneration,
        compiled: true,
        warmed: true,
        usage: buildSubstrateSmHostUsage(profile, compilation.recipe.family, configuration.contextGeneration),
      });
      if (!primary) primary = { profile, compilation };
    }
    if (lastCompilation) base.compilation = summarizeCompilation(lastCompilation);
    if (!primary) {
      const code = lastCompilation?.refusals?.[0]?.code;
      return refusal(base, lastCompilation?.ok ? 'SSM_HOST_FAMILY_DELEGATED' : code ? `SSM_COMPILE_${code}` : 'SSM_CANDIDATE_UNAVAILABLE');
    }
    base.family = primary.compilation.recipe.family;
    base.profile = primary.profile;
    let recipeKey;
    try {
      const sourceKey = createSubstrateSmSourceKey(primary.compilation.source);
      recipeKey = createSubstrateSmRecipeKey({ sourceKey, profile: primary.profile, compilerVersion: SSM_COMPILER_VERSION });
    } catch (error) {
      return refusal(base, `SSM_HOST_RECIPE_KEY_INVALID:${error.message}`);
    }
    const hostUsage = estimateSubstrateSmHostUsage(material, host.capabilities, configuration.contextGeneration);
    const routing = Object.freeze({
      technology: configuration.technology,
      renderStyle: configuration.renderStyle,
      enabled: configuration.enabled,
      quality: configuration.quality,
      safeMode: false,
      contextAvailable: true,
      contextGeneration: configuration.contextGeneration,
      materialPath: path.materialPath,
      hostPathReady: true,
      threeRevision: String(THREE.REVISION),
      materialDomain: 'surface',
      blendMode,
      tangentValid: false,
      sourceValidated: true,
      sourceRevision: record.revision,
      futureBackendEligible: false,
      release: Object.freeze({
        optInEnabled: release?.optInEnabled === true,
        autoEnabled: release?.autoEnabled === true,
        permittedProfiles: Object.freeze([...permitted]),
      }),
      capabilities: host.capabilities,
      hostUsage,
      candidates: Object.freeze(candidates),
    });
    const structuralVariant = `ssm-host-v${SSM_HOST_STRUCTURAL_VARIANT_VERSION}:${path.materialPath}:${blendMode}:${source.tintMode}:host-emission`;
    const request = Object.freeze({
      routing,
      recipeKey,
      structuralVariant,
      emissionMode: 'host',
      tintMode: source.tintMode,
      transforms: Object.freeze([]),
    });
    const identity = Object.freeze({
      contextGeneration: configuration.contextGeneration,
      projectGeneration: configuration.projectGeneration,
      jobGeneration: record.revision,
      sourceRevision: record.revision,
      programKey: `ssm/${base.family}/${path.hostBackend}/${blendMode}/${source.tintMode}`,
      capabilityKey: host.capabilityKey,
    });
    return Object.freeze({
      ...base,
      ok: true,
      reason: null,
      request,
      identity,
      cost: COST,
      releaseTargets: Object.freeze([Object.freeze({
        profile: primary.profile, family: base.family, materialPath: path.materialPath, msmMode: 'OFF',
      })]),
      recipe: primary.compilation.recipe,
      rendererString: host.rendererString,
    });
  }

  return Object.freeze({ describe, readHost, invalidateHost });
}
