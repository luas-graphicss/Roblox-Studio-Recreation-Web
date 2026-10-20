import { getSubstrateSmRecipeFieldExpression } from './ssmRecipeLayoutGlsl.js';

export const SSM_LIGHTING_SURFACE_FIELDS = Object.freeze([
  'diffuseReflectance', 'specularF0', 'specularF90', 'perceptualRoughness',
]);

export const SSM_LIGHTING_SURFACE_GLSL = `
struct SsmResolvedSurface {
  vec3 diffuseReflectance;
  vec3 specularF0;
  float specularF90;
  float perceptualRoughness;
};
SsmResolvedSurface ssmResolvedSurface;
`;

const RESOLVED_VALUE_EXPRESSION = /^[A-Za-z_]\w*(?:\[\d+\])?(?:\.[A-Za-z_]\w*(?:\[\d+\])?)*$/;

export function getSubstrateSmLightingRecipeBinding(vectorCount = 7) {
  return Object.freeze(Object.fromEntries(SSM_LIGHTING_SURFACE_FIELDS.map(field => [
    field, getSubstrateSmRecipeFieldExpression(field, vectorCount),
  ])));
}

export function buildSubstrateSmLightingSurfaceAssignment(binding) {
  if (!binding || SSM_LIGHTING_SURFACE_FIELDS.some(field =>
    typeof binding[field] !== 'string' || !RESOLVED_VALUE_EXPRESSION.test(binding[field]))) {
    throw new TypeError('Every direct surface field requires an already-resolved GLSL value');
  }
  return SSM_LIGHTING_SURFACE_FIELDS.map(field =>
    `ssmResolvedSurface.${field} = ${binding[field]};`,
  ).join('\n');
}
