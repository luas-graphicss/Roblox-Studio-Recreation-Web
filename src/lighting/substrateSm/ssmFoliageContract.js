import { SSM_FAMILY_CONTRACTS, SSM_RECIPE_LAYOUT } from './ssmContract.js';

export const SSM_FOLIAGE_VERSION = 1;
export const SSM_FOLIAGE_REFERENCE_THICKNESS_MILLIMETERS = 0.3;
export const SSM_FOLIAGE_WRAP_REFERENCE_MEAN_FREE_PATH_MILLIMETERS = 4;
export const SSM_FOLIAGE_MAXIMUM_WRAP = 0.5;
export const SSM_FOLIAGE_MAXIMUM_PHASE = 0.9;
export const SSM_FOLIAGE_MINIMUM_TRANSMISSION = 1e-4;
export const SSM_FOLIAGE_UNIFORM_VECTOR_COUNT = 7;
export const SSM_FOLIAGE_STRUCTURAL_VARIANT = 'foliage-direct-v1';
export const SSM_FOLIAGE_RECIPE_FIELDS = Object.freeze({
  wrap: 'diffuseWrap',
  transmissionWeight: 'thinTransmissionWeight',
  transmissionTint: 'extensionTint',
  forwardRoughness: 'extensionRoughness',
});
export const SSM_FOLIAGE_TRANSMISSION_SOURCES = Object.freeze({
  host: 'hostTransmissionVisibility',
  fallback: 'frontVisibilityFallback',
});
export const SSM_FOLIAGE_LIGHT_INPUT_CONTRACT = Object.freeze({
  version: 1,
  directionSpace: 'view',
  directionLength: 'unit',
  radiance: 'host-after-attenuation-cookie-and-visibility',
  transmissionRadiance: 'host-back-side-visibility-or-null',
  cosine: 'applied-inside-foliage',
  shadowOwner: 'host',
  extraShadowEvaluations: 0,
  lightLoopVisits: 1,
});
export const SSM_FOLIAGE_RESOURCES = Object.freeze({
  specularTerms: SSM_FAMILY_CONTRACTS.foliage.specularTerms,
  effectiveClosures: 1,
  lightLoopVisits: 1,
  fullscreenPasses: 0,
  screenTargetBytes: 0,
  temporalHistories: 0,
  fragmentSamplers: 0,
  vertexSamplers: 0,
  mandatoryGlobalSamplers: 0,
  descriptorTextureReads: 0,
  fragmentUniformVectors: SSM_FOLIAGE_UNIFORM_VECTOR_COUNT,
  vertexUniformVectors: 0,
  varyingVectors: 0,
  attributes: 0,
  payloadBytes: SSM_RECIPE_LAYOUT.byteLength,
});
export const SSM_FOLIAGE_LIMITATIONS = Object.freeze([
  'Wrapped diffuse is normalized for uniform illumination; per-direction reciprocity is not claimed while wrap is nonzero',
  'Thin transmission is a bounded Lambertian plus Henyey-Greenstein forward shape; no volumetric mean free path transport or screen-space profile',
  'Transmission consumes host-provided back-side visibility; without it the front visibility is reused as a conservative fallback',
  'Fixed reference leaf thickness in millimeters converts authored mean free path into transmittance; no per-vertex thickness',
  'Negative Henyey-Greenstein phase is dropped; Lite forces an isotropic transmission shape',
  'Directional direct lighting only; transmission is not added to the indirect adapter',
  'No extra shadow, environment, probe, SSR or descriptor sampler',
]);
