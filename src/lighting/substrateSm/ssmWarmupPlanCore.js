import { getSubstrateSmProfile } from './ssmContract.js';

export const SSM_WARMUP_STAGES = Object.freeze([
  'allocate',
  'upload',
  'compile',
  'link',
  'firstUse',
  'verify',
  'commit',
]);

export function createSubstrateSmWarmupPlan({
  profile = 'Lite',
  budgetMs = 4,
  maxPendingJobs = 32,
  maxPollFrames = 120,
  timeoutMs = 15000,
} = {}) {
  const settings = getSubstrateSmProfile(profile);
  if (!settings) throw new TypeError('SSM_WARMUP_PROFILE_INVALID');
  if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 12)
    throw new RangeError('SSM_WARMUP_SLICE_INVALID');
  if (
    !Number.isSafeInteger(maxPendingJobs) ||
    maxPendingJobs < 1 ||
    maxPendingJobs > settings.limits.uploadRecordsPerSlice
  )
    throw new RangeError('SSM_WARMUP_QUEUE_LIMIT');
  if (!Number.isSafeInteger(maxPollFrames) || maxPollFrames < 1 || maxPollFrames > 600)
    throw new RangeError('SSM_WARMUP_POLL_LIMIT');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000)
    throw new RangeError('SSM_WARMUP_TIMEOUT_INVALID');
  return Object.freeze({
    profile,
    budgetMs,
    maxPendingJobs,
    maxPollFrames,
    timeoutMs,
    maxOperationsPerFrame: 1,
    uploadBytesPerOperation: settings.limits.payloadBytes,
    stages: SSM_WARMUP_STAGES,
    synchronousWorkCanBePreempted: false,
  });
}
