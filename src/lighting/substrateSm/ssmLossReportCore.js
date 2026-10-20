import { copySubstrateSmImmutableData } from './ssmImmutableData.js';

export const SSM_LOSS_CLASSIFICATIONS = Object.freeze([
  'exact', 'fitted', 'baked', 'unsupported', 'budgetFallback',
]);

const EVIDENCE_STATUSES = Object.freeze([
  'structural', 'analytical', 'unmeasured', 'measuredCpu', 'measuredGpu',
]);

function requireText(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a nonempty string`);
  }
  return value;
}

function isNonnegativeFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateMeasuredLoss(measuredLoss, evidenceStatus) {
  if (measuredLoss === null) {
    if (evidenceStatus === 'measuredCpu' || evidenceStatus === 'measuredGpu') {
      throw new TypeError('Measured evidence requires an actual measurement');
    }
    return;
  }
  if (evidenceStatus !== 'measuredCpu' && evidenceStatus !== 'measuredGpu') {
    throw new TypeError('A measurement must identify CPU or GPU evidence explicitly');
  }
  if (isNonnegativeFiniteNumber(measuredLoss)) return;
  if (!measuredLoss || typeof measuredLoss !== 'object' || Array.isArray(measuredLoss)) {
    throw new TypeError('Measured loss must be a finite number or a metric record');
  }
  requireText(measuredLoss.metric, 'measuredLoss.metric');
  if (!Number.isSafeInteger(measuredLoss.sampleCount) || measuredLoss.sampleCount <= 0) {
    throw new TypeError('A measured metric record requires a positive sampleCount');
  }
  for (const [name, value] of Object.entries(measuredLoss)) {
    if (name !== 'metric' && !isNonnegativeFiniteNumber(value)) {
      throw new TypeError(`Measured loss ${name} must be a nonnegative finite number`);
    }
  }
}

export function createSubstrateSmLossEntry({
  sourcePath,
  operation,
  replacement,
  reason,
  classification = 'exact',
  estimatedLoss = classification === 'exact' ? 0 : null,
  measuredLoss = null,
  evidenceStatus = classification === 'exact' ? 'structural' : 'unmeasured',
}) {
  if (!SSM_LOSS_CLASSIFICATIONS.includes(classification)) {
    throw new TypeError('Unknown Substrate SM loss classification');
  }
  if (!EVIDENCE_STATUSES.includes(evidenceStatus)) {
    throw new TypeError('Unknown Substrate SM evidence status');
  }
  if (estimatedLoss !== null && !isNonnegativeFiniteNumber(estimatedLoss)) {
    throw new TypeError('Estimated loss must be a nonnegative finite number or null');
  }
  validateMeasuredLoss(measuredLoss, evidenceStatus);
  return copySubstrateSmImmutableData({
    sourcePath: requireText(sourcePath, 'sourcePath'),
    operation: requireText(operation, 'operation'),
    replacement: requireText(replacement, 'replacement'),
    reason: requireText(reason, 'reason'),
    classification,
    estimatedLoss,
    measuredLoss,
    evidenceStatus,
  });
}

function compareLossEntries(left, right) {
  for (const field of ['sourcePath', 'operation', 'replacement', 'reason', 'classification', 'evidenceStatus']) {
    if (left[field] < right[field]) return -1;
    if (left[field] > right[field]) return 1;
  }
  const leftEvidence = JSON.stringify([left.estimatedLoss, left.measuredLoss]);
  const rightEvidence = JSON.stringify([right.estimatedLoss, right.measuredLoss]);
  return leftEvidence < rightEvidence ? -1 : leftEvidence > rightEvidence ? 1 : 0;
}

export function createSubstrateSmLossReport(entries = []) {
  const sortedEntries = entries.map(entry => {
    if (!entry || !Object.hasOwn(entry, 'classification')) {
      throw new TypeError('Every external loss entry requires an explicit classification');
    }
    return createSubstrateSmLossEntry(entry);
  }).sort(compareLossEntries);
  const counts = Object.fromEntries(SSM_LOSS_CLASSIFICATIONS.map(name => [name, 0]));
  for (const entry of sortedEntries) counts[entry.classification] += 1;
  const hasMeasurements = sortedEntries.some(entry => entry.measuredLoss !== null);
  return copySubstrateSmImmutableData({
    entries: sortedEntries,
    counts,
    hasApproximations: counts.fitted + counts.baked > 0,
    requiresFallback: counts.unsupported + counts.budgetFallback > 0,
    hasMeasurements,
    measuredLoss: null,
    evidenceStatus: hasMeasurements ? 'perEntryMeasurements' : 'notOpticallyMeasured',
  });
}
