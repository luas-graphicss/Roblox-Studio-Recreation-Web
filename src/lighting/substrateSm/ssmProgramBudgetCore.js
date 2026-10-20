import { SSM_PROGRAM_RESOURCE_FIELDS, SSM_REFUSAL_CODES } from './ssmContract.js';
import { validateSubstrateSmCapabilities } from './ssmCapabilityCore.js';

function invalidLedger(field) {
  return Object.freeze({ ok: false, code: SSM_REFUSAL_CODES.resourceLedgerInvalid, field });
}

function validateUsage(usage, label, contextGeneration) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return invalidLedger(label);
  if (usage.contextGeneration !== contextGeneration) {
    return Object.freeze({ ok: false, code: SSM_REFUSAL_CODES.contextGenerationMismatch, field: label + '.contextGeneration' });
  }
  for (const field of [...SSM_PROGRAM_RESOURCE_FIELDS, 'maxTextureSize']) {
    if (!Object.hasOwn(usage, field) || !Number.isSafeInteger(usage[field]) || usage[field] < 0) {
      return invalidLedger(label + '.' + field);
    }
  }
  return null;
}

export function evaluateSubstrateSmProgramBudget(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalidLedger('input');
  const { capabilities, contextGeneration, hostUsage, additionalUsage } = input;
  const capability = validateSubstrateSmCapabilities(capabilities, contextGeneration);
  if (!capability.ok) return capability;
  const invalidHost = validateUsage(hostUsage, 'hostUsage', contextGeneration);
  if (invalidHost) return invalidHost;
  const invalidAdditional = validateUsage(additionalUsage, 'additionalUsage', contextGeneration);
  if (invalidAdditional) return invalidAdditional;
  const totals = {};
  const headroom = {};
  const violations = [];
  for (const field of SSM_PROGRAM_RESOURCE_FIELDS) {
    const total = hostUsage[field] + additionalUsage[field];
    if (!Number.isSafeInteger(total)) return invalidLedger('totals.' + field);
    totals[field] = total;
    headroom[field] = capabilities[field] - total;
    if (headroom[field] < 0) violations.push(field);
  }
  totals.combinedSamplers = totals.fragmentSamplers + totals.vertexSamplers;
  if (!Number.isSafeInteger(totals.combinedSamplers)) return invalidLedger('totals.combinedSamplers');
  headroom.combinedSamplers = capabilities.combinedSamplers - totals.combinedSamplers;
  if (headroom.combinedSamplers < 0) violations.push('combinedSamplers');
  totals.maxTextureSize = Math.max(hostUsage.maxTextureSize, additionalUsage.maxTextureSize);
  headroom.maxTextureSize = capabilities.maxTextureSize - totals.maxTextureSize;
  if (headroom.maxTextureSize < 0) violations.push('maxTextureSize');
  const addsSampler = additionalUsage.fragmentSamplers + additionalUsage.vertexSamplers > 0;
  const preservesMargin = headroom.fragmentSamplers >= 1 && headroom.combinedSamplers >= 1;
  const fragmentMargin = additionalUsage.fragmentSamplers === 0 || headroom.fragmentSamplers >= 1;
  const vertexMargin = additionalUsage.vertexSamplers === 0 || headroom.vertexSamplers >= 1;
  const marginRefused = addsSampler && (!fragmentMargin || !vertexMargin || headroom.combinedSamplers < 1);
  return Object.freeze({
    ok: violations.length === 0 && !marginRefused,
    code: violations.length ? SSM_REFUSAL_CODES.resourceLimitExceeded
      : marginRefused ? SSM_REFUSAL_CODES.samplerHeadroomUnavailable : null,
    field: violations[0] ?? (marginRefused ? 'samplerHeadroom' : null),
    totals: Object.freeze(totals),
    headroom: Object.freeze(headroom),
    violations: Object.freeze(violations),
    samplerMargin: preservesMargin ? 1 : 0,
    accounting: 'stage-sampler-counts-not-distinct-assets',
  });
}
