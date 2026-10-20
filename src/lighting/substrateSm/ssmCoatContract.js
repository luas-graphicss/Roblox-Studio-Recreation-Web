import { SSM_FAMILY_CONTRACTS, SSM_RECIPE_LAYOUT } from './ssmContract.js';
import { SSM_LAYER_REFERENCE_THICKNESS, SSM_LAYER_COSINE_FLOOR } from './ssmLayerReductionCore.js';

export const SSM_COAT_VERSION = 1;
export const SSM_COAT_REFRACTIVE_INDEX = 1.5;
export const SSM_COAT_F0 = 0.04;
export const SSM_COAT_F90 = 1;
export const SSM_COAT_REFERENCE_THICKNESS = SSM_LAYER_REFERENCE_THICKNESS;
export const SSM_COAT_COSINE_FLOOR = SSM_LAYER_COSINE_FLOOR;
export const SSM_COAT_MAXIMUM_OPTICAL_DEPTH = 80;
export const SSM_COAT_UNIFORM_VECTOR_COUNT = 7;
export const SSM_COAT_STRUCTURAL_VARIANT = 'coat-direct-v1';
export const SSM_COAT_RESOURCES = Object.freeze({
  specularTerms: SSM_FAMILY_CONTRACTS.coat.specularTerms,
  effectiveClosures: 1,
  lightLoopVisits: 1,
  fullscreenPasses: 0,
  screenTargetBytes: 0,
  temporalHistories: 0,
  fragmentSamplers: 0,
  vertexSamplers: 0,
  mandatoryGlobalSamplers: 0,
  descriptorTextureReads: 0,
  fragmentUniformVectors: SSM_COAT_UNIFORM_VECTOR_COUNT,
  vertexUniformVectors: 0,
  varyingVectors: 0,
  attributes: 0,
  payloadBytes: SSM_RECIPE_LAYOUT.byteLength,
});
export const SSM_COAT_LIMITATIONS = Object.freeze([
  'Single dielectric interface with fixed IOR 1.5 and shared shading normal',
  'Single-scatter GGX; no internal multiple scattering or rough refraction',
  'Thickness uses normalized source units, not meters or studs',
  'Directional direct lighting only until the host indirect adapter is integrated',
  'No extra shadow, environment, probe, SSR, LTC or descriptor sampler',
  'Engine activation requires the existing release gate and completed M1 integration',
]);
