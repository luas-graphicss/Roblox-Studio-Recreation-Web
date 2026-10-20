import { SUBSTRATE_SHADER_ANCHORS, checkSubstrateAnchor } from './substrateShaderAnchors.js';
import { assembleSubstrateShader } from './substrateShaderAssembler.js';
import { composeSubstrateClosures } from './substrateClosureComposition.js';
import { tierDefaults } from '../sbMaterialContract.js';
export function createSubstrateShaderRegistry({ THREE, flags, telemetry, readTier }) {
  const patches = new Map();
  const uniforms = new Map();
  const materials = new Map();
  let generation = 0;
  const checkAnchor = (libraryOrId, id) => checkSubstrateAnchor(id === undefined ? THREE : libraryOrId, id ?? libraryOrId);
  function registerUniform(name, definition) {
    if (!uniforms.has(name)) {
      const holder = { value: definition?.value ?? null };
      uniforms.set(name, { holder, owner: definition?.owner, get value() { return holder.value; }, set value(value) { holder.value = value; } });
    }
    return uniforms.get(name);
  }
  function registerPatch(definition) {
    if (!definition.id || !SUBSTRATE_SHADER_ANCHORS[definition.anchor] || !Number.isFinite(definition.order)) return { accepted: false, reason: 'Invalid shader patch contract' };
    for (const existing of patches.values()) if (existing.id !== definition.id && existing.anchor === definition.anchor && existing.order === definition.order) return { accepted: false, reason: 'Shader patch order collision' };
    patches.set(definition.id, { declarations: '', code: '', materialPaths: ['*'], ...definition });
    generation++;
    return { accepted: true, id: definition.id };
  }
  function activePatches(material) {
    if (!material.userData?.sbRuntime?.enabled) return [];
    const path = material.isMeshPhysicalMaterial ? 'physical' : 'standard';
    const tier = readTier();
    return [...patches.values()].filter(patch => (!patch.flagId || flags.isFlagActive(patch.flagId, tier)) && (patch.materialPaths.includes('*') || patch.materialPaths.includes(patch.owner === 'SB-F33' ? material.userData.sbMaterialPath : path)))
      .filter(patch => patch.owner !== 'SB-F26' || material.userData.sbBsdfKind === 'singleLayerWater')
      .sort((left, right) => left.order - right.order);
  }
  function applyToShader(shader, material) {
    const active = activePatches(material);
    if (!active.length) return false;
    const working = { vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader };
    const adapted = active.map(patch => ['SB-F9', 'SB-F31', 'SB-F18', 'SB-F21', 'SB-F23', 'SB-F24', 'SB-F25', 'SB-F26', 'SB-F27', 'SB-F29'].includes(patch.owner) || patch.owner === 'SB-F19' && patch.anchor === 'roughnessMapFragment' ? { ...patch, code: '' } : patch);
    const applied = [];
    for (const [stage, key] of [['vertex', 'vertexShader'], ['fragment', 'fragmentShader']]) {
      const result = assembleSubstrateShader(working[key], adapted.filter(patch => SUBSTRATE_SHADER_ANCHORS[patch.anchor].stage === stage), SUBSTRATE_SHADER_ANCHORS);
      if (result.refusedOwners.length) {
        telemetry.refusedPatch({ material: material.uuid, owners: result.refusedOwners, reason: 'Required include unavailable; material left on the complete legacy shader' });
        material.userData.sbRuntime.shaderInstalled = false;
        return false;
      }
      working[key] = '#ifndef USE_UV\n#define USE_UV\n#endif\n' + result.source;
      applied.push(...result.applied);
    }
    const result = composeSubstrateClosures(working.fragmentShader, {
      tier: readTier(), limit: tierDefaults(readTier()).closuresPerPixel,
      layering: active.some(patch => patch.owner === 'SB-F18'),
      slabDiffuse: active.some(patch => patch.owner === 'SB-F17'),
      anisotropy: active.some(patch => patch.owner === 'SB-F11'),
      secondLobe: active.some(patch => patch.owner === 'SB-F12'),
      specularEnergy: active.some(patch => patch.owner === 'SB-F10'),
      roughRefraction: active.some(patch => patch.owner === 'SB-F19'),
      eye: false,
      subsurface: active.some(patch => patch.owner === 'SB-F21'),
      decalBuffer: active.some(patch => patch.owner === 'SB-F29'),
      orderedTranslucency: active.some(patch => patch.owner === 'SB-F23'),
      roughnessTracking: flags.isFlagActive('SubstrateRoughnessTracking', readTier()),
      lightFunction: flags.isFlagActive('SubstrateDomainLightFunction', readTier()),
      hair: flags.isFlagActive('SubstrateHairBsdf', readTier()),
      water: flags.isFlagActive('SubstrateSingleLayerWater', readTier()),
    });
    if (!result.installed) { telemetry.refusedPatch({ material: material.uuid, reason: result.reason }); material.userData.sbRuntime.shaderInstalled = false; return false; }
    shader.vertexShader = working.vertexShader;
    shader.fragmentShader = result.source;
    for (const name of new Set((shader.vertexShader + shader.fragmentShader).match(/\buSb[A-Za-z0-9_]+\b/g) || [])) {
      const holder = material.userData.sbUniforms?.[name] || uniforms.get(name.endsWith('Input') ? name.slice(0, -5) : name)?.holder;
      if (holder) shader.uniforms[name] = holder;
    }
    material.userData.sbRuntime.shaderInstalled = true;
    material.userData.sbShader = shader;
    telemetry.appliedPatches(applied);
    return true;
  }
  function patchMaterial(material) {
    if (!material?.isMeshStandardMaterial || materials.has(material)) return false;
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    const hook = function (shader, renderer) {
      if (materials.get(material)?.hook === hook) applyToShader(shader, material);
      if (typeof previousCompile === 'function') previousCompile.call(this, shader, renderer);
    };
    const key = function () {
      const baseline = typeof previousKey === 'function' ? previousKey.call(this) : '';
      const active = materials.get(material)?.key === key ? activePatches(material) : [];
      const screenFlags = ['SubstrateRoughnessTracking', 'SubstrateDomainLightFunction', 'SubstrateSingleLayerWater', 'SubstrateHairBsdf'].map(id => Number(flags.isFlagActive(id, readTier()))).join('');
      return active.length ? baseline + '|substrate-v1|' + readTier() + '|' + generation + '|' + screenFlags + '|' + active.map(patch => patch.id).join(',') : baseline;
    };
    const disposeListener = () => forgetMaterial(material);
    materials.set(material, { previousCompile, previousKey, hook, key, disposeListener });
    material.onBeforeCompile = hook;
    material.customProgramCacheKey = key;
    material.addEventListener('dispose', disposeListener);
    material.userData.__rswSb = true;
    material.needsUpdate = true;
    return true;
  }
  function forgetMaterial(material) {
    const entry = materials.get(material);
    if (!entry) return;
    material.removeEventListener('dispose', entry.disposeListener);
    if (material.onBeforeCompile === entry.hook) material.onBeforeCompile = entry.previousCompile;
    if (material.customProgramCacheKey === entry.key) material.customProgramCacheKey = entry.previousKey;
    delete material.userData.__rswSb;
    delete material.userData.sbShader;
    materials.delete(material);
    material.needsUpdate = true;
  }
  function healMaterials() { for (const material of materials.keys()) material.needsUpdate = true; return { healed: materials.size, generation }; }
  return {
    registerUniform, registerPatch, checkAnchor, patchMaterial, forgetMaterial, applyToShader,
    readUniform: name => uniforms.get(name)?.value,
    setUniform(name, value) { const entry = uniforms.get(name); if (!entry) return false; entry.value = value; return true; },
    healMaterials,
    bumpGeneration() { generation++; healMaterials(); },
    snapshot: () => ({ materialCount: materials.size, patchCount: patches.size, generation }),
    dispose() {
      for (const material of [...materials.keys()]) forgetMaterial(material);
      const textures = new Set([...uniforms.values()].map(entry => entry.value).filter(value => value?.isTexture));
      for (const texture of textures) texture.dispose();
      patches.clear(); uniforms.clear();
    },
  };
}
