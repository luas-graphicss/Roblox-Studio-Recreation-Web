export function createMsmMaterialHistoryInvalidation({ targets, invalidation, getClock, requestRender } = {}) {
  if (typeof targets?.invalidate !== 'function' || typeof invalidation?.reset !== 'function'
    || typeof getClock !== 'function') {
    throw new TypeError('The existing MSM targets, invalidation controller and convergence clock are required');
  }
  return function invalidateMaterialHistory() {
    targets.invalidate();
    invalidation.reset();
    getClock().registerDirtyPulse({ reason: 'material-surface-change' });
    requestRender?.();
  };
}
