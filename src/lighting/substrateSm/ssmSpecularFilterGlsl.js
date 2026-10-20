import { SSM_BSDF_MINIMUM_ROUGHNESS } from './ssmBsdfNumerics.js';

export const SSM_SPECULAR_FILTER_GLSL = `
#ifndef SSM_SPECULAR_FILTER_V1
#define SSM_SPECULAR_FILTER_V1

float ssmFilterPerceptualRoughness(
  float perceptualRoughness,
  float geometryRoughness,
  float normalVariance,
  float strength,
  float kernel,
  float enabled
) {
  float roughness = min(max(perceptualRoughness, ${SSM_BSDF_MINIMUM_ROUGHNESS}) + max(geometryRoughness, 0.0), 1.0);
  float addedVariance = min(2.0 * max(strength, 0.0) * max(normalVariance, 0.0), clamp(kernel, 0.0, 1.0));
  if (enabled <= 0.0 || addedVariance <= 0.0) return roughness;
  float alpha = roughness * roughness;
  float filteredRoughness = min(sqrt(sqrt(alpha * alpha + addedVariance)), 1.0);
  return mix(roughness, filteredRoughness, clamp(enabled, 0.0, 1.0));
}

#endif
`;
