import { SSM_BSDF_GLSL } from './ssmBsdfGlsl.js';
import { SSM_COAT_TRANSMISSION_GLSL } from './ssmCoatTransmissionGlsl.js';
import { SSM_COAT_F0, SSM_COAT_F90 } from './ssmCoatContract.js';

export const SSM_COAT_BSDF_GLSL = `${SSM_BSDF_GLSL}
${SSM_COAT_TRANSMISSION_GLSL}
#ifndef SSM_COAT_BSDF_V1
#define SSM_COAT_BSDF_V1

SsmBsdfResult ssmEvaluateCoatBsdf(
  vec3 diffuseReflectance,
  vec3 specularF0,
  float specularF90,
  float perceptualRoughness,
  float coverage,
  vec3 extinctionCoefficient,
  float layerThickness,
  float extensionWeight,
  float extensionRoughness,
  vec3 normal,
  vec3 viewDirection,
  vec3 lightDirection
) {
  SsmBsdfResult result = ssmEvaluateBaseBsdf(
    diffuseReflectance, specularF0, specularF90, perceptualRoughness,
    normal, viewDirection, lightDirection
  );
  float effectiveCoverage = coverage * extensionWeight;
  if (effectiveCoverage <= 0.0) return result;
  float normalView = clamp(dot(normal, viewDirection), 0.0, 1.0);
  float normalLight = clamp(dot(normal, lightDirection), 0.0, 1.0);
  vec3 transmission = ssmCoatBaseTransmission(
    extinctionCoefficient, layerThickness, effectiveCoverage, normalLight, normalView
  );
  SsmBsdfResult coat = ssmEvaluateBaseBsdf(
    vec3(0.0), vec3(${SSM_COAT_F0}), ${SSM_COAT_F90.toFixed(1)}, extensionRoughness,
    normal, viewDirection, lightDirection
  );
  result.diffuse *= transmission;
  result.specular = result.specular * transmission + effectiveCoverage * coat.specular;
  return result;
}

#endif
`;
