import { SSM_ANISOTROPY_ASPECT_FACTOR } from './ssmAnisotropyCore.js';
import {
  SSM_BSDF_MINIMUM_ROUGHNESS,
  SSM_BSDF_MINIMUM_DENOMINATOR,
  SSM_BSDF_MINIMUM_HALF_LENGTH_SQUARED,
} from './ssmBsdfNumerics.js';
import { SSM_TANGENT_ORTHONORMAL_TOLERANCE } from './ssmTangentMath.js';

export const SSM_ANISOTROPY_GLSL = `
#ifndef SSM_ANISOTROPIC_BSDF_V1
#define SSM_ANISOTROPIC_BSDF_V1

SsmBsdfResult ssmEvaluateAnisotropicBsdf(
  vec3 diffuseReflectance, vec3 specularF0, float specularF90, float perceptualRoughness,
  float anisotropy, vec3 normal, vec3 viewDirection, vec3 lightDirection, SsmTangentFrame frame
) {
  if (anisotropy == 0.0 || !frame.valid ||
      !(abs(anisotropy) <= 1.0) ||
      !(abs(dot(frame.normal, normal) - 1.0) <= ${SSM_TANGENT_ORTHONORMAL_TOLERANCE})) {
    return ssmEvaluateBaseBsdf(diffuseReflectance, specularF0, specularF90, perceptualRoughness,
      normal, viewDirection, lightDirection);
  }
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
  float roughness = max(perceptualRoughness, ${SSM_BSDF_MINIMUM_ROUGHNESS});
  float alpha = roughness * roughness;
  float aspect = sqrt(1.0 - ${SSM_ANISOTROPY_ASPECT_FACTOR} * abs(anisotropy));
  vec2 widths = vec2(min(1.0, alpha / aspect), alpha * aspect);
  if (anisotropy < 0.0) widths = widths.yx;
  vec2 scaledHalf = vec2(dot(frame.tangent, halfDirection), dot(frame.bitangent, halfDirection)) / widths;
  float distributionShape = dot(scaledHalf, scaledHalf) + normalHalf * normalHalf;
  float distribution = 0.3183098861837907 / (widths.x * widths.y * distributionShape * distributionShape);
  float stretchedView = length(vec3(widths.x * dot(frame.tangent, viewDirection),
    widths.y * dot(frame.bitangent, viewDirection), normalView));
  float stretchedLight = length(vec3(widths.x * dot(frame.tangent, lightDirection),
    widths.y * dot(frame.bitangent, lightDirection), normalLight));
  float visibility = 0.5 / max(normalLight * stretchedView + normalView * stretchedLight, ${SSM_BSDF_MINIMUM_DENOMINATOR});
  vec3 viewTransmission = vec3(1.0) - ssmSchlickFresnel(specularF0, specularF90, normalView);
  vec3 lightTransmission = vec3(1.0) - ssmSchlickFresnel(specularF0, specularF90, normalLight);
  result.diffuse = diffuseReflectance * viewTransmission * lightTransmission * 0.3183098861837907;
  result.specular = ssmSchlickFresnel(specularF0, specularF90, viewHalf) * (distribution * visibility);
  return result;
}

#endif
`;
