function writeSourceEntries(entries, selectSource) {
  const changes = [];
  try {
    for (const entry of entries) {
      if (entry.instance.isDestroyed()) continue;
      const currentSource = entry.instance.getProperty('SubstrateMaterial');
      const nextSource = selectSource(entry);
      if (Object.is(currentSource, nextSource)) continue;
      changes.push({ instance: entry.instance, source: currentSource });
      const accepted = entry.instance.setProperty('SubstrateMaterial', nextSource);
      if (accepted !== true || !Object.is(entry.instance.getProperty('SubstrateMaterial'), nextSource)) {
        throw new Error('Authored source write was refused.');
      }
    }
    return true;
  } catch {
    for (const previous of changes.reverse()) {
      try {
        if (!previous.instance.isDestroyed()) previous.instance.setProperty('SubstrateMaterial', previous.source);
      } catch {
        continue;
      }
    }
    return false;
  }
}

export function createSubstrateSourceEdit(source, targets) {
  if (typeof source !== 'string') {
    return { ok: false, changed: false, count: 0, reason: 'Authored material source must be text.' };
  }
  const liveTargets = [...new Set(targets || [])].filter(instance =>
    instance && typeof instance.isDestroyed === 'function'
      && !instance.isDestroyed() && instance.hasProperty('SubstrateMaterial'));
  if (!liveTargets.length) {
    return { ok: false, changed: false, count: 0, reason: 'Select a Part, MeshPart or SurfaceAppearance first.' };
  }
  const entries = liveTargets.map(instance => ({ instance, source: instance.getProperty('SubstrateMaterial') }));
  const changed = entries.some(entry => entry.source !== source);
  return {
    ok: true,
    changed,
    count: entries.length,
    reason: null,
    command: changed ? {
      name: source ? 'Apply Substrate authored source' : 'Inherit scene material',
      do: () => writeSourceEntries(entries, () => source),
      undo: () => writeSourceEntries(entries, entry => entry.source),
    } : null,
  };
}
