import { buildMsmUpsampleGlsl, MSM_UPSAMPLE_UNIFORMS } from '../lighting/megalightsSm/msmUpsampleGlsl.js';
import { buildNormalFromDepthGlsl, MSM_NORMAL_FROM_DEPTH_UNIFORMS } from '../lighting/megalightsSm/msmNormalFromDepthGlsl.js';
import { upsampleTapCountForTier, relativeDepthToleranceForTier } from '../lighting/megalightsSm/msmUpsampleTapBudgetCore.js';
export function buildMsmScreenResolveGlsl() {
  return ['#include <packing>',
    ...MSM_NORMAL_FROM_DEPTH_UNIFORMS.map(({ name, glslType }) => `uniform ${glslType} ${name};`),
    ...MSM_UPSAMPLE_UNIFORMS.filter(({ type }) => type !== 'sampler2D').map(({ name, type }) => `uniform ${type} ${name};`),
    '#define tMsmUpsampleSource tMsmIrradiance', buildNormalFromDepthGlsl(), buildMsmUpsampleGlsl({ storedDepth: true }),
    `vec3 msmResolveScreenColor(vec3 litColor, vec2 uv) {
      if (uMsmCompositeOn < 0.5) return litColor;
      float destinationDepth = msmViewDepthAt(uv);
      if (msmIsSkyViewDepth(destinationDepth)) return litColor;
      vec3 fallback = texture2D(tMsmIrradiance, msmScreenCompositeReducedUv(uv)).rgb;
      vec3 signal = msmUpsampleIrradiance(uv, destinationDepth, fallback);
      return litColor * msmScreenCompositeFactorOf(signal.rg);
    }`].join('\n');
}
export function createMsmScreenResolve({ THREE, uniforms, sceneUniforms }) {
  Object.assign(uniforms, sceneUniforms, {
    uMsmUpsampleSourceResolution: { value: new THREE.Vector2(1, 1) },
    uMsmUpsampleSourceTexel: { value: new THREE.Vector2(1, 1) },
    uMsmUpsampleTapCount: { value: 1 },
    uMsmUpsampleRelativeDepthTolerance: { value: 0.02 },
  });
  return {
    update({ tier, width, height }) {
      uniforms.uMsmUpsampleSourceResolution.value.set(width, height);
      uniforms.uMsmUpsampleSourceTexel.value.set(1 / width, 1 / height);
      uniforms.uMsmUpsampleTapCount.value = upsampleTapCountForTier(tier) || 1;
      uniforms.uMsmUpsampleRelativeDepthTolerance.value = relativeDepthToleranceForTier(tier) || 0.02;
    },
    describe: () => ({ phase: 'MSM-F23', tapCount: uniforms.uMsmUpsampleTapCount.value,
      depthSource: 'signal-alpha', destinationDepth: 'shared-depth', newMaterialSamplers: 0 }),
  };
}
