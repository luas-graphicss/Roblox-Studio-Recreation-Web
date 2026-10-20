import { createSubstrateSmRecipeMemoryLedger } from '../../lighting/substrateSm/ssmRecipeMemoryLedger.js';
import { SSM_RECIPE_BYTE_LENGTH } from '../../lighting/substrateSm/ssmRecipeLayout.js';

const SSM_MATERIAL_RECORD_OVERHEAD_BYTES = 384;
const SSM_DEPENDENCY_REFERENCE_OVERHEAD_BYTES = 128;
const SSM_UNKNOWN_DEPENDENCY_REVISION = Symbol('unknownDependencyRevision');

function requireRevision(value) {
  if ((Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'string' && value.length > 0 && value.length <= 256)) return value;
  throw new TypeError('SSM revisions must be nonnegative safe integers or bounded strings');
}

function requireIdentifier(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new TypeError('SSM material and dependency identifiers must be bounded strings');
  }
  return value;
}

function readDependencies(dependencies) {
  if (!Array.isArray(dependencies) || dependencies.length > 32768) throw new TypeError('Invalid SSM dependencies');
  return new Set(dependencies.map(requireIdentifier));
}

function sameDependencies(first, second) {
  if (first.size !== second.size) return false;
  for (const dependency of first) if (!second.has(dependency)) return false;
  return true;
}

function materialRecordCost(materialId, sourceRevision, dependencies) {
  let bytes = SSM_MATERIAL_RECORD_OVERHEAD_BYTES + 2 * (materialId.length + String(sourceRevision).length);
  for (const dependency of dependencies) bytes += SSM_DEPENDENCY_REFERENCE_OVERHEAD_BYTES + 2 * dependency.length;
  return { residentRecipes: 0, numericBufferBytes: 0, cpuCacheBytes: bytes };
}

export function createSubstrateSmDirtyMaterialQueue({
  profile = 'Lite', memoryLedger, maxMaterials, contextGeneration = 0, projectGeneration = 0,
} = {}) {
  const ledger = memoryLedger ?? createSubstrateSmRecipeMemoryLedger({ profile });
  const materialLimit = maxMaterials ?? ledger.limits.residentRecipes;
  if (!Number.isSafeInteger(materialLimit) || materialLimit < 0 || materialLimit > ledger.limits.residentRecipes) {
    throw new RangeError('SSM dirty queue exceeds the admitted material-record capacity');
  }
  requireRevision(contextGeneration);
  requireRevision(projectGeneration);
  const records = new Map();
  const dependencyIndex = new Map();
  const pending = new Set();
  const running = new Map();
  let disposed = false;
  let suspended = false;
  let committing = false;
  let cancellationController = null;
  let cancellationReason = null;
  let frameId = -1;
  let startsInSlice = 0;
  let commitsInSlice = 0;
  let invalidations = 0;
  let completedJobs = 0;
  let staleJobs = 0;
  let refusedRegistrations = 0;

  function assertMutable() {
    if (committing) throw new Error('SSM queue mutations are forbidden inside a commit transaction');
  }

  function detachDependencies(record) {
    for (const dependencyId of record.dependencies) {
      const dependency = dependencyIndex.get(dependencyId);
      dependency.materials.delete(record);
      if (dependency.materials.size === 0) dependencyIndex.delete(dependencyId);
    }
  }

  function attachDependencies(record) {
    for (const dependencyId of record.dependencies) {
      let dependency = dependencyIndex.get(dependencyId);
      if (!dependency) {
        dependency = { revision: SSM_UNKNOWN_DEPENDENCY_REVISION, materials: new Set() };
        dependencyIndex.set(dependencyId, dependency);
      }
      dependency.materials.add(record);
    }
  }

  function cancelRecordWork(record, reason) {
    pending.delete(record);
    const token = record.jobToken;
    record.jobToken = null;
    record.status = reason;
    if (token) {
      cancellationController = running.get(token) ?? null;
      cancellationReason = reason;
    }
  }

  function notifyCancellation() {
    const controller = cancellationController;
    const reason = cancellationReason;
    cancellationController = null;
    cancellationReason = null;
    controller?.abort(reason);
  }

  function markDirty(record, reason) {
    cancelRecordWork(record, reason);
    record.jobGeneration += 1;
    if (!Number.isSafeInteger(record.jobGeneration)) throw new RangeError('SSM job generation overflow');
    if (record.admitted && !suspended && !disposed) pending.add(record);
    invalidations += 1;
  }

  function registerMaterial({ materialId, sourceRevision, dependencies = [] }) {
    assertMutable();
    requireIdentifier(materialId);
    requireRevision(sourceRevision);
    const dependencySet = readDependencies(dependencies);
    if (disposed || records.has(materialId) || records.size >= materialLimit) {
      refusedRegistrations += 1;
      return false;
    }
    const record = {
      materialId, sourceRevision, dependencies: dependencySet,
      jobGeneration: 0, jobToken: null, status: 'registered', admitted: true,
    };
    if (!ledger.reserve(record, materialRecordCost(materialId, sourceRevision, dependencySet))) {
      refusedRegistrations += 1;
      return false;
    }
    records.set(materialId, record);
    attachDependencies(record);
    markDirty(record, 'registered');
    return true;
  }

  function updateMaterial(materialId, { sourceRevision, dependencies }) {
    assertMutable();
    requireRevision(sourceRevision);
    const record = records.get(materialId);
    if (!record || disposed) return false;
    const nextDependencies = dependencies === undefined ? record.dependencies : readDependencies(dependencies);
    if (record.admitted && Object.is(record.sourceRevision, sourceRevision)
      && sameDependencies(record.dependencies, nextDependencies)) return false;
    if (!ledger.reserve(record, materialRecordCost(materialId, sourceRevision, nextDependencies))) {
      cancelRecordWork(record, 'budgetFallback');
      record.admitted = false;
      record.jobGeneration += 1;
      refusedRegistrations += 1;
      notifyCancellation();
      return false;
    }
    detachDependencies(record);
    record.dependencies = nextDependencies;
    record.sourceRevision = sourceRevision;
    record.admitted = true;
    attachDependencies(record);
    markDirty(record, 'sourceChanged');
    notifyCancellation();
    return true;
  }

  function invalidateDependency(dependencyId, revision) {
    assertMutable();
    requireRevision(revision);
    const dependency = dependencyIndex.get(dependencyId);
    if (!dependency || disposed || Object.is(dependency.revision, revision)) return 0;
    dependency.revision = revision;
    const affectedMaterials = dependency.materials.size;
    for (const record of dependency.materials) markDirty(record, 'dependencyChanged');
    notifyCancellation();
    return affectedMaterials;
  }

  function removeMaterialRecord(materialId, reason = 'removed') {
    const record = records.get(materialId);
    if (!record) return false;
    cancelRecordWork(record, reason);
    detachDependencies(record);
    records.delete(materialId);
    ledger.release(record);
    return true;
  }

  function unregisterMaterial(materialId) {
    assertMutable();
    const removed = removeMaterialRecord(materialId);
    notifyCancellation();
    return removed;
  }

  function cancelMaterial(materialId, reason = 'cancelled') {
    assertMutable();
    const record = records.get(materialId);
    if (!record || disposed) return false;
    cancelRecordWork(record, reason);
    record.jobGeneration += 1;
    notifyCancellation();
    return true;
  }

  function retryMaterial(materialId) {
    assertMutable();
    const record = records.get(materialId);
    if (!record || disposed) return false;
    if (!record.admitted) return false;
    markDirty(record, 'explicitRetry');
    notifyCancellation();
    return true;
  }

  function beginSlice(nextFrameId) {
    assertMutable();
    if (!Number.isSafeInteger(nextFrameId) || nextFrameId < 0 || nextFrameId < frameId) {
      throw new RangeError('SSM slice frame IDs must be monotonic nonnegative safe integers');
    }
    if (disposed || nextFrameId === frameId) return false;
    frameId = nextFrameId;
    startsInSlice = 0;
    commitsInSlice = 0;
    return true;
  }

  function takeNextJob() {
    assertMutable();
    if (disposed || suspended || frameId < 0 || pending.size === 0 || running.size !== 0
      || startsInSlice >= ledger.limits.uploadRecordsPerSlice
      || (startsInSlice + 1) * SSM_RECIPE_BYTE_LENGTH > ledger.limits.uploadBytesPerSlice) return null;
    const record = pending.values().next().value;
    pending.delete(record);
    const controller = new AbortController();
    const token = Object.freeze({
      materialId: record.materialId, sourceRevision: record.sourceRevision,
      contextGeneration, projectGeneration, jobGeneration: record.jobGeneration,
      signal: controller.signal,
    });
    record.jobToken = token;
    record.status = 'preparing';
    running.set(token, controller);
    startsInSlice += 1;
    return token;
  }

  function isCurrentJob(token) {
    if (!token || disposed || suspended || !running.has(token) || token.signal.aborted) return false;
    const record = records.get(token.materialId);
    return record?.jobToken === token && record.sourceRevision === token.sourceRevision
      && record.jobGeneration === token.jobGeneration && token.contextGeneration === contextGeneration
      && token.projectGeneration === projectGeneration;
  }

  function settleJob(token, status) {
    running.delete(token);
    const record = records.get(token?.materialId);
    if (record?.jobToken === token) {
      record.jobToken = null;
      record.status = status;
    }
  }

  function completeJob(token, applyAtFrameBoundary) {
    assertMutable();
    if (!isCurrentJob(token)) {
      settleJob(token, 'stale');
      staleJobs += 1;
      return 'stale';
    }
    if (commitsInSlice >= ledger.limits.uploadRecordsPerSlice
      || (commitsInSlice + 1) * SSM_RECIPE_BYTE_LENGTH > ledger.limits.uploadBytesPerSlice) return 'deferred';
    if (typeof applyAtFrameBoundary !== 'function') throw new TypeError('SSM commits require a synchronous transaction');
    committing = true;
    try {
      const transactionType = Object.prototype.toString.call(applyAtFrameBoundary);
      if (transactionType !== '[object Function]') throw new TypeError('SSM commit transactions must be synchronous functions');
      const committed = applyAtFrameBoundary(token);
      if (committed !== true && committed !== false) throw new TypeError('SSM commit transactions must return a boolean');
      settleJob(token, committed ? 'ready' : 'fallback');
      if (!committed) return 'failed';
      commitsInSlice += 1;
      completedJobs += 1;
      return 'committed';
    } catch (error) {
      settleJob(token, 'fallback');
      throw error;
    } finally {
      committing = false;
    }
  }

  function failJob(token, reason = 'preparationFailed') {
    assertMutable();
    const wasCurrent = isCurrentJob(token);
    const controller = running.get(token);
    settleJob(token, wasCurrent ? reason : 'stale');
    controller?.abort(reason);
    return wasCurrent;
  }

  function suspend() {
    assertMutable();
    if (disposed || suspended) return false;
    suspended = true;
    for (const record of records.values()) cancelRecordWork(record, 'suspended');
    notifyCancellation();
    return true;
  }

  function resume(nextContextGeneration = contextGeneration) {
    assertMutable();
    requireRevision(nextContextGeneration);
    if (disposed || (!suspended && nextContextGeneration === contextGeneration)) return false;
    contextGeneration = nextContextGeneration;
    suspended = false;
    for (const record of records.values()) markDirty(record, 'contextChanged');
    notifyCancellation();
    return true;
  }

  function resetProject(nextProjectGeneration) {
    assertMutable();
    requireRevision(nextProjectGeneration);
    if (disposed) return false;
    for (const materialId of records.keys()) removeMaterialRecord(materialId, 'projectChanged');
    projectGeneration = nextProjectGeneration;
    frameId = -1;
    startsInSlice = 0;
    commitsInSlice = 0;
    notifyCancellation();
    return true;
  }

  function dispose() {
    assertMutable();
    if (disposed) return;
    disposed = true;
    for (const materialId of records.keys()) removeMaterialRecord(materialId, 'disposed');
    notifyCancellation();
    for (const controller of running.values()) controller.abort('disposed');
    running.clear();
  }

  function readStatistics() {
    return Object.freeze({
      disposed, suspended, frameId, materialCount: records.size, dependencyCount: dependencyIndex.size,
      pendingJobs: pending.size, runningJobs: running.size, startsInSlice, commitsInSlice,
      uploadBytesInSlice: commitsInSlice * SSM_RECIPE_BYTE_LENGTH,
      invalidations, completedJobs, staleJobs, refusedRegistrations, contextGeneration, projectGeneration,
      memory: ledger.readStatistics(),
    });
  }

  return Object.freeze({
    registerMaterial, updateMaterial, invalidateDependency, unregisterMaterial, cancelMaterial, retryMaterial,
    beginSlice, takeNextJob, isCurrentJob, completeJob, failJob, suspend, resume, resetProject, dispose,
    readStatistics, memoryLedger: ledger,
  });
}
