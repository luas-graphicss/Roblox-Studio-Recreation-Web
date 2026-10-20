import { SSM_BSDF_GLSL } from '../../lighting/substrateSm/ssmBsdfGlsl.js';
import { SSM_TANGENT_FRAME_GLSL } from '../../lighting/substrateSm/ssmTangentFrameGlsl.js';
import { SSM_UV_TANGENT_FRAME_GLSL } from '../../lighting/substrateSm/ssmUvTangentFrameGlsl.js';
import { SSM_ANISOTROPY_GLSL } from '../../lighting/substrateSm/ssmAnisotropyGlsl.js';
import { getSubstrateSmRecipeFieldExpression } from '../../lighting/substrateSm/ssmRecipeLayoutGlsl.js';

export function buildSubstrateSmAnisotropyShaderExtension({ frameSource, recipeVectorCount = 7 } = {}) {
  if (!['geometry', 'uvDerivatives', 'none'].includes(frameSource)) {
    throw new TypeError('An explicit SSM frame source is required');
  }
  const field = name => getSubstrateSmRecipeFieldExpression(name, recipeVectorCount);
  const recipeEvaluation = `
#ifndef SSM_ANISOTROPIC_RECIPE_V1
#define SSM_ANISOTROPIC_RECIPE_V1
SsmBsdfResult ssmEvaluateAnisotropicRecipe(vec3 normal, vec3 viewDirection, vec3 lightDirection, SsmTangentFrame frame) {
  return ssmEvaluateAnisotropicBsdf(
    ${field('diffuseReflectance')}, ${field('specularF0')}, ${field('specularF90')},
    ${field('perceptualRoughness')}, ${field('anisotropy')}, normal, viewDirection, lightDirection, frame
  );
}
#endif
`;
  return Object.freeze({
    frameSource,
    recipeVectorCount,
    glsl: SSM_BSDF_GLSL + SSM_TANGENT_FRAME_GLSL +
      (frameSource === 'uvDerivatives' ? SSM_UV_TANGENT_FRAME_GLSL : '') + SSM_ANISOTROPY_GLSL + recipeEvaluation,
    rotationExpression: field('anisotropyRotation'),
    evaluationFunction: 'ssmEvaluateAnisotropicRecipe',
    vertexShader: '',
    requiresDerivativeSupport: frameSource === 'uvDerivatives',
    budgetDelta: Object.freeze({
      vertexUniformVectors: 0,
      vertexSamplers: 0,
      vertexAttributes: 0,
      varyingVectors: 0,
      fragmentSamplers: 0,
      descriptorTextureReads: 0,
      additionalSpecularTerms: 0,
      additionalLightLoops: 0,
      fullscreenPasses: 0,
    }),
  });
}
