import {
  getSubstrateSmProfile, SSM_FAMILY_CONTRACTS, SSM_REFUSAL_CODES,
} from './ssmContract.js';
import { evaluateSubstrateSmProgramBudget } from './ssmProgramBudgetCore.js';

function refuseBudget(code, field) {
  return Object.freeze({ ok: false, code, field, program: null });
}

function validateResourceUsage(usage, limits, family, contextGeneration) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return refuseBudget(SSM_REFUSAL_CODES.resourceLedgerInvalid, 'ssmUsage');
  }
  if (usage.contextGeneration !== contextGeneration) {
    return refuseBudget(SSM_REFUSAL_CODES.contextGenerationMismatch, 'ssmUsage.contextGeneration');
  }
  const fields = [...Object.keys(limits), 'maxTextureSize'];
  for (const field of Object.keys(usage)) {
    if (field !== 'contextGeneration' && !fields.includes(field)) {
      return refuseBudget(SSM_REFUSAL_CODES.resourceLedgerInvalid, field);
    }
  }
  for (const field of fields) {
    const amount = usage[field];
    if (!Object.hasOwn(usage, field) || !Number.isSafeInteger(amount) || amount < 0) {
      return refuseBudget(SSM_REFUSAL_CODES.resourceLedgerInvalid, field);
    }
    if (Object.hasOwn(limits, field) && amount > limits[field]) {
      return refuseBudget(SSM_REFUSAL_CODES.resourceLimitExceeded, field);
    }
  }
  if (usage.payloadBytes === 0 || usage.payloadBytes % 16 !== 0) {
    return refuseBudget(SSM_REFUSAL_CODES.resourceLedgerInvalid, 'payloadBytes');
  }
  if (usage.effectiveClosures !== 1 || usage.lightLoopVisits !== 1
    || usage.specularTerms !== SSM_FAMILY_CONTRACTS[family].specularTerms) {
    return refuseBudget(SSM_REFUSAL_CODES.resourceLedgerInvalid, 'surfaceEvaluation');
  }
  if (usage.residentRecipes === 0 || usage.familyVariants === 0
    || usage.numericBufferBytes < usage.residentRecipes * usage.payloadBytes
    || usage.cpuCacheBytes < usage.numericBufferBytes
    || usage.uploadBytesPerSlice < usage.uploadRecordsPerSlice * usage.payloadBytes) {
    return refuseBudget(SSM_REFUSAL_CODES.resourceLedgerInvalid, 'residencyAccounting');
  }
  return null;
}

export function evaluateSubstrateSmResourceBudget(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return refuseBudget(SSM_REFUSAL_CODES.invalidInput, 'input');
  }
  const { profile, family, capabilities, contextGeneration, hostUsage, ssmUsage } = input;
  const settings = getSubstrateSmProfile(profile);
  if (!settings) return refuseBudget(SSM_REFUSAL_CODES.invalidQuality, 'profile');
  if (!settings.families.includes(family)) {
    return refuseBudget(SSM_REFUSAL_CODES.familyUnsupported, 'family');
  }
  const invalidUsage = validateResourceUsage(ssmUsage, settings.limits, family, contextGeneration);
  if (invalidUsage) return invalidUsage;
  const additionalUsage = {
    contextGeneration,
    fragmentSamplers: ssmUsage.extraMaterialSamplers,
    vertexSamplers: ssmUsage.vertexSamplers,
    fragmentUniformVectors: ssmUsage.fragmentUniformVectors,
    vertexUniformVectors: ssmUsage.vertexUniformVectors,
    varyingVectors: ssmUsage.varyingVectors,
    attributes: ssmUsage.attributes,
    maxTextureSize: ssmUsage.maxTextureSize,
  };
  const program = evaluateSubstrateSmProgramBudget({
    capabilities, contextGeneration, hostUsage, additionalUsage,
  });
  return Object.freeze({
    ok: program.ok,
    code: program.code,
    field: program.field,
    profile,
    family,
    program,
    limits: settings.limits,
    usage: Object.freeze({ ...ssmUsage }),
    measurementStatus: 'declared-resource-ledger-not-gpu-certification',
  });
}
