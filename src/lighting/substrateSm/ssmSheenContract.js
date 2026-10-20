import { SSM_FAMILY_CONTRACTS, SSM_RECIPE_LAYOUT } from './ssmContract.js';

export const SSM_SHEEN_VERSION = 1;
export const SSM_SHEEN_MINIMUM_ROUGHNESS = 0.05;
export const SSM_SHEEN_MINIMUM_EXPONENT = 1;
export const SSM_SHEEN_MAXIMUM_EXPONENT = 5;
export const SSM_SHEEN_UNIFORM_VECTOR_COUNT = 7;
export const SSM_SHEEN_STRUCTURAL_VARIANT = 'sheen-direct-v1';
export const SSM_SHEEN_RECIPE_FIELDS = Object.freeze({
  amount: 'extensionWeight',
  roughness: 'extensionRoughness',
  tint: 'extensionTint',
});
export const SSM_SHEEN_RESOURCES = Object.freeze({
  specularTerms: SSM_FAMILY_CONTRACTS.sheen.specularTerms,
  effectiveClosures: 1,
  lightLoopVisits: 1,
  fullscreenPasses: 0,
  screenTargetBytes: 0,
  temporalHistories: 0,
  fragmentSamplers: 0,
  vertexSamplers: 0,
  mandatoryGlobalSamplers: 0,
  descriptorTextureReads: 0,
  fragmentUniformVectors: SSM_SHEEN_UNIFORM_VECTOR_COUNT,
  vertexUniformVectors: 0,
  varyingVectors: 0,
  attributes: 0,
  payloadBytes: SSM_RECIPE_LAYOUT.byteLength,
});
export const SSM_SHEEN_LIMITATIONS = Object.freeze([
  'Low-order separable grazing approximation; not an LTC or Charlie sheen lobe',
  'Fiber interception attenuates the base on the view and light paths and re-emits at most the intercepted energy scaled by the fiber tint',
  'One GGX evaluation; the fiber term is an analytical adjustment folded into the specular channel, not a second lobe',
  'Directional direct lighting only; the fiber term is not added to the indirect adapter',
  'Lite and Moderate share the same model in this delivery',
  'No extra shadow, environment, probe, SSR, LTC or descriptor sampler',
]);
