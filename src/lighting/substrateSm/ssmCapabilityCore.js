import { SSM_PROGRAM_RESOURCE_FIELDS, SSM_REFUSAL_CODES } from './ssmContract.js';

const capabilityFields = Object.freeze([
  ...SSM_PROGRAM_RESOURCE_FIELDS, 'combinedSamplers', 'maxTextureSize',
]);

export function validateSubstrateSmCapabilities(capabilities, contextGeneration) {
  if (!Number.isSafeInteger(contextGeneration) || contextGeneration < 0) {
    return Object.freeze({ ok: false, code: SSM_REFUSAL_CODES.contextGenerationMismatch, field: 'contextGeneration' });
  }
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return Object.freeze({ ok: false, code: SSM_REFUSAL_CODES.capabilityUnknown, field: 'capabilities' });
  }
  if (capabilities.contextGeneration !== contextGeneration) {
    return Object.freeze({ ok: false, code: SSM_REFUSAL_CODES.contextGenerationMismatch, field: 'capabilities.contextGeneration' });
  }
  for (const field of capabilityFields) {
    if (!Object.hasOwn(capabilities, field) || !Number.isSafeInteger(capabilities[field]) || capabilities[field] < 0) {
      return Object.freeze({ ok: false, code: SSM_REFUSAL_CODES.capabilityUnknown, field });
    }
  }
  if (capabilities.fragmentHighp !== true || capabilities.maxTextureSize === 0) {
    return Object.freeze({ ok: false, code: SSM_REFUSAL_CODES.capabilityUnsupported, field: 'fragmentHighp/maxTextureSize' });
  }
  return Object.freeze({ ok: true, code: null, field: null });
}
