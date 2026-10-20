import { getSubstrateSmRecipeFieldExpression } from './ssmRecipeLayoutGlsl.js';
import { SSM_FOLIAGE_RECIPE_FIELDS, SSM_FOLIAGE_UNIFORM_VECTOR_COUNT } from './ssmFoliageContract.js';
import { SSM_FOLIAGE_GLSL } from './ssmFoliageGlsl.js';

const field = (name) => getSubstrateSmRecipeFieldExpression(name, SSM_FOLIAGE_UNIFORM_VECTOR_COUNT);

export const SSM_FOLIAGE_RECIPE_GLSL = `${SSM_FOLIAGE_GLSL}
#ifndef SSM_FOLIAGE_RECIPE_V1
#define SSM_FOLIAGE_RECIPE_V1

SsmFoliageContribution ssmEvaluateFoliageRecipeContributionWithBase(
  vec3 diffuseReflectance, vec3 specularF0, float perceptualRoughness,
  vec3 normal, vec3 viewDirection, vec3 lightDirection,
  vec3 visibleRadiance, vec3 transmissionRadiance
) {
  return ssmEvaluateFoliageContribution(
    diffuseReflectance, specularF0, ${field('specularF90')}, perceptualRoughness,
    ${field(SSM_FOLIAGE_RECIPE_FIELDS.wrap)}, ${field(SSM_FOLIAGE_RECIPE_FIELDS.transmissionWeight)},
    ${field(SSM_FOLIAGE_RECIPE_FIELDS.transmissionTint)}, ${field(SSM_FOLIAGE_RECIPE_FIELDS.forwardRoughness)},
    normal, viewDirection, lightDirection, visibleRadiance, transmissionRadiance
  );
}

SsmFoliageContribution ssmEvaluateFoliageRecipeContribution(
  vec3 normal, vec3 viewDirection, vec3 lightDirection, vec3 visibleRadiance, vec3 transmissionRadiance
) {
  return ssmEvaluateFoliageRecipeContributionWithBase(
    ${field('diffuseReflectance')}, ${field('specularF0')}, ${field('perceptualRoughness')},
    normal, viewDirection, lightDirection, visibleRadiance, transmissionRadiance
  );
}

SsmFoliageContribution ssmEvaluateFoliageRecipeContributionFallback(
  vec3 normal, vec3 viewDirection, vec3 lightDirection, vec3 visibleRadiance
) {
  return ssmEvaluateFoliageRecipeContribution(normal, viewDirection, lightDirection, visibleRadiance, visibleRadiance);
}

#endif
`;
