import { inspectSubstrateSmMaterialBoundary } from './ssmMaterialBoundaryPolicy.js';
import { captureSubstrateSmMaterialBoundaryState, sameSubstrateSmMaterialBoundaryState } from './ssmMaterialBoundaryState.js';

function isRevision(value) {
  return (Number.isSafeInteger(value) && value >= 0) || (typeof value === 'string' && value.length > 0);
}

function readContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (!isRevision(input.sourceRevision) || !Number.isSafeInteger(input.contextGeneration) || input.contextGeneration < 0) return null;
  return Object.freeze({
    sourceRevision: input.sourceRevision,
    contextGeneration: input.contextGeneration,
    materialDomain: input.materialDomain === undefined ? 'surface' : input.materialDomain,
    bsdfKind: input.bsdfKind === undefined ? 'slab' : input.bsdfKind,
  });
}

export function createSubstrateSmMaterialBoundaryGuard() {
  const currentByMesh = new WeakMap();
  const recordByTicket = new WeakMap();

  function invalidate(mesh) {
    return mesh !== null && typeof mesh === 'object' ? currentByMesh.delete(mesh) : false;
  }

  function capture(mesh, input) {
    invalidate(mesh);
    const context = readContext(input);
    const boundary = inspectSubstrateSmMaterialBoundary({ material: mesh?.material, ...context });
    if (!boundary.allowed) return Object.freeze({ ...boundary, ticket: null });
    if (mesh?.isMesh !== true || !context) {
      return Object.freeze({
        ...boundary,
        allowed: false,
        code: 'SSM_BOUNDARY_CONTEXT_REQUIRED',
        reason: 'A mesh, current source revision and context generation are required.',
        fallbackOwner: 'existing-host',
        ticket: null,
      });
    }
    const ticket = Object.freeze({});
    const record = { mesh, context, state: captureSubstrateSmMaterialBoundaryState(mesh) };
    recordByTicket.set(ticket, record);
    currentByMesh.set(mesh, record);
    return Object.freeze({ ...boundary, ticket });
  }

  function isCurrent(ticket, input) {
    const record = ticket !== null && typeof ticket === 'object' ? recordByTicket.get(ticket) : null;
    if (!record || currentByMesh.get(record.mesh) !== record) return false;
    const context = readContext(input);
    const contextMatches = context && Object.keys(record.context).every(field => Object.is(record.context[field], context[field]));
    const boundary = inspectSubstrateSmMaterialBoundary({ material: record.mesh.material, ...context });
    const stateMatches = boundary.allowed && sameSubstrateSmMaterialBoundaryState(
      record.state, captureSubstrateSmMaterialBoundaryState(record.mesh),
    );
    if (!contextMatches || !stateMatches) {
      invalidate(record.mesh);
      return false;
    }
    return true;
  }

  return Object.freeze({ capture, isCurrent, invalidate });
}
