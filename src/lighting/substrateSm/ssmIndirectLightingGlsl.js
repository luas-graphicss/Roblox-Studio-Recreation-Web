import { SSM_BSDF_GLSL } from './ssmBsdfGlsl.js';
import { SSM_BSDF_MINIMUM_ROUGHNESS } from './ssmBsdfNumerics.js';
import { SSM_INDIRECT_MINIMUM_DENOMINATOR } from './ssmIndirectLightingCore.js';

export const SSM_INDIRECT_LIGHTING_MARKER = 'SSM_INDIRECT_LIGHTING_V1';

export const SSM_INDIRECT_LIGHTING_GLSL = `${SSM_BSDF_GLSL}
#ifndef SSM_INDIRECT_LIGHTING_V1
#define SSM_INDIRECT_LIGHTING_V1

struct SsmIndirectSurface {
  vec3 diffuseReflectance;
  vec3 specularF0;
  float specularF90;
  float reflectionRoughness;
};

struct SsmIndirectResponse {
  vec3 diffuseReflectance;
  vec3 singleScattering;
  vec3 multipleScattering;
};

SsmIndirectResponse ssmEvaluateIndirectResponse(SsmIndirectSurface surface, float normalView) {
  SsmIndirectResponse response;
  float roughness = max(surface.reflectionRoughness, ${SSM_BSDF_MINIMUM_ROUGHNESS});
  vec4 coefficients = roughness * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
  float fittedAmplitude = min(coefficients.x * coefficients.x, exp2(-9.28 * normalView)) * coefficients.x + coefficients.y;
  vec2 fittedResponse = vec2(-1.04, 1.04) * fittedAmplitude + coefficients.zw;
  float missingEnergy = 1.0 - clamp(fittedResponse.x + fittedResponse.y, 0.0, 1.0);
  vec3 averageFresnel = surface.specularF0 + (vec3(surface.specularF90) - surface.specularF0) / 21.0;
  vec3 viewTransmission = vec3(1.0) - ssmSchlickFresnel(surface.specularF0, surface.specularF90, normalView);
  response.singleScattering = clamp(surface.specularF0 * fittedResponse.x + vec3(surface.specularF90 * fittedResponse.y), 0.0, 1.0);
  response.multipleScattering = min(vec3(1.0) - response.singleScattering,
    response.singleScattering * averageFresnel * missingEnergy /
    max(vec3(1.0) - missingEnergy * averageFresnel, vec3(${SSM_INDIRECT_MINIMUM_DENOMINATOR})));
  response.diffuseReflectance = max(vec3(0.0), min(
    surface.diffuseReflectance * viewTransmission * (vec3(1.0) - averageFresnel),
    vec3(1.0) - response.singleScattering - response.multipleScattering));
  return response;
}

#endif
`;
