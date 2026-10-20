import { SSM_RECIPE_LAYOUT } from './ssmContract.js';
import { buildSubstrateSmRecipeUniformDeclarations, getSubstrateSmRecipeFieldExpression } from './ssmRecipeLayoutGlsl.js';
import { isSubstrateSmSpatialBlendPlan, SSM_SPATIAL_RECIPE_VECTORS } from './ssmSpatialBlendPlan.js';
import { SSM_MASK_UV_EXPRESSIONS } from './ssmMaskPlanCore.js';

export const SSM_SPATIAL_TARGET_UNIFORM = 'uSsmSpatialTarget';
export const SSM_SPATIAL_MASK_UNIFORM = 'uSsmSpatialMask';
export const SSM_SPATIAL_SURFACE_NAME = 'ssmSpatialSurface';

const roughnessInterpolation = `float ssmSpatialRoughness(float zeroValue, float oneValue, float weight) {
  if (weight <= 0.0) return zeroValue;
  if (weight >= 1.0) return oneValue;
  float zeroAlpha = zeroValue * zeroValue;
  float oneAlpha = oneValue * oneValue;
  return sqrt(sqrt(mix(zeroAlpha * zeroAlpha, oneAlpha * oneAlpha, weight)));
}`;

export function buildSubstrateSmSpatialResolveGlsl(plan) {
  if (!isSubstrateSmSpatialBlendPlan(plan)) throw new TypeError('An admitted spatial blend plan is required');
  const fields = SSM_RECIPE_LAYOUT.fields.filter(field => field.requiredValue === undefined);
  const declarations = [buildSubstrateSmRecipeUniformDeclarations(SSM_SPATIAL_RECIPE_VECTORS),
    `uniform vec4 ${SSM_SPATIAL_TARGET_UNIFORM};`];
  const optionalMask = plan.maskPlan.mode === 'optional';
  if (optionalMask) declarations.push(`uniform sampler2D ${SSM_SPATIAL_MASK_UNIFORM};`);
  declarations.push(`struct SsmSpatialSurface {\n${fields.map(field => `  ${field.components === 3 ? 'vec3' : 'float'} ${field.name};`).join('\n')}\n};`);
  if (plan.channels.some(channel => channel.interpolation === 'ggx-alpha-squared')) declarations.push(roughnessInterpolation);
  const assignments = fields.map(field => `  result.${field.name} = ${getSubstrateSmRecipeFieldExpression(field.name, SSM_SPATIAL_RECIPE_VECTORS)};`);
  for (const channel of plan.channels) {
    const component = channel.components[0];
    const zero = `result.${component.name}`;
    const one = `${SSM_SPATIAL_TARGET_UNIFORM}.${'xyzw'[channel.targetIndex]}`;
    const blend = channel.interpolation === 'ggx-alpha-squared'
      ? `ssmSpatialRoughness(${zero}, ${one}, weight)`
      : `(weight <= 0.0 ? ${zero} : (weight >= 1.0 ? ${one} : mix(${zero}, ${one}, weight)))`;
    assignments.push(`  float spatialChannel${channel.targetIndex} = ${blend};`);
    for (const member of channel.components) assignments.push(`  result.${member.name} = spatialChannel${channel.targetIndex};`);
  }
  declarations.push(`SsmSpatialSurface ssmResolveSpatialSurface(float maskValue) {\n  float weight = clamp(maskValue, 0.0, 1.0);\n  SsmSpatialSurface result;\n${assignments.join('\n')}\n  return result;\n}`);
  const maskExpression = optionalMask
    ? `texture2D(${SSM_SPATIAL_MASK_UNIFORM}, ${SSM_MASK_UV_EXPRESSIONS[plan.maskPlan.uvRole]}).${plan.maskPlan.channel}`
    : 'ssmOrmSample.a';
  return Object.freeze({ declarations: declarations.join('\n\n'),
    resolve: `SsmSpatialSurface ${SSM_SPATIAL_SURFACE_NAME} = ssmResolveSpatialSurface(${maskExpression});`,
    fields: Object.freeze(Object.fromEntries(fields.map(field => [field.name, `${SSM_SPATIAL_SURFACE_NAME}.${field.name}`]))),
    requiredHostSample: optionalMask ? null : 'ssmOrmSample',
    placement: 'after-shared-maps-before-family-material-construction-and-light-loops',
    resourceContract: plan.resourceContract });
}
