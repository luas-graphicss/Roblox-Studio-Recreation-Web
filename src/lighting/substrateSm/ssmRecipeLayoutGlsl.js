import { SSM_RECIPE_FIELDS, SSM_RECIPE_VECTOR_COUNT } from './ssmRecipeLayout.js';

export const SSM_RECIPE_UNIFORM_NAME = 'uSsmRecipe';
const SSM_COMPONENT_SWIZZLES = 'xyzw';

export function buildSubstrateSmRecipeUniformDeclarations(vectorCount = SSM_RECIPE_VECTOR_COUNT) {
  if (!Number.isSafeInteger(vectorCount) || vectorCount < 1 || vectorCount > SSM_RECIPE_VECTOR_COUNT) {
    throw new RangeError('SSM uniform declaration requires one to eight vectors');
  }
  return `uniform vec4 ${SSM_RECIPE_UNIFORM_NAME}[${vectorCount}];`;
}

export function getSubstrateSmRecipeFieldExpression(fieldName, vectorCount = SSM_RECIPE_VECTOR_COUNT) {
  if (!Object.hasOwn(SSM_RECIPE_FIELDS, fieldName)) throw new TypeError('Unknown SSM recipe field');
  const field = SSM_RECIPE_FIELDS[fieldName];
  const vectorIndex = Math.floor(field.offset / 4);
  if (!Number.isSafeInteger(vectorCount) || vectorCount < 1 || vectorCount > SSM_RECIPE_VECTOR_COUNT
    || vectorIndex >= vectorCount) throw new RangeError('SSM field is outside the declared uniform prefix');
  const firstComponent = field.offset % 4;
  const swizzle = SSM_COMPONENT_SWIZZLES.slice(firstComponent, firstComponent + field.components);
  return `${SSM_RECIPE_UNIFORM_NAME}[${vectorIndex}].${swizzle}`;
}
