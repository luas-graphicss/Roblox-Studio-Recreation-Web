import { normalizeMaterialTree } from './sbMaterialTreeCore.js';
import { resolveSceneMaterialTree } from './sbSceneMaterialTree.js';
import { validateAuthoringGraph } from './sbAuthoringGraphCore.js';
import { compileRuntimeMaterial } from './sbRuntimeMaterialCompiler.js';
import { createMaterialTexture } from './sbMaterialTexture.js';
import { applyClosureRenderState } from './sbMaterialRenderState.js';
import { RUNTIME_FEATURE_UNIFORMS, RUNTIME_FEATURE_COMPONENT_COUNTS, RUNTIME_THIN_TRANSLUCENCY_UNIFORM } from './sbRuntimeClosureShader.js';
import { packThinTranslucencyPerSlot, resolveMaterialThinTranslucency } from './sbThinTranslucencyCore.js';
import { thinTranslucencyProfile } from './sbThinTranslucencyProfiles.js';
import { bindSlabMapUniforms, slabMapAllSamplerNames } from './sbSlabMapRuntime.js';
import { resolveSlabMapBindings, SB_SLAB_MAP_MASK_DATA_KEY } from './sbSlabMapBindingCore.js';
import { resolveRuntimeFeaturePolicy, resolveRuntimeOperators, synchronizeSpecializedDefines } from './sbRuntimeFeaturePolicy.js';
export function createMaterialRuntime({ THREE, bench, isFlagActive, telemetry, readIntegrationGate = () => null, readUniform = () => undefined }) {
  const entries = new Map();
  let selectedId = null;
  let lastFrame = null;
  let closureLimit = null;
  const drawnClosures = entry => entry.result?.closures.slice(0, closureLimit ?? 3) ?? [];
  const SLAB_MAP_FLAG = 'SubstrateSlabMaps';
  function synchronizeSlabMaps(entry, tier) {
    const material = entry.material;
    const bindings = resolveSlabMapBindings({ materialData: material.userData, tierName: tier, flagActive: isFlagActive(SLAB_MAP_FLAG, tier) === true });
    for (const binding of bindings.samplers) {
      const holder = entry.uniforms[binding.sampler] ??= { value: null };
      holder.value = binding.texture;
      const wanted = binding.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (binding.texture.colorSpace !== wanted) { binding.texture.colorSpace = wanted; binding.texture.needsUpdate = true; }
    }
    if (material.userData[SB_SLAB_MAP_MASK_DATA_KEY] !== bindings.maskKey) {
      material.userData[SB_SLAB_MAP_MASK_DATA_KEY] = bindings.maskKey;
      material.needsUpdate = true;
    }
    entry.slabMaps = bindings;
    return bindings;
  }
  function sceneMaterials() {
    const materials = new Set();
    bench.scene.traverse(object => {
      for (const material of [].concat(object.material ?? [])) if (material.userData?.sbSlab || material.userData?.sbAuthoredTree || material.userData?.sbSceneTree) materials.add(material);
    });
    return [...materials];
  }
  const idOf = material => material.userData.sbSlabId ?? material.uuid;
  function synchronizeAuthoredKind(material) {
    const data = material.userData;
    const root = data.sbAuthoredTree;
    const kind = root && root.type === 'bsdf' && typeof root.bsdf === 'string' && root.bsdf !== 'slab' ? root.bsdf : null;
    if (kind) { data.sbBsdfKind = kind; data.__rswSbKindFromTree = true; return; }
    if (data.__rswSbKindFromTree) { delete data.sbBsdfKind; delete data.__rswSbKindFromTree; }
  }
  function subsurfaceReachOf(entry) {
    const reach = [0, 0, 0];
    for (const closure of drawnClosures(entry)) {
      const mfp = closure.parameters?.subsurfaceMeanFreePath;
      const weight = Number.isFinite(closure.weight) ? Math.max(0, closure.weight) : 1;
      const channels = Array.isArray(mfp) ? mfp : Number.isFinite(mfp) ? [mfp, mfp, mfp] : null;
      if (!channels) continue;
      for (let index = 0; index < 3; index += 1) reach[index] = Math.max(reach[index], (Number(channels[index]) || 0) * weight);
    }
    return reach;
  }
  function targets() { return sceneMaterials().filter(material => idOf(material) !== 'ground').map(material => ({ id: idOf(material), label: (material.name || material.userData.__rswMatName || 'Material') + ' · ' + idOf(material).slice(0, 8), selected: idOf(material) === selectedId })); }
  function ensureTarget() {
    const choices = targets();
    if (!choices.some(item => item.id === selectedId)) selectedId = choices[0]?.id ?? null;
    return selectedId;
  }
  function entryFor(material) {
    if (entries.has(material)) return entries.get(material);
    const uniforms = {
      uSbMaterialBuffer: { value: null }, uSbMaterialBufferSize: { value: new THREE.Vector2(1, 1) },
      uSbClosureCount: { value: 1 }, uSbRuntimeWeights: { value: new Float32Array([1, 0, 0]) },
      uSbRuntimeLayers: { value: new Float32Array(12) }, uSbRuntimeCoverage: { value: new Float32Array(3) },
      uSbRuntimeParents: { value: new Float32Array([-1, -1, -1]) }, uSbRuntimeOverrides: { value: new Float32Array(RUNTIME_FEATURE_UNIFORMS.length) },
      [RUNTIME_THIN_TRANSLUCENCY_UNIFORM]: { value: new Float32Array(12) },
    };
    for (const samplerName of slabMapAllSamplerNames()) uniforms[samplerName] = { value: null };
    RUNTIME_FEATURE_UNIFORMS.forEach((name, index) => {
      const componentCount = RUNTIME_FEATURE_COMPONENT_COUNTS[index];
      uniforms[name + 'Input'] = { value: componentCount === 1 ? 0 : new Array(componentCount).fill(0) };
    });
    const entry = { material, id: idOf(material), uniforms, texture: createMaterialTexture(THREE), enabled: false, key: null, uploadedKey: null, result: null, compileCount: 0, legacyRenderState: {transparent:material.transparent,depthWrite:material.depthWrite}, renderState:null };
    material.userData.sbUniforms = uniforms;
    material.userData.sbRuntime = { enabled: false };
    entries.set(material, entry);
    entry.disposeListener = () => forgetMaterial(material);
    material.addEventListener('dispose', entry.disposeListener);
    return entry;
  }
  function forgetMaterial(material) {
    const entry = entries.get(material);
    if (!entry) return;
    material.removeEventListener('dispose', entry.disposeListener);
    applyClosureRenderState(material, {enabled:false, legacy:entry.legacyRenderState});
    entry.texture.dispose();
    entries.delete(material);
  }
  function resolveFrame(context, options = {}) {
    const tier = context.tier;
    const policy = resolveRuntimeFeaturePolicy(tier, isFlagActive, readIntegrationGate());
    const active = policy.enabled;
    context.substrateRuntimeGate = policy;
    if (options.updateSelection !== false) ensureTarget();
    const frameEntries = [];
    for (const material of options.materials ?? sceneMaterials()) {
      synchronizeAuthoredKind(material);
      synchronizeSpecializedDefines(material);
      const entry = entryFor(material);
      if (entry.authoredRoot !== material.userData.sbAuthoredTree) {
        entry.uniforms.uSbRuntimeOverrides.value.fill(0);
        entry.authoredRoot = material.userData.sbAuthoredTree;
      }
      if (entry.renderState) {
        if (material.transparent !== entry.renderState.transparent) entry.legacyRenderState.transparent = material.transparent;
        if (material.depthWrite !== entry.renderState.depthWrite) entry.legacyRenderState.depthWrite = material.depthWrite;
      }
      const root = resolveRuntimeOperators(resolveSceneMaterialTree(material), policy);
      const simplify = policy.simplify;
      const key = active ? JSON.stringify([tier, material.userData.sbMaterialPath, simplify, root]) : entry.key;
      if (active && key !== entry.key) {
        entry.result = compileRuntimeMaterial(root, { tier, materialFamily: material.userData.sbMaterialPath, simplify });
        entry.key = key;
        entry.compileCount += 1;
        if (!entry.result.ok) telemetry?.error?.('materialRuntime', `${entry.id}: ${entry.result.problems.join('; ')}`);
      }
      const nextEnabled = active && material.isMeshStandardMaterial === true && entry.result?.ok === true && !material.userData.__rswSbAuthoringError && !material.userData.__rswSbMaterialVeto;
      const slabMaps = bindSlabMapUniforms({ THREE, materialData: material.userData, tierName: tier, uniforms: entry.uniforms });
      if (entry.slabMaps?.key !== slabMaps.key) material.needsUpdate = true;
      for (const refusal of slabMaps.refusals) if (!entry.slabMaps?.refusals.some(previous => previous.slot === refusal.slot && previous.code === refusal.code)) telemetry?.error?.('materialRuntime', `${entry.id}: mapa por slab recusado (${refusal.slot}: ${refusal.code})`);
      entry.slabMaps = slabMaps;
      material.userData.sbRuntime.slabMapSlots = slabMaps.bound;
      if (nextEnabled !== entry.enabled) material.needsUpdate = true;
      if (!nextEnabled) entry.renderState = applyClosureRenderState(material, {enabled:false,legacy:entry.legacyRenderState});
      entry.enabled = nextEnabled;
      material.userData.sbRuntime.enabled = nextEnabled;
      if (entry.enabled) frameEntries.push(entry);
    }
    context.substrateMaterials = frameEntries;
    const representative = frameEntries.find(entry => entry.id === selectedId) ?? frameEntries[0];
    context.substrateTopology = representative?.result.topology ?? null;
    context.substrateClosures = representative ? drawnClosures(representative) : [];
    context.substrateStack = representative ? resolveSceneMaterialTree(representative.material) : null;
    context.closures = context.substrateClosures;
    context.substrateClosureCount = context.substrateClosures.length;
    context.materialRuntimeEnabled = frameEntries.length > 0;
    lastFrame = context;
    return context;
  }
  function uploadFrame(context) {
    for (const entry of context.substrateMaterials ?? []) {
      const { buffer, closures } = entry.result;
      if (entry.uploadedKey !== entry.key) {
      entry.uniforms.uSbMaterialBuffer.value = entry.texture.upload(buffer);
      entry.uniforms.uSbMaterialBufferSize.value.set(buffer.width, buffer.height);
      entry.uniforms.uSbClosureCount.value = closures.length;
      const weights = entry.uniforms.uSbRuntimeWeights.value;
      const layers = entry.uniforms.uSbRuntimeLayers.value;
      const coverage = entry.uniforms.uSbRuntimeCoverage.value;
      const parents = entry.uniforms.uSbRuntimeParents.value;
      weights.fill(0); layers.fill(0); coverage.fill(0); parents.fill(-1);
      closures.forEach((closure, slot) => {
        weights[slot] = closure.weight;
        const layer = closure.coveredBy;
        if (!layer) return;
        const topPrefix = `${layer.path}/0`;
        const parent = closures.findIndex(candidate => candidate.path === topPrefix || candidate.path.startsWith(topPrefix + '/'));
        if (parent < 0 || parent === slot) return;
        const color = layer.transmittanceColor ?? [1, 1, 1];
        layers.set([...color, layer.thickness ?? 0], slot * 4);
        coverage[slot] = layer.coverage ?? 1;
        parents[slot] = parent;
        weights[parent] = closures[parent].weight * coverage[slot];
      });
      entry.uploadedKey = entry.key;
      }
      entry.uniforms.uSbClosureCount.value = drawnClosures(entry).length;
      const thin = resolveMaterialThinTranslucency(entry.material.userData, thinTranslucencyProfile);
      entry.thinTranslucency = packThinTranslucencyPerSlot({ target: entry.uniforms[RUNTIME_THIN_TRANSLUCENCY_UNIFORM].value, closures: drawnClosures(entry), parents: entry.uniforms.uSbRuntimeParents.value, packed: thin.packed });
      entry.thinTranslucency.source = thin.source;
      entry.thinTranslucency.profileId = thin.profileId;
      synchronizeSlabMaps(entry, context.tier);
      entry.renderState = applyClosureRenderState(entry.material, {enabled:true,closures:drawnClosures(entry),weights:entry.uniforms.uSbRuntimeWeights.value,legacy:entry.legacyRenderState});
    }
    const selected = (context.substrateMaterials ?? []).find(entry => entry.id === selectedId) ?? context.substrateMaterials?.[0];
    telemetry?.closures?.({ owner: 'materialRuntime', closureCount: selected?.result.closures.length ?? 0, strideBytes: selected?.result.buffer.strideBytes ?? 0, byteLength: selected?.result.buffer.byteLength ?? 0, materialCount: context.substrateMaterials?.length ?? 0, source: 'scene-materials', textureReady: !!selected?.texture.current()?.isDataTexture });
    return context;
  }
  return {
    resolveFrame, uploadFrame, targets, forgetMaterial,
    setClosureLimit(count) {
      if (count !== null && (!Number.isInteger(count) || count < 1 || count > 3)) return {ok:false,reason:'Closure limit must be 1, 2, 3 or null (AUTO)'};
      closureLimit = count; return {ok:true,requested:count};
    },
    selectionKey() {
      ensureTarget();
      const material = sceneMaterials().find(candidate => idOf(candidate) === selectedId);
      return material ? `${material.uuid}|${JSON.stringify(resolveSceneMaterialTree(material))}` : null;
    },
    tree() {
      ensureTarget();
      const material = sceneMaterials().find(candidate => idOf(candidate) === selectedId);
      return material ? resolveSceneMaterialTree(material) : null;
    },
    target(id) {
      if (id === undefined) return ensureTarget();
      if (!targets().some(item => item.id === id)) return { ok: false, reason: 'Unknown scene material' };
      selectedId = id;
      return { ok: true, target: id };
    },
    applyAuthoredTree(root) {
      const normalized = normalizeMaterialTree(root);
      if (!normalized.ok) return {ok:false,problems:normalized.anomalies};
      const validation = validateAuthoringGraph(normalized.root);
      if (!validation.ok) return {ok:false,problems:validation.refusals};
      ensureTarget();
      const materials = sceneMaterials().filter(material => idOf(material) === selectedId);
      for (const material of materials) material.userData.sbAuthoredTree = normalized.root;
      return { ok: materials.length > 0, target: selectedId, materialCount: materials.length };
    },
    useSceneMaterial() {
      ensureTarget();
      for (const material of sceneMaterials()) if (idOf(material) === selectedId) delete material.userData.sbAuthoredTree;
      return { ok: true, target: selectedId };
    },
    override(name, active = true) {
      const index = RUNTIME_FEATURE_UNIFORMS.indexOf(name);
      if (index < 0) return { ok: false, reason: 'Unknown feature override' };
      ensureTarget();
      const selected = [...entries.values()].filter(entry => entry.id === selectedId);
      if (!selected.length) return { ok: false, reason: 'No scene material selected' };
      const value = readUniform(name);
      if (active && value === undefined) return { ok: false, reason: 'Feature uniform unavailable' };
      for (const entry of selected) {
        if (active) entry.uniforms[name + 'Input'].value = Array.isArray(value) ? [...value] : value?.clone?.() ?? value;
        entry.uniforms.uSbRuntimeOverrides.value[index] = active ? 1 : 0;
      }
      return { ok: true, name, active: !!active, target: selectedId };
    },
    clearOverrides() {
      ensureTarget();
      for (const entry of entries.values()) if (entry.id === selectedId) entry.uniforms.uSbRuntimeOverrides.value.fill(0);
    },
    setMaterialData(key, value) {
      if (typeof key !== 'string' || !key.startsWith('sb')) return { ok: false, reason: 'Material data keys must start with sb' };
      ensureTarget();
      const materials = sceneMaterials().filter(material => idOf(material) === selectedId);
      if (!materials.length) return { ok: false, reason: 'No scene material selected' };
      for (const material of materials) {
        if (value === undefined || value === null) delete material.userData[key];
        else material.userData[key] = value;
      }
      return { ok: true, key, target: selectedId, materialCount: materials.length };
    },
    readMaterialData(key) {
      ensureTarget();
      const material = sceneMaterials().find(candidate => idOf(candidate) === selectedId);
      return material ? material.userData[key] : undefined;
    },
    slabMapHosts() {
      return [...entries.values()].filter(entry => entry.enabled && entry.slabMaps?.bound.length > 0).map(entry => ({ id: entry.id, tier: entry.slabMaps.tier, slots: [...entry.slabMaps.bound], units: entry.slabMaps.units, ceiling: entry.slabMaps.ceiling, refusals: [...entry.slabMaps.refusals] }));
    },
    thinTranslucencyHosts() {
      return [...entries.values()].filter(entry => entry.enabled && entry.thinTranslucency?.applied.length > 0).map(entry => ({ id: entry.id, slots: [...entry.thinTranslucency.applied], coatSlots: [...entry.thinTranslucency.coatSlots], source: entry.thinTranslucency.source, profileId: entry.thinTranslucency.profileId }));
    },
    frame: () => lastFrame,
    subsurfaceHosts() {
      const hosts = [];
      for (const entry of entries.values()) {
        if (!entry.enabled) continue;
        const reach = subsurfaceReachOf(entry);
        if (reach[0] + reach[1] + reach[2] > 0) hosts.push({ material: entry.material, meanFreePathMillimeters: reach });
      }
      return hosts;
    },
    translucentHosts() {
      return [...entries.values()].filter(entry => entry.enabled && entry.material.transparent === true).map(entry => entry.material);
    },
    waterHosts() {
      return [...entries.values()].filter(entry => entry.enabled && drawnClosures(entry).some(closure => closure.kind === 'singleLayerWater')).map(entry => entry.material);
    },
    specializedHostCounts() {
      const counts = { hair: 0, eye: 0, singleLayerWater: 0, volume: 0, unlit: 0, slab: 0 };
      for (const entry of entries.values()) {
        if (!entry.enabled) continue;
        for (const closure of drawnClosures(entry)) counts[closure.kind in counts ? closure.kind : 'slab'] += 1;
      }
      return counts;
    },
    status: () => [...entries.values()].map(entry => ({ id: entry.id, enabled: entry.enabled, renderState:entry.renderState, authored: !!entry.material.userData.sbAuthoredTree, closures: entry.enabled ? drawnClosures(entry).length : 0, storedClosures: entry.result?.closures.length ?? 0, bytes: entry.result?.buffer?.byteLength ?? 0, textureReady: !!entry.texture.current()?.isDataTexture, uploads: entry.texture.uploads(), compilations: entry.compileCount, problems: entry.material.userData.__rswSbAuthoringError || entry.material.userData.__rswSbMaterialVeto ? [entry.material.userData.__rswSbAuthoringError || entry.material.userData.__rswSbMaterialVeto] : entry.result?.problems ?? [], simplified: entry.result?.simplification?.steps.length ?? 0 })),
    dispose() { for (const material of [...entries.keys()]) forgetMaterial(material); },
  };
}
