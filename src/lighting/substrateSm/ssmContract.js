function freezeContract(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeContract(child);
  return Object.freeze(value);
}

export const SSM_CONTRACT_VERSION = 1;
export const SSM_RECIPE_VERSION = 1;
export const SSM_PHASE_ID = 'SSM-F03';
export const SSM_THREE_REVISION = '161';
export const SSM_FAMILIES = Object.freeze(['base', 'coat', 'sheen', 'foliage', 'anisotropic']);
export const SSM_QUALITY_NAMES = Object.freeze(['Auto', 'Lite', 'Moderate']);
export const SSM_BACKENDS = Object.freeze(['legacy', 'substrateFuture', 'substrateSm']);

export const SSM_RECIPE_LAYOUT = freezeContract({
  version: SSM_RECIPE_VERSION,
  vectorCount: 8,
  componentsPerVector: 4,
  componentCount: 32,
  bytesPerComponent: 4,
  byteLength: 128,
  storage: 'per-material-uniforms',
  fields: [
    { name: 'diffuseReflectance', vector: 0, component: 0, components: 3 },
    { name: 'perceptualRoughness', vector: 0, component: 3, components: 1 },
    { name: 'specularF0', vector: 1, component: 0, components: 3 },
    { name: 'coverage', vector: 1, component: 3, components: 1 },
    { name: 'emissiveRadiance', vector: 2, component: 0, components: 3 },
    { name: 'opacity', vector: 2, component: 3, components: 1 },
    { name: 'extinctionCoefficient', vector: 3, component: 0, components: 3 },
    { name: 'layerThickness', vector: 3, component: 3, components: 1 },
    { name: 'extensionWeight', vector: 4, component: 0, components: 1 },
    { name: 'extensionRoughness', vector: 4, component: 1, components: 1 },
    { name: 'anisotropy', vector: 4, component: 2, components: 1 },
    { name: 'anisotropyRotation', vector: 4, component: 3, components: 1 },
    { name: 'extensionTint', vector: 5, component: 0, components: 3 },
    { name: 'diffuseWrap', vector: 5, component: 3, components: 1 },
    { name: 'specularF90', vector: 6, component: 0, components: 1 },
    { name: 'reflectionRoughness', vector: 6, component: 1, components: 1 },
    { name: 'thinTransmissionWeight', vector: 6, component: 2, components: 1 },
    { name: 'reserved', vector: 6, component: 3, components: 1, requiredValue: 0 },
    { name: 'reservedVector', vector: 7, component: 0, components: 4, requiredValue: 0 },
  ],
});

const sharedLimits = Object.freeze({
  fullscreenPasses: 0,
  screenTargetBytes: 0,
  temporalHistories: 0,
  effectiveClosures: 1,
  lightLoopVisits: 1,
  mandatoryGlobalSamplers: 0,
  descriptorTextureReads: 0,
  payloadBytes: SSM_RECIPE_LAYOUT.byteLength,
  fragmentUniformVectors: SSM_RECIPE_LAYOUT.vectorCount,
  vertexUniformVectors: 0,
  vertexSamplers: 0,
  varyingVectors: 0,
  attributes: 0,
  bakeJobs: 1,
});

export const SSM_PROFILES = freezeContract({
  Lite: {
    families: ['base', 'sheen', 'foliage'],
    limits: {
      ...sharedLimits,
      specularTerms: 1,
      extraMaterialSamplers: 0,
      familyVariants: 3,
      residentRecipes: 1024,
      numericBufferBytes: 128 * 1024,
      cpuCacheBytes: 2 * 1024 * 1024,
      derivedTexturePeakBytes: 8 * 1024 * 1024,
      uploadRecordsPerSlice: 32,
      uploadBytesPerSlice: 4 * 1024,
    },
  },
  Moderate: {
    families: [...SSM_FAMILIES],
    limits: {
      ...sharedLimits,
      specularTerms: 2,
      extraMaterialSamplers: 1,
      familyVariants: 5,
      residentRecipes: 2048,
      numericBufferBytes: 256 * 1024,
      cpuCacheBytes: 4 * 1024 * 1024,
      derivedTexturePeakBytes: 16 * 1024 * 1024,
      uploadRecordsPerSlice: 64,
      uploadBytesPerSlice: 8 * 1024,
    },
  },
});

export const SSM_FAMILY_CONTRACTS = freezeContract({
  base: { specularTerms: 1, requiresTangent: false },
  coat: { specularTerms: 2, requiresTangent: false },
  sheen: { specularTerms: 1, requiresTangent: false },
  foliage: { specularTerms: 1, requiresTangent: false },
  anisotropic: { specularTerms: 1, requiresTangent: true },
});

export const SSM_PROGRAM_RESOURCE_FIELDS = Object.freeze([
  'fragmentSamplers', 'vertexSamplers', 'fragmentUniformVectors',
  'vertexUniformVectors', 'varyingVectors', 'attributes',
]);

export const SSM_RELEASE_DEFAULTS = freezeContract({
  optInEnabled: false,
  autoEnabled: false,
  permittedProfiles: [],
});

export const SSM_REFUSAL_CODES = Object.freeze({
  invalidInput: 'SSM_INVALID_INPUT',
  safeMode: 'SSM_SAFE_MODE',
  contextUnavailable: 'SSM_CONTEXT_UNAVAILABLE',
  invalidFlag: 'SSM_INVALID_FLAG',
  explicitVeto: 'SSM_EXPLICIT_VETO',
  technologyUnsupported: 'SSM_TECHNOLOGY_UNSUPPORTED',
  styleUnsupported: 'SSM_STYLE_UNSUPPORTED',
  releaseDisabled: 'SSM_RELEASE_DISABLED',
  capabilityUnknown: 'SSM_CAPABILITY_UNKNOWN',
  capabilityUnsupported: 'SSM_CAPABILITY_UNSUPPORTED',
  contextGenerationMismatch: 'SSM_CONTEXT_GENERATION_MISMATCH',
  sourceRevisionMismatch: 'SSM_SOURCE_REVISION_MISMATCH',
  hostPathUnsupported: 'SSM_HOST_PATH_UNSUPPORTED',
  hostAdapterUnavailable: 'SSM_HOST_ADAPTER_UNAVAILABLE',
  domainDelegated: 'SSM_DOMAIN_DELEGATED',
  blendModeDelegated: 'SSM_BLEND_MODE_DELEGATED',
  invalidQuality: 'SSM_INVALID_QUALITY',
  profileNotPermitted: 'SSM_PROFILE_NOT_PERMITTED',
  familyUnsupported: 'SSM_FAMILY_UNSUPPORTED',
  tangentUnavailable: 'SSM_TANGENT_UNAVAILABLE',
  resourceLedgerInvalid: 'SSM_RESOURCE_LEDGER_INVALID',
  resourceLimitExceeded: 'SSM_RESOURCE_LIMIT_EXCEEDED',
  samplerHeadroomUnavailable: 'SSM_SAMPLER_HEADROOM_UNAVAILABLE',
  candidateUnavailable: 'SSM_CANDIDATE_UNAVAILABLE',
  sourceUnvalidated: 'SSM_SOURCE_UNVALIDATED',
  preparationPending: 'SSM_PREPARATION_PENDING',
  ownershipConflict: 'SSM_OWNERSHIP_CONFLICT',
});

export const SSM_HOST_PATH_MATRIX = freezeContract({
  standard: { eligible: true, hostBackend: 'standard', integrationPhase: 'SSM-F11' },
  phong: { eligible: true, hostBackend: 'phong', integrationPhase: 'SSM-F12' },
  poolPhong: { eligible: true, hostBackend: 'phong', integrationPhase: 'SSM-F12' },
  poolStandard: { eligible: true, hostBackend: 'standard', integrationPhase: 'SSM-F19' },
  terreno: { eligible: true, hostBackend: 'standard', integrationPhase: 'SSM-F20' },
  skinned: { eligible: true, hostBackend: 'standard', integrationPhase: 'SSM-F20' },
  physical: { eligible: false, hostBackend: 'physical', integrationPhase: 'SSM-F21' },
  basic: { eligible: false, hostBackend: 'basic', integrationPhase: 'SSM-F21' },
  custom: { eligible: false, hostBackend: 'custom', integrationPhase: 'SSM-F21' },
});

export function getSubstrateSmProfile(profileName) {
  return typeof profileName === 'string' && Object.hasOwn(SSM_PROFILES, profileName) ? SSM_PROFILES[profileName] : null;
}
