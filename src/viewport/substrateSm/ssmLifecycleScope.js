export function createSubstrateSmLifecycleScope({
  canvas,
  contextGeneration = 0,
  projectGeneration = 0,
  onRestore = () => {},
} = {}) {
  if (!canvas?.addEventListener || !canvas?.removeEventListener || typeof onRestore !== 'function') {
    throw new TypeError('SSM_LIFECYCLE_SCOPE_CANVAS_REQUIRED');
  }
  for (const generation of [contextGeneration, projectGeneration]) {
    if (!Number.isSafeInteger(generation) || generation < 0)
      throw new RangeError('SSM_LIFECYCLE_SCOPE_GENERATION_INVALID');
  }
  const entries = new Map();
  let disposed = false;
  let lost = false;
  let callbackFailures = 0;

  function remove(lifecycle) {
    const entry = entries.get(lifecycle);
    if (!entry) return false;
    entry.material?.removeEventListener('dispose', entry.onDispose);
    entries.delete(lifecycle);
    lifecycle.dispose();
    return true;
  }

  function add(lifecycle, material) {
    if (disposed || entries.has(lifecycle)) return false;
    if (
      typeof lifecycle?.suspend !== 'function' ||
      typeof lifecycle.resume !== 'function' ||
      typeof lifecycle.dispose !== 'function' ||
      typeof lifecycle.getState !== 'function'
    )
      throw new TypeError('SSM_LIFECYCLE_SCOPE_CONTROLLER_REQUIRED');
    const generations = lifecycle.getState();
    if (generations.disposed) return false;
    if (
      generations.contextGeneration !== contextGeneration ||
      generations.projectGeneration !== projectGeneration
    ) {
      throw new RangeError('SSM_LIFECYCLE_SCOPE_GENERATION_MISMATCH');
    }
    if (material && (!material.addEventListener || !material.removeEventListener))
      throw new TypeError('SSM_LIFECYCLE_SCOPE_MATERIAL_INVALID');
    const onDispose = () => remove(lifecycle);
    entries.set(lifecycle, { material, onDispose });
    material?.addEventListener('dispose', onDispose);
    if (lost) lifecycle.suspend({ lost: true, reason: 'SSM_LIFECYCLE_CONTEXT_LOST' });
    return true;
  }

  function handleContextLost(event) {
    if (disposed) return;
    event.preventDefault();
    if (lost) return;
    lost = true;
    for (const lifecycle of entries.keys()) {
      try {
        lifecycle.suspend({ lost: true, reason: 'SSM_LIFECYCLE_CONTEXT_LOST' });
      } catch {
        callbackFailures += 1;
      }
    }
  }

  function handleContextRestored() {
    if (disposed || !lost) return;
    if (!Number.isSafeInteger(contextGeneration + 1)) {
      callbackFailures += 1;
      return;
    }
    contextGeneration += 1;
    lost = false;
    for (const lifecycle of entries.keys()) {
      try {
        lifecycle.resume({ contextGeneration, projectGeneration });
      } catch {
        callbackFailures += 1;
      }
    }
    try {
      onRestore(Object.freeze({ contextGeneration, projectGeneration, requiresFreshAdmission: true }));
    } catch {
      callbackFailures += 1;
    }
  }

  function resetProject(nextProjectGeneration) {
    if (!Number.isSafeInteger(nextProjectGeneration) || nextProjectGeneration <= projectGeneration) {
      throw new RangeError('SSM_LIFECYCLE_PROJECT_GENERATION_MUST_ADVANCE');
    }
    if (disposed) return false;
    for (const lifecycle of entries.keys()) remove(lifecycle);
    projectGeneration = nextProjectGeneration;
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('webglcontextlost', handleContextLost);
    canvas.removeEventListener('webglcontextrestored', handleContextRestored);
    for (const lifecycle of entries.keys()) remove(lifecycle);
  }

  function getState() {
    return Object.freeze({
      disposed,
      lost,
      contextGeneration,
      projectGeneration,
      controllers: entries.size,
      callbackFailures,
    });
  }

  canvas.addEventListener('webglcontextlost', handleContextLost);
  canvas.addEventListener('webglcontextrestored', handleContextRestored);
  return Object.freeze({ add, remove, resetProject, dispose, getState });
}
