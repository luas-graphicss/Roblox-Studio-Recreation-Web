import { createCompileSlicer } from '../../lighting/warmupSliceCore.js';
import { createSubstrateSmWarmupPlan } from '../../lighting/substrateSm/ssmWarmupPlanCore.js';
import { requireSubstrateSmSynchronousCallback } from './ssmLifecycleTransaction.js';

export function createSubstrateSmWarmupScheduler({
  plan = createSubstrateSmWarmupPlan(),
  now = () => performance.now(),
} = {}) {
  requireSubstrateSmSynchronousCallback(now, 'CLOCK');
  plan = createSubstrateSmWarmupPlan(plan);
  const slicer = createCompileSlicer({ budgetMs: plan.budgetMs, minPerFrame: 1, maxPerFrame: 1 });
  const pending = new Map();
  let frameId = -1;
  let active = null;
  let disposed = false;
  let operations = 0;
  let failures = 0;
  let worstOperationMs = 0;

  function readClock() {
    const value = now();
    if (!Number.isFinite(value) || value < 0) throw new RangeError('SSM_SCHEDULER_CLOCK_INVALID');
    return value;
  }

  function enqueue(owner, work) {
    if (!owner) throw new TypeError('SSM_SCHEDULER_OWNER_REQUIRED');
    requireSubstrateSmSynchronousCallback(work?.step, 'STEP');
    requireSubstrateSmSynchronousCallback(work?.onError, 'ERROR_HANDLER');
    if (disposed || pending.has(owner) || active?.owner === owner) return false;
    if (pending.size + Number(active !== null) >= plan.maxPendingJobs) return false;
    pending.set(owner, { owner, work, cancelled: false });
    return true;
  }

  function cancel(owner) {
    const removed = pending.delete(owner);
    if (active?.owner === owner) active.cancelled = true;
    return removed;
  }

  function advanceFrame({ frameId: nextFrameId, atFrameBoundary = false, workAllowed = true, nowMs } = {}) {
    if (disposed || pending.size === 0 || atFrameBoundary !== true || workAllowed !== true) return 0;
    if (active) throw new Error('SSM_SCHEDULER_REENTRANT_FRAME');
    if (!Number.isSafeInteger(nextFrameId) || nextFrameId < 0 || nextFrameId < frameId)
      throw new RangeError('SSM_SCHEDULER_FRAME_INVALID');
    if (nextFrameId === frameId) return 0;
    frameId = nextFrameId;
    const entry = pending.values().next().value;
    pending.delete(entry.owner);
    active = entry;
    let completed = true;
    let workError = null;
    let performed = 0;
    try {
      const timestamp = nowMs ?? readClock();
      if (!Number.isFinite(timestamp) || timestamp < 0) throw new RangeError('SSM_SCHEDULER_TIME_INVALID');
      slicer.arm([entry], timestamp);
      const slice = slicer.tick(() => {
        try {
          performed = 1;
          completed = entry.work.step(Object.freeze({ frameId, nowMs: timestamp, atFrameBoundary: true }));
          if (typeof completed !== 'boolean') throw new TypeError('SSM_SCHEDULER_STEP_MUST_BE_SYNCHRONOUS');
        } catch (error) {
          workError = error;
          completed = true;
        }
        return { yieldFrame: true };
      }, readClock);
      worstOperationMs = Math.max(worstOperationMs, slice.spentMs);
    } catch (error) {
      workError = error;
      completed = true;
    }
    operations += performed;
    try {
      if (workError) {
        failures += 1;
        try {
          entry.work.onError(workError);
        } catch {
          failures += 1;
        }
      }
    } finally {
      active = null;
      if (!disposed && !entry.cancelled && !completed) pending.set(entry.owner, entry);
    }
    return performed;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (active) active.cancelled = true;
    for (const entry of pending.values()) {
      try {
        entry.work.onError(new Error('SSM_SCHEDULER_DISPOSED'));
      } catch {
        failures += 1;
      }
    }
    pending.clear();
    slicer.cancel();
  }

  function readStatistics() {
    return Object.freeze({
      disposed,
      frameId,
      pendingJobs: pending.size + Number(active !== null),
      operations,
      failures,
      worstOperationMs,
      plan,
    });
  }

  return Object.freeze({ plan, enqueue, cancel, advanceFrame, dispose, readStatistics });
}
