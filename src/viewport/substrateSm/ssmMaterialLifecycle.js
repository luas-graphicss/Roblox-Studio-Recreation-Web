import {
  createSubstrateSmLifecycleIdentity,
  sameSubstrateSmLifecycleIdentity,
  estimateSubstrateSmIdentityBytes,
} from '../../lighting/substrateSm/ssmLifecycleIdentity.js';
import {
  requireSubstrateSmSynchronousCallback,
  inspectSubstrateSmLifecycleTransaction,
  verifySubstrateSmLifecycleProof,
} from './ssmLifecycleTransaction.js';

export function createSubstrateSmMaterialLifecycle({
  scheduler,
  residency,
  adapter,
  contextGeneration = 0,
  projectGeneration = 0,
  enabled = false,
  now = () => performance.now(),
} = {}) {
  if (!scheduler?.enqueue || !residency?.reserve || typeof now !== 'function')
    throw new TypeError('SSM_LIFECYCLE_SERVICES_REQUIRED');
  requireSubstrateSmSynchronousCallback(now, 'CLOCK');
  for (const method of ['admit', 'createTransaction', 'restore'])
    requireSubstrateSmSynchronousCallback(adapter?.[method], method);
  for (const generation of [contextGeneration, projectGeneration]) {
    if (!Number.isSafeInteger(generation) || generation < 0)
      throw new RangeError('SSM_LIFECYCLE_GENERATION_INVALID');
  }
  if (typeof enabled !== 'boolean' || scheduler.plan.profile !== residency.profile)
    throw new TypeError('SSM_LIFECYCLE_CONFIGURATION_INVALID');
  const metadataOwner = Object.freeze({});
  const metadataCost = (cpuCacheBytes) => ({ residentRecipes: 0, numericBufferBytes: 0, cpuCacheBytes });
  if (!residency.memoryLedger.reserve(metadataOwner, metadataCost(512)))
    throw new Error('SSM_LIFECYCLE_METADATA_BUDGET');
  const retired = new Set();
  const counters = {
    requests: 0,
    preparations: 0,
    commits: 0,
    cancellations: 0,
    failures: 0,
    cachedRefusals: 0,
    staleRequests: 0,
    releaseFailures: 0,
    timeouts: 0,
    warmupSteps: 0,
  };
  let pending = null;
  let active = null;
  let latestIdentity = null;
  let failedIdentity = null;
  let state = 'dormant';
  let reason = null;
  let disposed = false;
  let suspended = false;
  let contextLost = false;
  let insideCallback = false;
  let hostRestored = true;
  let lastBudgetGeneration = -1;

  function requireMutable() {
    if (insideCallback) throw new Error('SSM_LIFECYCLE_REENTRANT_MUTATION');
  }

  function invoke(callback, receiver, ...argumentsList) {
    if (insideCallback) throw new Error('SSM_LIFECYCLE_REENTRANT_CALLBACK');
    insideCallback = true;
    try {
      const result = callback.apply(receiver, argumentsList);
      if (result && typeof result.then === 'function')
        throw new TypeError('SSM_LIFECYCLE_ASYNC_CALLBACK_REFUSED');
      return result;
    } finally {
      insideCallback = false;
    }
  }

  function restoreCurrent() {
    try {
      hostRestored = invoke(adapter.restore, adapter, active?.transaction ?? null) === true;
    } catch {
      hostRestored = false;
    }
    return hostRestored;
  }

  function releaseJob(job, nextReason) {
    if (!job || job.released) return true;
    job.controller.abort(nextReason);
    try {
      if (
        job.transaction &&
        invoke(
          job.transaction.release,
          job.transaction,
          Object.freeze({ reason: nextReason, contextLost }),
        ) !== true
      )
        throw new Error('SSM_LIFECYCLE_RELEASE_INCOMPLETE');
      residency.release(job.owner);
      retired.delete(job);
      job.released = true;
      job.transaction = null;
      return true;
    } catch {
      counters.releaseFailures += 1;
      retired.add(job);
      return false;
    }
  }

  function cancelPending(nextReason) {
    if (!pending) return false;
    const previous = pending;
    pending = null;
    scheduler.cancel(metadataOwner);
    previous.controller.abort(nextReason);
    releaseJob(previous, nextReason);
    counters.cancellations += 1;
    return true;
  }

  function failPending(error) {
    if (!pending) return;
    const failed = pending;
    pending = null;
    scheduler.cancel(metadataOwner);
    failedIdentity = failed.identity;
    reason = String(error?.message || error || 'SSM_LIFECYCLE_PREPARATION_FAILED').slice(0, 512);
    state = 'fallback';
    counters.failures += 1;
    failed.controller.abort(reason);
    if (restoreCurrent()) releaseJob(failed, reason);
    else {
      retired.add(failed);
      reason = 'SSM_LIFECYCLE_HOST_RESTORE_FAILED';
    }
  }

  function advancePending(frame) {
    const job = pending;
    if (!job || disposed || suspended || !enabled) return true;
    if (
      job.controller.signal.aborted ||
      job.identity.contextGeneration !== contextGeneration ||
      job.identity.projectGeneration !== projectGeneration ||
      !sameSubstrateSmLifecycleIdentity(job.identity, latestIdentity)
    ) {
      failPending(new Error('SSM_LIFECYCLE_STALE_JOB'));
      return true;
    }
    if (frame.nowMs < job.startedAt || frame.nowMs - job.startedAt > scheduler.plan.timeoutMs) {
      counters.timeouts += 1;
      failPending(new Error('SSM_LIFECYCLE_WARMUP_TIMEOUT'));
      return true;
    }
    const stage = scheduler.plan.stages[job.stageIndex];
    const context = Object.freeze({ ...frame, identity: job.identity, signal: job.controller.signal });
    counters.warmupSteps += 1;
    try {
      if (stage === 'commit') {
        if (frame.frameId <= job.readyFrame) throw new Error('SSM_LIFECYCLE_COMMIT_BOUNDARY_REQUIRED');
        if (
          invoke(job.transaction.activate, job.transaction, active?.transaction ?? null, context) !== true
        ) {
          throw new Error('SSM_LIFECYCLE_COMMIT_FAILED');
        }
        const previous = active;
        active = job;
        pending = null;
        hostRestored = true;
        state = 'active';
        reason = null;
        counters.commits += 1;
        releaseJob(previous, 'SSM_LIFECYCLE_REPLACED');
        return true;
      }
      const result = invoke(job.transaction[stage], job.transaction, context);
      if (stage === 'link' && result === false) {
        job.pollFrames += 1;
        if (job.pollFrames >= scheduler.plan.maxPollFrames) throw new Error('SSM_LIFECYCLE_LINK_TIMEOUT');
        return false;
      }
      if (stage === 'verify') {
        verifySubstrateSmLifecycleProof(result, job.identity);
        job.readyFrame = frame.frameId;
        state = 'ready';
      } else if (result !== true) throw new Error(`SSM_LIFECYCLE_${stage.toUpperCase()}_FAILED`);
      job.stageIndex += 1;
      return false;
    } catch (error) {
      failPending(error);
      return true;
    }
  }

  const scheduledWork = Object.freeze({ step: advancePending, onError: failPending });

  function request(input = {}) {
    requireMutable();
    if (disposed || suspended || !enabled) return false;
    counters.requests += 1;
    const identity = createSubstrateSmLifecycleIdentity(input.identity);
    if (
      identity.contextGeneration !== contextGeneration ||
      identity.projectGeneration !== projectGeneration ||
      (latestIdentity && identity.jobGeneration < latestIdentity.jobGeneration) ||
      (latestIdentity &&
        identity.jobGeneration === latestIdentity.jobGeneration &&
        !sameSubstrateSmLifecycleIdentity(identity, latestIdentity))
    ) {
      counters.staleRequests += 1;
      return false;
    }
    if (sameSubstrateSmLifecycleIdentity(identity, failedIdentity) && input.retry !== true) {
      counters.cachedRefusals += 1;
      return false;
    }
    if (
      sameSubstrateSmLifecycleIdentity(identity, pending?.identity) ||
      sameSubstrateSmLifecycleIdentity(identity, active?.identity)
    )
      return false;
    const controlBytes = 512 + estimateSubstrateSmIdentityBytes(identity) * 2;
    if (!residency.memoryLedger.reserve(metadataOwner, metadataCost(controlBytes))) {
      reason = 'SSM_LIFECYCLE_METADATA_BUDGET';
      return false;
    }
    cancelPending('SSM_LIFECYCLE_SUPERSEDED');
    latestIdentity = identity;
    failedIdentity = null;
    reason = null;
    let admission;
    try {
      admission = invoke(adapter.admit, adapter, input, identity);
    } catch (error) {
      admission = { eligible: false, code: error.message };
    }
    if (
      admission?.eligible !== true ||
      admission.contextGeneration !== identity.contextGeneration ||
      admission.sourceRevision !== identity.sourceRevision
    ) {
      disable(admission?.code || 'SSM_LIFECYCLE_ADMISSION_REFUSED');
      latestIdentity = identity;
      failedIdentity = identity;
      return false;
    }
    const owner = Object.freeze({});
    let reserved = false;
    try {
      reserved = residency.reserve(owner, {
        cost: input.cost,
        programKey: identity.programKey,
        contextGeneration,
      });
    } catch (error) {
      reason = error.message;
    }
    if (!reserved) {
      failedIdentity = identity;
      state = 'fallback';
      reason = reason || 'SSM_LIFECYCLE_PEAK_BUDGET_REFUSED';
      return false;
    }
    const job = {
      owner,
      identity,
      startedAt: 0,
      controller: new AbortController(),
      transaction: null,
      stageIndex: 0,
      pollFrames: 0,
      readyFrame: -1,
      released: false,
    };
    pending = job;
    state = 'preparing';
    reason = null;
    try {
      job.startedAt = invoke(now, null);
      if (!Number.isFinite(job.startedAt) || job.startedAt < 0) throw new Error('SSM_LIFECYCLE_TIME_INVALID');
      job.transaction = invoke(
        adapter.createTransaction,
        adapter,
        input,
        Object.freeze({ identity, signal: job.controller.signal }),
      );
      inspectSubstrateSmLifecycleTransaction(job.transaction);
      if (!scheduler.enqueue(metadataOwner, scheduledWork)) throw new Error('SSM_LIFECYCLE_QUEUE_FULL');
      counters.preparations += 1;
      return true;
    } catch (error) {
      failPending(error);
      return false;
    }
  }

  function cancel(nextReason = 'SSM_LIFECYCLE_CANCELLED') {
    requireMutable();
    const cancelled = cancelPending(nextReason);
    if (cancelled) {
      state = active ? 'active' : 'fallback';
      reason = nextReason;
    }
    return cancelled;
  }

  function disable(nextReason = 'SSM_LIFECYCLE_DISABLED') {
    requireMutable();
    if (disposed) return false;
    cancelPending(nextReason);
    const previous = active;
    active = null;
    if (restoreCurrent()) releaseJob(previous, nextReason);
    else if (previous) retired.add(previous);
    state = 'fallback';
    reason = hostRestored ? nextReason : 'SSM_LIFECYCLE_HOST_RESTORE_FAILED';
    return hostRestored;
  }

  function setEnabled(nextEnabled) {
    requireMutable();
    if (typeof nextEnabled !== 'boolean') throw new TypeError('SSM_LIFECYCLE_ENABLED_BOOLEAN_REQUIRED');
    if (disposed || nextEnabled === enabled) return false;
    enabled = nextEnabled;
    if (!enabled) disable();
    else if (!suspended) {
      latestIdentity = null;
      failedIdentity = null;
      state = 'dormant';
      reason = null;
    }
    return true;
  }

  function suspend({ lost = false, reason: nextReason = 'SSM_LIFECYCLE_SUSPENDED' } = {}) {
    requireMutable();
    if (disposed) return false;
    contextLost = contextLost || lost === true;
    disable(nextReason);
    suspended = true;
    state = 'suspended';
    return true;
  }

  function resume({
    contextGeneration: nextContextGeneration = contextGeneration,
    projectGeneration: nextProjectGeneration = projectGeneration,
  } = {}) {
    requireMutable();
    for (const generation of [nextContextGeneration, nextProjectGeneration]) {
      if (!Number.isSafeInteger(generation) || generation < 0)
        throw new RangeError('SSM_LIFECYCLE_GENERATION_INVALID');
    }
    if (
      disposed ||
      !suspended ||
      nextContextGeneration < contextGeneration ||
      nextProjectGeneration < projectGeneration ||
      (contextLost && nextContextGeneration <= contextGeneration)
    )
      return false;
    contextGeneration = nextContextGeneration;
    projectGeneration = nextProjectGeneration;
    contextLost = false;
    suspended = false;
    latestIdentity = null;
    failedIdentity = null;
    state = 'dormant';
    reason = null;
    return true;
  }

  function applyBudgetDecision(decision) {
    requireMutable();
    if (
      !decision ||
      !Number.isSafeInteger(decision.generation) ||
      decision.generation <= lastBudgetGeneration
    )
      return false;
    lastBudgetGeneration = decision.generation;
    if (decision.changed !== true || !decision.cut) return false;
    cancelPending('SSM_LIFECYCLE_GLOBAL_BUDGET_PRESSURE');
    disable(`SSM_LIFECYCLE_PRESSURE_${decision.cut}`);
    failedIdentity = latestIdentity;
    return true;
  }

  function retryRetiredResources() {
    requireMutable();
    if (!restoreCurrent()) return false;
    for (const job of retired) releaseJob(job, 'SSM_LIFECYCLE_RETRY_RELEASE');
    if (disposed && retired.size === 0) residency.memoryLedger.release(metadataOwner);
    return retired.size === 0;
  }

  function dispose() {
    requireMutable();
    if (disposed) return;
    disable('SSM_LIFECYCLE_DISPOSED');
    disposed = true;
    state = 'disposed';
    latestIdentity = null;
    failedIdentity = null;
    if (retired.size === 0) residency.memoryLedger.release(metadataOwner);
  }

  function getState() {
    return Object.freeze({
      state,
      reason,
      disposed,
      suspended,
      enabled,
      contextLost,
      applied: active !== null && hostRestored,
      backend: active && hostRestored ? 'substrateSm' : 'host',
      sourceRevision: latestIdentity?.sourceRevision ?? null,
      activeSourceRevision: active?.identity.sourceRevision ?? null,
      contextGeneration,
      projectGeneration,
      programKey: active?.identity.programKey ?? null,
      requestedIdentity: latestIdentity,
      activeIdentity: active?.identity ?? null,
      warmupStage: pending ? scheduler.plan.stages[pending.stageIndex] : null,
      retainedRetirements: retired.size,
      counters: Object.freeze({ ...counters }),
    });
  }

  return Object.freeze({
    request,
    cancel,
    disable,
    setEnabled,
    suspend,
    resume,
    applyBudgetDecision,
    retryRetiredResources,
    dispose,
    getState,
  });
}
