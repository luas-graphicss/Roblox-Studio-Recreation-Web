import { buildSpecularBoostGlsl } from '../lighting/megalightsSm/msmSpecularBoostGlsl.js';
import { specularRunsOnTier } from '../lighting/megalightsSm/msmSpecularTierPolicyCore.js';
export function buildMsmForwardSpecularDeclarations() {
  return ['uniform float uMsmForwardSpecularOn;', 'uniform vec3 uMsmForwardRepresentativePosition;',
    buildSpecularBoostGlsl()].join('\n');
}
export function buildMsmForwardSpecularApply() {
  return `
  vec3 msmInjectedIrradiance = msmInjectionIrradiance(vMsmInjectionWorldPosition);
  reflectedLight.indirectDiffuse += msmInjectedIrradiance * BRDF_Lambert(material.diffuseColor);
                                                                           
  #if defined(STANDARD) || defined(PHONG)
    vec3 msmWorldNormal = inverseTransformDirection(normal, viewMatrix);
    vec3 msmToLight = normalize(uMsmForwardRepresentativePosition - vMsmInjectionWorldPosition);
    vec3 msmToView = normalize(cameraPosition - vMsmInjectionWorldPosition);
    vec3 msmHalfVector = normalize(msmToLight + msmToView);
    #ifdef STANDARD
      float msmRoughness = material.roughness;
    #else
      float msmRoughness = pow(2.0 / (material.specularShininess + 2.0), 0.25);
    #endif
    float msmSpecularWeight = msmSpecularBoostFromScalars(dot(msmWorldNormal, msmHalfVector),
      dot(msmToView, msmHalfVector), dot(msmWorldNormal, msmToView), dot(msmWorldNormal, msmToLight),
      msmRoughness, 0.0, uMsmForwardSpecularOn);
    reflectedLight.indirectSpecular += msmInjectedIrradiance * material.specularColor
      * (msmSpecularWeight / MSM_DIELECTRIC_NORMAL_REFLECTANCE) * RECIPROCAL_PI;
  #endif`;
}
export function resolveMsmForwardSpecular({ tier, enabled, lights, target }) {
  let energySum = 0;
  target.set(0, 0, 0);
  for (const light of lights) {
    const color = light.color;
    const energy = Math.max(0, Number(light.intensity) || 0) *
      (0.2126 * (color?.r ?? 1) + 0.7152 * (color?.g ?? 1) + 0.0722 * (color?.b ?? 1));
    if (!(energy > 0) || !light.position) continue;
    target.addScaledVector(light.position, energy); energySum += energy;
  }
  if (energySum > 0) target.multiplyScalar(1 / energySum);
  return enabled !== false && energySum > 0 && specularRunsOnTier(tier);
}
