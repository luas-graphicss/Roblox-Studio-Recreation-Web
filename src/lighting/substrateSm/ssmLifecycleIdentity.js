const SSM_IDENTITY_GENERATIONS = Object.freeze(['contextGeneration', 'projectGeneration', 'jobGeneration']);
const SSM_IDENTITY_KEYS = Object.freeze(['programKey', 'capabilityKey']);

export function createSubstrateSmLifecycleIdentity(input) {
  if (!input || typeof input !== 'object') throw new TypeError('SSM_LIFECYCLE_IDENTITY_REQUIRED');
  const identity = {};
  for (const field of SSM_IDENTITY_GENERATIONS) {
    if (!Number.isSafeInteger(input[field]) || input[field] < 0)
      throw new RangeError(`SSM_LIFECYCLE_INVALID_${field}`);
    identity[field] = input[field];
  }
  const revision = input.sourceRevision;
  if (!(
    (typeof revision === 'string' && revision.length > 0 && revision.length <= 256) ||
    (Number.isSafeInteger(revision) && revision >= 0)
  ))
    throw new TypeError('SSM_LIFECYCLE_SOURCE_REVISION_REQUIRED');
  identity.sourceRevision = revision;
  for (const field of SSM_IDENTITY_KEYS) {
    if (typeof input[field] !== 'string' || !input[field] || input[field].length > 8192) {
      throw new TypeError(`SSM_LIFECYCLE_INVALID_${field}`);
    }
    identity[field] = input[field];
  }
  return Object.freeze(identity);
}

export function sameSubstrateSmLifecycleIdentity(first, second) {
  if (!first || !second) return false;
  return (
    first.sourceRevision === second.sourceRevision &&
    first.contextGeneration === second.contextGeneration &&
    first.projectGeneration === second.projectGeneration &&
    first.jobGeneration === second.jobGeneration &&
    first.programKey === second.programKey &&
    first.capabilityKey === second.capabilityKey
  );
}

export function estimateSubstrateSmIdentityBytes(identity) {
  if (!identity) return 0;
  return (
    192 +
    2 * (String(identity.sourceRevision).length + identity.programKey.length + identity.capabilityKey.length)
  );
}
