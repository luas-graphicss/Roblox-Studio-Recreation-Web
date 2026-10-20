import { evaluateSubstrateSmProgramBudget } from '../../lighting/substrateSm/ssmProgramBudgetCore.js';

export function createSubstrateSmDeformedIncrementalUsage(contextGeneration, fragmentUniformVectors) {
  return Object.freeze({ contextGeneration, fragmentUniformVectors, vertexUniformVectors: 0,
    fragmentSamplers: 0, vertexSamplers: 0, attributes: 0, varyingVectors: 0, maxTextureSize: 0 });
}

export function evaluateSubstrateSmDeformedHostBudget({ host, hostUsage, additionalUsage,
  capabilities, contextGeneration, textureSize = 0 } = {}) {
  if (host?.allowed !== true) return Object.freeze({ ok: false, code: host?.code ?? 'SSM_DEFORMED_HOST_REQUIRED' });
  const program = evaluateSubstrateSmProgramBudget({ capabilities, contextGeneration, hostUsage, additionalUsage });
  if (!program.ok) return program;
  for (const [field, minimum] of Object.entries(host.resourceFloor)) {
    if (hostUsage[field] < minimum) {
      return Object.freeze({ ok: false, code: 'SSM_DEFORMED_HOST_RESOURCE_OMITTED', field, minimum });
    }
  }
  if (!Number.isSafeInteger(textureSize) || textureSize < 0 || hostUsage.maxTextureSize < textureSize) {
    return Object.freeze({ ok: false, code: 'SSM_DEFORMED_HOST_RESOURCE_OMITTED', field: 'maxTextureSize' });
  }
  for (const field of ['vertexUniformVectors', 'vertexSamplers', 'fragmentSamplers', 'attributes', 'varyingVectors', 'maxTextureSize']) {
    if (additionalUsage[field] !== 0) {
      return Object.freeze({ ok: false, code: 'SSM_DEFORMED_EXTRA_STAGE_RESOURCE_DELEGATED', field });
    }
  }
  if (additionalUsage.fragmentUniformVectors > 8) {
    return Object.freeze({ ok: false, code: 'SSM_DEFORMED_PAYLOAD_LIMIT', field: 'fragmentUniformVectors' });
  }
  return program;
}
