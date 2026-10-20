function requireRevision(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}

export function createSubstrateSmMsmHistoryBridge({ invalidation } = {}) {
  if (typeof invalidation?.reset !== 'function') {
    throw new TypeError('The existing MSM frame invalidation controller is required');
  }
  let revisionsByMaterial = new WeakMap();

  function commit(material, { reflectanceRevision, normalRevision, contextGeneration, mode } = {}) {
    if (!material || typeof material !== 'object') throw new TypeError('A material identity is required');
    requireRevision(reflectanceRevision, 'Reflectance revision');
    requireRevision(normalRevision, 'Normal revision');
    requireRevision(contextGeneration, 'Context generation');
    if (!['OFF', 'A', 'B'].includes(mode)) throw new RangeError('An explicit MSM mode is required');
    const previous = revisionsByMaterial.get(material);
    const changed = !previous || previous.reflectanceRevision !== reflectanceRevision
      || previous.normalRevision !== normalRevision || previous.contextGeneration !== contextGeneration;
    const modeChanged = previous?.mode !== mode;
    const invalidated = mode !== 'OFF' && (changed || modeChanged);
    if (invalidated) invalidation.reset();
    revisionsByMaterial.set(material, { reflectanceRevision, normalRevision, contextGeneration, mode });
    return Object.freeze({ changed, invalidated, historyOwner: 'MSM', addedHistories: 0 });
  }

  function release(material) {
    return revisionsByMaterial.delete(material);
  }

  function clear() {
    revisionsByMaterial = new WeakMap();
  }

  return Object.freeze({ commit, release, clear });
}
