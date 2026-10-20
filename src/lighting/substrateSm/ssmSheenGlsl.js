import { SSM_BSDF_GLSL } from './ssmBsdfGlsl.js';
import {
  SSM_SHEEN_MINIMUM_EXPONENT,
  SSM_SHEEN_MAXIMUM_EXPONENT,
} from './ssmSheenContract.js';

export const SSM_SHEEN_GLSL = `${SSM_BSDF_GLSL}
#ifndef SSM_SHEEN_BSDF_V1
#define SSM_SHEEN_BSDF_V1

float ssmSheenExponent(float fuzzRoughness) {
  return ${SSM_SHEEN_MAXIMUM_EXPONENT}.0 -
    ${SSM_SHEEN_MAXIMUM_EXPONENT - SSM_SHEEN_MINIMUM_EXPONENT}.0 * clamp(fuzzRoughness, 0.0, 1.0);
}

float ssmSheenGrazing(float cosine, float exponent) {
  return pow(max(1.0 - clamp(cosine, 0.0, 1.0), 0.0), exponent);
}

float ssmSheenNormalization(float exponent) {
  return (exponent + 1.0) * (exponent + 2.0) * 0.15915494309189535;
}

SsmBsdfResult ssmEvaluateSheenBsdf(
  vec3 diffuseReflectance, vec3 specularF0, float specularF90, float perceptualRoughness,
  float fuzzAmount, float fuzzRoughness, vec3 fuzzTint,
  vec3 normal, vec3 viewDirection, vec3 lightDirection
) {
  SsmBsdfResult result = ssmEvaluateBaseBsdf(diffuseReflectance, specularF0, specularF90,
    perceptualRoughness, normal, viewDirection, lightDirection);
  if (fuzzAmount <= 0.0) return result;
  float normalView = clamp(dot(normal, viewDirection), 0.0, 1.0);
  float normalLight = clamp(dot(normal, lightDirection), 0.0, 1.0);
  if (normalView <= 0.0 || normalLight <= 0.0) return result;
  float exponent = ssmSheenExponent(fuzzRoughness);
  float grazingView = ssmSheenGrazing(normalView, exponent);
  float grazingLight = ssmSheenGrazing(normalLight, exponent);
  float remaining = (1.0 - fuzzAmount * grazingView) * (1.0 - fuzzAmount * grazingLight);
  float fiber = fuzzAmount * grazingView * grazingLight * ssmSheenNormalization(exponent);
  result.diffuse *= remaining;
  result.specular = result.specular * remaining + fuzzTint * fiber;
  return result;
}

#endif
`;
