import { createLightPartition } from '../lighting/megalightsSm/msmPartitionCore.js';
import { MSM_PARTITION_ACTION } from '../lighting/megalightsSm/msmGridDirtyCore.js';

export function createMsmNativePartitionFeed() {
  const partition = createLightPartition({ resolveCapacity: source => ({
    capacity: source.nativeCapacity, refused: false,
    reason: 'Authoritative native shadow budget, after all material sampler charges',
  }) });
  let enabled = false, fingerprint = '', lastPlan = null, pending = false;
  const residents = new Set();
  function update(candidates, budget, active, nowMs) {
    if (!active) {
      if (enabled) partition.reset();
      enabled = false; residents.clear(); fingerprint = ''; lastPlan = null; pending = false;
      return null;
    }
    enabled = true;
    const fixed = candidates.filter(entry => entry.kind !== 'PointLight' && entry.kind !== 'SpotLight')
      .sort((a, b) => a.__dist2 - b.__dist2).slice(0, budget);
    const lights = candidates.filter(entry => entry.kind === 'PointLight' || entry.kind === 'SpotLight').map(entry => {
      const color = entry.light.color;
      return { id: entry.light.uuid, priority: Math.max(0, entry.light.intensity *
        (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / (1 + entry.__dist2)) };
    });
    const nextFingerprint = JSON.stringify([budget, fixed.map(entry => entry.light.uuid), lights]);
    if (nextFingerprint !== fingerprint || pending) {
      lastPlan = partition.evaluate({ nowMs, lights, nativeCapacity: Math.max(0, budget - fixed.length),
        partitionAction: nextFingerprint !== fingerprint ? MSM_PARTITION_ACTION.REEVALUATE_PULSED : MSM_PARTITION_ACTION.REEVALUATE_SLICED });
      fingerprint = nextFingerprint;
      pending = lastPlan.pendingPromotionCount + lastPlan.pendingDemotionCount > 0;
      residents.clear();
      for (const id of lastPlan.resident) residents.add(id);
      for (const entry of fixed) residents.add(entry.light.uuid);
    }
    candidates.sort((a, b) => Number(residents.has(b.light.uuid)) - Number(residents.has(a.light.uuid)) || a.__dist2 - b.__dist2);
    return residents;
  }
  return { update, describe: () => ({ enabled, pending, lastPlan, stats: partition.stats() }) };
}
