import { sameSubstrateSmLifecycleIdentity } from '../../lighting/substrateSm/ssmLifecycleIdentity.js';

const SSM_TRANSACTION_METHODS = Object.freeze([
  'allocate',
  'upload',
  'compile',
  'link',
  'firstUse',
  'verify',
  'activate',
  'release',
]);

export function requireSubstrateSmSynchronousCallback(callback, name) {
  if (Object.prototype.toString.call(callback) !== '[object Function]') {
    throw new TypeError(`SSM_LIFECYCLE_SYNCHRONOUS_${name}_REQUIRED`);
  }
  return callback;
}

export function inspectSubstrateSmLifecycleTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object')
    throw new TypeError('SSM_LIFECYCLE_TRANSACTION_REQUIRED');
  for (const method of SSM_TRANSACTION_METHODS)
    requireSubstrateSmSynchronousCallback(transaction[method], method);
  return transaction;
}

export function verifySubstrateSmLifecycleProof(proof, identity) {
  if (
    !proof ||
    proof.ok !== true ||
    proof.linked !== true ||
    proof.selected !== true ||
    !sameSubstrateSmLifecycleIdentity(proof.identity, identity)
  )
    throw new Error('SSM_LIFECYCLE_PROGRAM_PROOF_INVALID');
  return true;
}
