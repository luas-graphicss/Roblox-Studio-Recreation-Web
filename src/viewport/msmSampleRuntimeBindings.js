import { createMsmProxySceneFeed } from './msmProxySceneFeed.js';
import { planMsmOverflowAnchors } from '../lighting/megalightsSm/msmOverflowSamplingCore.js';
import { specularRunsOnTier } from '../lighting/megalightsSm/msmSpecularTierPolicyCore.js';

export function createMsmSampleRuntimeBindings(dependencies) {
  const { uniforms } = dependencies;
  const proxies = createMsmProxySceneFeed(dependencies);
  const previousEnergy = new Map();
  let renderedFrames = 0, freshAt = 0, freshIndex = -1;
  let atlasBound = false;
  let overflowPlan = { recordSlotCount: 0, anchors: [] };
  function applyState(state, records) {
    const options = state.options || {};
    const atlas = state.atlas;
    atlasBound = options.atlas !== false && !!(atlas?.on && atlas.tex && atlas.metaTex);
    uniforms.uMsmAtlasOn.value = atlasBound ? 1 : 0;
    uniforms.uMsmAtlasTex.value = atlas?.tex || null;
    uniforms.uMsmAtlasMeta.value = atlas?.metaTex || null;
    uniforms.uMsmAtlasBias.value = Number.isFinite(atlas?.bias) ? atlas.bias : 0.001;
    const collected = proxies.update({ tier: state.tier,
      enabled: options.proxy !== false && state.quality?.runsProxyOcclusion !== false,
      dirty: state.geometryDirty !== false, override: state.proxyCandidates });
    uniforms.uMsmProxyOn.value = collected.filledSlotCount > 0 ? 1 : 0;
    for (let index = 0; index < collected.boxes.length; index += 1) {
      const box = collected.boxes[index];
      uniforms.uMsmProxyBoxCenter.value[index].set(...box.center, index < collected.filledSlotCount ? box.strength : 0);
      uniforms.uMsmProxyBoxHalfExtent.value[index].set(...box.halfExtent);
    }
    uniforms.uMsmScreenTraceOn.value = options.screenTrace === false ? 0 : 1;
    uniforms.uMsmFairnessOn.value = options.fairness === false ? 0 : 1;
    uniforms.uMsmSpecularEnabled.value = options.specular !== false && state.mode !== 'B' && specularRunsOnTier(state.tier) ? 1 : 0;
    uniforms.uMsmSpecularRoughness.value = Number.isFinite(state.specularRoughness) ? state.specularRoughness : 0.5;
    uniforms.uMsmSpecularStrength.value = Number.isFinite(state.specularStrength) ? state.specularStrength : 0.2;
    let bestEnergy = -1, nextFreshIndex = -1;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record) continue;
      const old = previousEnergy.get(record.lightKey);
      if ((old === undefined || record.luminance > old * 1.25) && record.luminance > bestEnergy) {
        bestEnergy = record.luminance; nextFreshIndex = index;
      }
    }
    previousEnergy.clear();
    for (const record of records) if (record) previousEnergy.set(record.lightKey, record.luminance);
    if (nextFreshIndex >= 0) { freshIndex = nextFreshIndex; freshAt = renderedFrames; }
    uniforms.uMsmFreshLightIndex.value = freshIndex;
    const freshAnchor = renderedFrames - freshAt < 4 ? freshIndex : -1;
    overflowPlan = planMsmOverflowAnchors(records, uniforms.uMsmCandidateCount.value, freshAnchor);
    uniforms.uMsmRecordSlotCount.value = overflowPlan.recordSlotCount;
    uniforms.uMsmOverflowAnchorCount.value = overflowPlan.anchors.length;
    uniforms.uMsmOverflowAnchors.value.set(overflowPlan.anchors[0] ?? -1, overflowPlan.anchors[1] ?? -1,
      overflowPlan.anchors[2] ?? -1, overflowPlan.anchors[3] ?? -1);
  }
  function beginFrame(index, divisor, width, height) {
    uniforms.uMsmFrameIndex.value = index;
    uniforms.uMsmSampleDivisor.value = divisor;
    uniforms.uMsmFullResolution.value.set(width, height);
    uniforms.uMsmFreshLightAge.value = renderedFrames - freshAt;
    renderedFrames += 1;
  }
  return { applyState, beginFrame,
    describe: () => ({ atlasBound, proxies: proxies.describe(),
      overflowSampling: { trigger: 'saturated-cell', recordSlotCount: overflowPlan.recordSlotCount,
        anchors: overflowPlan.anchors.slice(), extraTextureUnits: 0 },
      fairness: uniforms.uMsmFairnessOn.value === 1, patternDivisor: uniforms.uMsmSampleDivisor.value,
      freshLightIndex: freshIndex, specular: uniforms.uMsmSpecularEnabled.value === 1 }) };
}
