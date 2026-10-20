import { buildCompositeInjectionApplyGlsl } from '../../lighting/megalightsSm/msmCompositeInjectionGlsl.js';
import { buildMsmForwardSpecularApply } from '../msmForwardSpecular.js';

export const SSM_MSM_DIFFUSE_APPLY_GLSL = `
  vec3 ssmMsmVisibleIrradiance = msmInjectionIrradiance(vMsmInjectionWorldPosition);
  reflectedLight.indirectDiffuse += ssmMsmVisibleIrradiance
    * ssmResolvedSurface.diffuseReflectance * RECIPROCAL_PI;
`;

export function rewriteSubstrateSmMsmInjection(fragmentShader, mode) {
  if (typeof fragmentShader !== 'string') {
    return { ok: false, source: fragmentShader, code: 'SSM_MSM_SHADER_REQUIRED' };
  }
  if (mode === 'OFF') {
    return fragmentShader.includes('uMsmInjectionOn')
      ? { ok: false, source: fragmentShader, code: 'SSM_MSM_OFF_HAS_INJECTION' }
      : { ok: true, source: fragmentShader, code: null, replacedInjection: false };
  }
  if (mode !== 'B') return { ok: false, source: fragmentShader, code: 'SSM_MSM_MODE_UNSUPPORTED' };
  const sources = [buildCompositeInjectionApplyGlsl(), buildMsmForwardSpecularApply()];
  const matches = sources.map(source => ({ source, count: fragmentShader.split(source).length - 1 }));
  if (matches.reduce((sum, entry) => sum + entry.count, 0) !== 1) {
    return { ok: false, source: fragmentShader, code: 'SSM_MSM_INJECTION_ANCHOR_MISMATCH' };
  }
  const match = matches.find(entry => entry.count === 1);
  const source = fragmentShader.replace(match.source, SSM_MSM_DIFFUSE_APPLY_GLSL);
  return { ok: true, source, code: null, replacedInjection: true };
}
