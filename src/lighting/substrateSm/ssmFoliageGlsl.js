import { SSM_BSDF_GLSL } from './ssmBsdfGlsl.js';
import { SSM_FOLIAGE_MAXIMUM_PHASE } from './ssmFoliageContract.js';

export const SSM_FOLIAGE_GLSL = `${SSM_BSDF_GLSL}
#ifndef SSM_FOLIAGE_BSDF_V1
#define SSM_FOLIAGE_BSDF_V1

struct SsmFoliageContribution {
  vec3 diffuse;
  vec3 specular;
  vec3 transmission;
};

float ssmFoliageForwardPhase(float extensionRoughness) {
  return clamp(1.0 - extensionRoughness, 0.0, ${SSM_FOLIAGE_MAXIMUM_PHASE});
}

float ssmFoliageWrappedCosine(float normalLight, float wrap) {
  return clamp((normalLight + wrap) / (1.0 + wrap), 0.0, 1.0);
}

float ssmFoliagePhase(float cosine, float phase) {
  float denominator = 1.0 + phase * phase - 2.0 * phase * cosine;
  return (1.0 - phase * phase) * 0.07957747154594767 / (denominator * sqrt(denominator));
}

float ssmFoliageTransmissionShape(float cosine, float phase) {
  return (1.0 - phase) * 0.3183098861837907 + phase * ssmFoliagePhase(cosine, phase);
}

SsmFoliageContribution ssmEvaluateFoliageContribution(
  vec3 diffuseReflectance, vec3 specularF0, float specularF90, float perceptualRoughness,
  float diffuseWrap, float thinTransmissionWeight, vec3 transmissionTint, float forwardRoughness,
  vec3 normal, vec3 viewDirection, vec3 lightDirection,
  vec3 visibleRadiance, vec3 transmissionRadiance
) {
  SsmFoliageContribution result;
  result.diffuse = vec3(0.0);
  result.specular = vec3(0.0);
  result.transmission = vec3(0.0);
  float normalView = clamp(dot(normal, viewDirection), 0.0, 1.0);
  if (normalView <= 0.0) return result;
  float normalLight = dot(normal, lightDirection);
  float frontCosine = clamp(normalLight, 0.0, 1.0);
  float backCosine = clamp(-normalLight, 0.0, 1.0);
  float wrappedCosine = ssmFoliageWrappedCosine(normalLight, diffuseWrap);
  vec3 viewTransmission = vec3(1.0) - ssmSchlickFresnel(specularF0, specularF90, normalView);
  vec3 lightTransmission = vec3(1.0) - ssmSchlickFresnel(specularF0, specularF90, wrappedCosine);
  result.diffuse = diffuseReflectance * viewTransmission * lightTransmission *
    (wrappedCosine * 0.3183098861837907 / (1.0 + diffuseWrap)) * visibleRadiance;
  if (frontCosine > 0.0) {
    SsmBsdfResult base = ssmEvaluateBaseBsdf(diffuseReflectance, specularF0, specularF90,
      perceptualRoughness, normal, viewDirection, lightDirection);
    result.specular = base.specular * (frontCosine * visibleRadiance);
  }
  if (thinTransmissionWeight > 0.0 && backCosine > 0.0) {
    float phase = ssmFoliageForwardPhase(forwardRoughness);
    float shape = ssmFoliageTransmissionShape(-dot(lightDirection, viewDirection), phase);
    result.transmission = transmissionTint * (thinTransmissionWeight * backCosine * shape) * transmissionRadiance;
  }
  return result;
}

#endif
`;
