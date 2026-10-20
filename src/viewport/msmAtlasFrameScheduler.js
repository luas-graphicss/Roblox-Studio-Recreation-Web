import { createAtlasPageScheduler } from '../lighting/megalightsSm/msmAtlasScheduleCore.js';
import { resolveMsmViewportSettings } from '../lighting/megalightsSm/msmViewportSettingsCore.js';
export function resolveMsmAtlasScheduleRequest(state, casterRevision, overrides = {}) {
  const decision = resolveMsmViewportSettings(state, overrides);
  return { enabled: decision.awake && decision.strength > 0 && decision.phases.atlas !== false,
    tier: decision.tier, casterRevision,
    pagesPerFrame: overrides.runtimeQuality?.tier === decision.tier ? overrides.runtimeQuality.atlasPagesPerFrame : undefined };
}
export function createMsmAtlasFrameScheduler() {
  let scheduler = null, currentTier = '', generation = null;
  const fingerprints = new Map();
  let lastPlan = null;
  function reset() { scheduler = null; currentTier = ''; generation = null; fingerprints.clear(); lastPlan = null; }
  function plan({ request, placements, spotById, cubeFaceById, rankById, lights, atlasTarget }) {
    if (!request?.enabled) { reset(); return null; }
    if (!scheduler || currentTier !== request.tier || generation !== atlasTarget) {
      scheduler = createAtlasPageScheduler({ tier: request.tier });
      currentTier = request.tier; generation = atlasTarget; fingerprints.clear();
    }
    scheduler.setBudgetOverride(request.pagesPerFrame ?? null);
    const pages = [], changed = [], seen = new Set();
    for (const placed of placements) {
      const spot = spotById.get(placed.id), face = cubeFaceById.get(placed.id);
      const light = lights[rankById.get(placed.id)];
      const descriptor = face
        ? [face.x, face.y, face.z, face.forwardX, face.forwardY, face.forwardZ,
          face.upX, face.upY, face.upZ, face.range, face.halfAngleRad]
        : [spot?.position.x, spot?.position.y, spot?.position.z,
          spot?.target?.position.x, spot?.target?.position.y, spot?.target?.position.z,
          spot?.angle, light?.range, spot?.distance];
      const fingerprint = JSON.stringify([placed.x, placed.y, placed.res, request.casterRevision, ...descriptor]);
      if (fingerprints.get(placed.id) !== fingerprint) changed.push(placed.id);
      fingerprints.set(placed.id, fingerprint); seen.add(placed.id);
      pages.push({ pageKey: placed.id, lightId: face?.lightId || placed.id,
        importance: Math.max(0, placements.length - (rankById.get(placed.id) ?? placements.length)) });
    }
    for (const id of fingerprints.keys()) if (!seen.has(id)) fingerprints.delete(id);
    scheduler.syncPages(pages); scheduler.invalidatePages(changed);
    lastPlan = scheduler.planFrame();
    const selected = new Set(lastPlan.pageKeys), pending = new Set(scheduler.pendingPageKeys());
    return { selected, pending, pendingCount: pending.size,

      canPublish: id => !pending.has(id), shouldRender: id => selected.has(id) };
  }
  function rejectDraws(pageKeys) {
    if (!scheduler) return;
    scheduler.invalidatePages(Array.from(pageKeys));
    for (const key of pageKeys) fingerprints.delete(key);
    if (lastPlan) lastPlan = { ...lastPlan, pendingAfter: scheduler.pendingPageKeys().length };
  }
  return { plan, reset, rejectDraws,
    describe: () => lastPlan ? { ...lastPlan, coverage: scheduler.coverageReport() } : null };
}
