import { SSM_CONTRACT_VERSION, SSM_RECIPE_LAYOUT, SSM_FAMILY_CONTRACTS, SSM_PROFILES } from './ssmContract.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';

export function describeSubstrateSmCompilationCost(recipe) {
  const limits = SSM_PROFILES[recipe.profile].limits;
  return copySubstrateSmImmutableData({
    contractVersion: SSM_CONTRACT_VERSION,
    logicalParameterComponents: SSM_RECIPE_LAYOUT.componentCount,
    logicalUniformBytes: SSM_RECIPE_LAYOUT.byteLength,
    maximumFragmentUniformVectors: SSM_RECIPE_LAYOUT.vectorCount,
    effectiveClosures: limits.effectiveClosures,
    lightLoopVisits: limits.lightLoopVisits,
    independentSpecularTerms: SSM_FAMILY_CONTRACTS[recipe.family].specularTerms,
    descriptorTextureReads: limits.descriptorTextureReads,
    additionalMaterialSamplers: 0,
    additionalFullscreenPasses: limits.fullscreenPasses,
    additionalScreenRenderTargetBytes: limits.screenTargetBytes,
    additionalTemporalHistories: limits.temporalHistories,
    allocationsOnRenderer: 0,
    evidenceStatus: 'structuralOnly',
    gpuTimeMilliseconds: null,
    driverMemoryBytes: null,
  });
}
