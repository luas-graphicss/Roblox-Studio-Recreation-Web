import {
  SSM_BSDF_MINIMUM_ROUGHNESS,
  SSM_BSDF_MINIMUM_DENOMINATOR,
  SSM_BSDF_MINIMUM_HALF_LENGTH_SQUARED,
} from './ssmBsdfNumerics.js';

export const SSM_BSDF_GLSL = `
#ifndef SSM_BASE_BSDF_V1
#define SSM_BASE_BSDF_V1

struct SsmBsdfResult {
  vec3 diffuse;
  vec3 specular;
};

float ssmFifthPower(float value) {
  float squared = value * value;
  return squared * squared * value;
}

vec3 ssmSchlickFresnel(vec3 specularF0, float specularF90, float cosine) {
  return specularF0 + (vec3(specularF90) - specularF0) * ssmFifthPower(1.0 - cosine);
}

SsmBsdfResult ssmEvaluateBaseBsdf(
  vec3 diffuseReflectance,
  vec3 specularF0,
  float specularF90,
  float perceptualRoughness,
  vec3 normal,
  vec3 viewDirection,
  vec3 lightDirection
) {
  SsmBsdfResult result;
  result.diffuse = vec3(0.0);
  result.specular = vec3(0.0);
  float normalView = clamp(dot(normal, viewDirection), 0.0, 1.0);
  float normalLight = clamp(dot(normal, lightDirection), 0.0, 1.0);
  if (normalView <= 0.0 || normalLight <= 0.0) return result;

  vec3 halfSum = viewDirection + lightDirection;
  float halfLengthSquared = dot(halfSum, halfSum);
  if (halfLengthSquared <= ${SSM_BSDF_MINIMUM_HALF_LENGTH_SQUARED}) return result;
  vec3 halfDirection = halfSum * inversesqrt(halfLengthSquared);
  float normalHalf = clamp(dot(normal, halfDirection), 0.0, 1.0);
  float viewHalf = clamp(dot(viewDirection, halfDirection), 0.0, 1.0);
  vec3 normalCrossHalf = cross(normal, halfDirection);
  float halfSineSquared = dot(normalCrossHalf, normalCrossHalf);
  float roughness = max(perceptualRoughness, ${SSM_BSDF_MINIMUM_ROUGHNESS});
  float alpha = roughness * roughness;
  float alphaSquared = alpha * alpha;
  float distributionDenominator = halfSineSquared + alphaSquared * normalHalf * normalHalf;
  float distribution = 0.3183098861837907 * alphaSquared /
    (distributionDenominator * distributionDenominator);
  float maskingView = normalLight * sqrt(alphaSquared + (1.0 - alphaSquared) * normalView * normalView);
  float maskingLight = normalView * sqrt(alphaSquared + (1.0 - alphaSquared) * normalLight * normalLight);
  float visibility = 0.5 / max(maskingView + maskingLight, ${SSM_BSDF_MINIMUM_DENOMINATOR});
  vec3 halfFresnel = ssmSchlickFresnel(specularF0, specularF90, viewHalf);
  vec3 viewTransmission = vec3(1.0) - ssmSchlickFresnel(specularF0, specularF90, normalView);
  vec3 lightTransmission = vec3(1.0) - ssmSchlickFresnel(specularF0, specularF90, normalLight);
  result.diffuse = diffuseReflectance * viewTransmission * lightTransmission * 0.3183098861837907;
  result.specular = halfFresnel * (distribution * visibility);
  return result;
}

#endif
`;
