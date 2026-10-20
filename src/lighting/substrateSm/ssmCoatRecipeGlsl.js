import { SSM_COAT_BSDF_GLSL } from './ssmCoatBsdfGlsl.js';
import { SSM_COAT_UNIFORM_VECTOR_COUNT } from './ssmCoatContract.js';
import { getSubstrateSmRecipeFieldExpression } from './ssmRecipeLayoutGlsl.js';

const field = (name) => getSubstrateSmRecipeFieldExpression(name, SSM_COAT_UNIFORM_VECTOR_COUNT);

export const SSM_COAT_RECIPE_GLSL = `${SSM_COAT_BSDF_GLSL}
#ifndef SSM_COAT_RECIPE_V1
#define SSM_COAT_RECIPE_V1

SsmBsdfResult ssmEvaluateCoatRecipeWithBase(
  vec3 diffuseReflectance, vec3 specularF0, float perceptualRoughness,
  vec3 normal, vec3 viewDirection, vec3 lightDirection
) {
  return ssmEvaluateCoatBsdf(
    diffuseReflectance, specularF0, ${field('specularF90')}, perceptualRoughness,
    ${field('coverage')}, ${field('extinctionCoefficient')}, ${field('layerThickness')},
    ${field('extensionWeight')}, ${field('extensionRoughness')},
    normal, viewDirection, lightDirection
  );
}

SsmBsdfResult ssmEvaluateCoatRecipe(vec3 normal, vec3 viewDirection, vec3 lightDirection) {
  return ssmEvaluateCoatRecipeWithBase(
    ${field('diffuseReflectance')}, ${field('specularF0')}, ${field('perceptualRoughness')},
    normal, viewDirection, lightDirection
  );
}

vec3 ssmEvaluateCoatRecipeEmission(vec3 emissiveRadiance, vec3 normal, vec3 viewDirection) {
  return emissiveRadiance * ssmCoatEmissionTransmission(
    ${field('extinctionCoefficient')}, ${field('layerThickness')},
    ${field('coverage')} * ${field('extensionWeight')},
    clamp(dot(normal, viewDirection), 0.0, 1.0)
  );
}

#endif
`;
