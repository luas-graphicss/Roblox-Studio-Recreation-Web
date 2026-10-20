import { SSM_RECIPE_UNIFORM_NAME } from '../../lighting/substrateSm/ssmRecipeLayoutGlsl.js';

export const SSM_SHADER_TRANSACTION_VERSION = 1;
export const SSM_SHADER_PATCH_GENERATION = 1;
export const SSM_BASE_UNIFORM_VECTOR_COUNT = 7;
export const SSM_SHADER_CONTRACT = Object.freeze({
  version: SSM_SHADER_TRANSACTION_VERSION,
  uniformName: SSM_RECIPE_UNIFORM_NAME,
  uniformVectorCount: SSM_BASE_UNIFORM_VECTOR_COUNT,
  surfaceType: 'SsmSurface',
  surfaceVariable: 'ssmSurface',
  directFunction: 'RE_Direct_SsmBase',
  surfaceReady: '#define SSM_SURFACE_READY 1',
  hostMaterialReady: '#define SSM_HOST_MATERIAL_READY 1',
  responseReady: '#define SSM_RESPONSE_READY 1',
  diffuseReflectance: 'ssmSurface.diffuseReflectance',
  specularF0: 'ssmSurface.specularF0',
  specularF90: 'ssmSurface.specularF90',
  perceptualRoughness: 'ssmSurface.perceptualRoughness',
  reflectionRoughness: 'ssmSurface.reflectionRoughness',
  normal: 'normal',
  directLight: 'directLight',
  reflectedLight: 'reflectedLight',
  indirectPolicy: 'host-response-approximation-until-F14',
  emissionPolicy: 'exclusive-host-or-recipe',
  incrementalSamplers: 0,
  incrementalPasses: 0,
  incrementalVaryings: 0,
  incrementalAttributes: 0,
});
