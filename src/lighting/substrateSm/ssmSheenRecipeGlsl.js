import { getSubstrateSmRecipeFieldExpression } from './ssmRecipeLayoutGlsl.js';
import { SSM_SHEEN_RECIPE_FIELDS, SSM_SHEEN_UNIFORM_VECTOR_COUNT } from './ssmSheenContract.js';
import { SSM_SHEEN_GLSL } from './ssmSheenGlsl.js';

const field = (name) => getSubstrateSmRecipeFieldExpression(name, SSM_SHEEN_UNIFORM_VECTOR_COUNT);

export const SSM_SHEEN_RECIPE_GLSL = `${SSM_SHEEN_GLSL}
#ifndef SSM_SHEEN_RECIPE_V1
#define SSM_SHEEN_RECIPE_V1

SsmBsdfResult ssmEvaluateSheenRecipeWithBase(
  vec3 diffuseReflectance, vec3 specularF0, float perceptualRoughness,
  vec3 normal, vec3 viewDirection, vec3 lightDirection
) {
  return ssmEvaluateSheenBsdf(
    diffuseReflectance, specularF0, ${field('specularF90')}, perceptualRoughness,
    ${field(SSM_SHEEN_RECIPE_FIELDS.amount)}, ${field(SSM_SHEEN_RECIPE_FIELDS.roughness)},
    ${field(SSM_SHEEN_RECIPE_FIELDS.tint)},
    normal, viewDirection, lightDirection
  );
}

SsmBsdfResult ssmEvaluateSheenRecipe(vec3 normal, vec3 viewDirection, vec3 lightDirection) {
  return ssmEvaluateSheenRecipeWithBase(
    ${field('diffuseReflectance')}, ${field('specularF0')}, ${field('perceptualRoughness')},
    normal, viewDirection, lightDirection
  );
}

#endif
`;
