import { SSM_BACKENDS, SSM_REFUSAL_CODES } from './ssmContract.js';

function createOwnershipRow(backend) {
  return Object.freeze({
    backend,
    directDiffuse: backend,
    directSpecular: backend,
    indirectResponse: backend,
    energyCompensation: backend,
    lighting: 'host',
    visibility: 'host',
    emission: 'host',
    exposure: 'host',
    msmPartition: 'host',
    changesPostEffects: false,
    allowedResponses: Object.freeze({
      legacy: backend === 'legacy',
      llF8: backend === 'legacy',
      ilF11: backend === 'legacy',
      substrateFuture: backend === 'substrateFuture',
      substrateSm: backend === 'substrateSm',
    }),
  });
}

export const SSM_OWNERSHIP_MATRIX = Object.freeze(Object.fromEntries(
  SSM_BACKENDS.map(backend => [backend, createOwnershipRow(backend)]),
));

export function resolveSubstrateSmOwnership(backend) {
  return typeof backend === 'string' && Object.hasOwn(SSM_OWNERSHIP_MATRIX, backend) ? SSM_OWNERSHIP_MATRIX[backend] : null;
}

export function validateSubstrateSmOwnership(backend, activeResponses) {
  const ownership = resolveSubstrateSmOwnership(backend);
  if (!ownership || !activeResponses || typeof activeResponses !== 'object' || Array.isArray(activeResponses)) {
    return Object.freeze({ ok: false, code: SSM_REFUSAL_CODES.ownershipConflict, conflicts: Object.freeze(['invalid-ownership']) });
  }
  const conflicts = [];
  for (const response of Object.keys(activeResponses)) {
    if (!Object.hasOwn(ownership.allowedResponses, response)) conflicts.push(response);
  }
  for (const [response, allowed] of Object.entries(ownership.allowedResponses)) {
    const actual = activeResponses[response];
    if (typeof actual !== 'boolean' || (actual && !allowed)) conflicts.push(response);
  }
  if (activeResponses[backend] !== true) conflicts.push('missing-primary-response');
  return Object.freeze({
    ok: conflicts.length === 0,
    code: conflicts.length ? SSM_REFUSAL_CODES.ownershipConflict : null,
    conflicts: Object.freeze(conflicts),
  });
}
