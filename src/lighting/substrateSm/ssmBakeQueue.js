import { createSubstrateSmRecipeKey } from './ssmRecipeKeys.js';
import { SSM_ORM_BAKE_ADAPTER } from './ssmOrmBakeAdapter.js';

const ignoredPreparation = Object.freeze({ status: 'ignored' });

export function createSubstrateSmBakeQueue({ dirtyQueue, textureCache, loadPixels, createTexture, yieldControl,
  bakeAdapter = SSM_ORM_BAKE_ADAPTER } = {}) {
  if (!dirtyQueue?.isCurrentJob || !textureCache?.reserve || typeof loadPixels !== 'function' || typeof createTexture !== 'function') {
    throw new TypeError('Bake queues require the F07 dirty queue, shared cache and explicit asset/upload providers');
  }
  if (textureCache.memoryLedger.recipeMemoryLedger !== dirtyQueue.memoryLedger) {
    throw new Error('Bake, dirty queue and recipe cache must share the same F07 CPU ledger');
  }
  if (!bakeAdapter || ['accepts', 'memory', 'bake'].some(name => typeof bakeAdapter[name] !== 'function')) {
    throw new TypeError('Bake adapters require plan admission, peak accounting and a baker');
  }
  const adapter = Object.freeze({ accepts: bakeAdapter.accepts, memory: bakeAdapter.memory, bake: bakeAdapter.bake });
  let active = null;
  let disposed = false;
  let committing = false;
  let preparedJobs = 0;
  let failedJobs = 0;
  let discardedJobs = 0;

  function current(job) {
    return !disposed && active === job && dirtyQueue.isCurrentJob(job.token);
  }

  function acknowledgeFailure(job, reason) {
    if (job.lease) job.lease.release();
    job.ticket?.cancel();
    dirtyQueue.failJob(job.token, reason);
    if (active === job) active = null;
  }

  async function prepare({ token, plan, sourceKey, compilerVersion = 1, geometry = {} }) {
    if (committing) throw new Error('Bake preparation cannot reenter a commit');
    if (disposed || active || !dirtyQueue.isCurrentJob(token)) return ignoredPreparation;
    let admitted = false;
    try { admitted = adapter.accepts(plan) === true; } catch {}
    if (!admitted || token.contextGeneration !== plan?.contextGeneration
      || plan.profile !== textureCache.memoryLedger.profile) {
      dirtyQueue.failJob(token, 'SSM_BAKE_PLAN_INVALID');
      return Object.freeze({ status: 'fallback', reason: 'SSM_BAKE_PLAN_INVALID' });
    }
    const job = { token, plan, key: null, lease: null, ticket: null, ready: false };
    active = job;
    let resource = null;
    try {
      job.key = createSubstrateSmRecipeKey({ sourceKey, profile: plan.profile, compilerVersion, mapPlan: plan.keyDescriptor, geometry });
      job.lease = textureCache.acquire(job.key, token.contextGeneration);
      if (!job.lease) {
        job.ticket = textureCache.reserve(job.key, token.contextGeneration, adapter.memory(plan));
        if (!job.ticket) throw new Error('SSM_BAKE_PEAK_BUDGET_UNAVAILABLE');
        const baked = await adapter.bake({ plan,
          loadPixels, signal: token.signal, ...(yieldControl ? { yieldControl } : {}) });
        if (!current(job)) throw new Error('SSM_BAKE_STALE');
        resource = await createTexture(baked, { signal: token.signal, contextGeneration: token.contextGeneration });
        if (!current(job)) throw new Error('SSM_BAKE_STALE');
        job.lease = job.ticket.publish(resource);
        if (!job.lease) throw new Error('SSM_BAKE_PUBLICATION_REFUSED');
        resource = null;
      }
      if (!current(job) || !job.lease.isValid()) throw new Error('SSM_BAKE_STALE');
      job.ready = true;
      preparedJobs += 1;
      return Object.freeze({ status: 'ready', key: job.key });
    } catch (error) {
      const stale = !current(job);
      if (stale) discardedJobs += 1; else failedJobs += 1;
      let cleanupError = null;
      if (resource?.dispose) { try { resource.dispose(); } catch (failure) { cleanupError = failure; } }
      acknowledgeFailure(job, stale ? 'SSM_BAKE_STALE' : 'SSM_BAKE_FAILED');
      return Object.freeze({ status: stale ? 'stale' : 'fallback', reason: String(error?.message ?? error),
        cleanupError: cleanupError ? String(cleanupError.message) : null });
    }
  }

  function commitReady(applyAtFrameBoundary) {
    if (committing) throw new Error('Bake commits cannot reenter');
    const job = active;
    if (!job?.ready) return 'idle';
    if (!current(job) || !job.lease.isValid()) {
      discardedJobs += 1;
      acknowledgeFailure(job, 'SSM_BAKE_STALE');
      return 'stale';
    }
    if (typeof applyAtFrameBoundary !== 'function' || Object.prototype.toString.call(applyAtFrameBoundary) !== '[object Function]') {
      throw new TypeError('Baked texture commits must be synchronous');
    }
    committing = true;
    let result;
    try {
      result = dirtyQueue.completeJob(job.token, () => {
        const accepted = applyAtFrameBoundary(Object.freeze({ lease: job.lease, plan: job.plan, key: job.key }));
        if (accepted !== true && accepted !== false) throw new TypeError('Baked texture commits must return boolean');
        return accepted;
      });
    } finally {
      committing = false;
      if (result !== 'deferred') {
        if (result !== 'committed') job.lease.release();
        active = null;
      }
    }
    return result;
  }

  function cancel() {
    if (committing) throw new Error('Bake cancellation cannot reenter a commit');
    const job = active;
    if (!job) return false;
    if (dirtyQueue.isCurrentJob(job.token)) dirtyQueue.cancelMaterial(job.token.materialId, 'SSM_BAKE_CANCELLED');
    if (job.ready) acknowledgeFailure(job, 'SSM_BAKE_CANCELLED');
    return true;
  }

  function dispose() {
    if (disposed) return;
    cancel();
    disposed = true;
  }

  return Object.freeze({ prepare, commitReady, cancel, dispose,
    readStatistics: () => Object.freeze({ disposed, busy: active !== null, ready: active?.ready === true,
      preparedJobs, failedJobs, discardedJobs }) });
}
