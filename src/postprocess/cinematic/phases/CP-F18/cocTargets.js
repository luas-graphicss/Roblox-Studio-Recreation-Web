import { COC_LIMITS, COC_OWNER } from "./cocContract.js";

const TARGET_NAMES = Object.freeze(["fullResolution", "reducedRadii", "nearColor", "farColor", "reducedInfo", "tiles", "horizontalTiles", "dilatedTiles"]);

export function createCocTargets(pool, capabilities) {
  const views = new Map();
  function releaseView(viewId) {
    for (const name of TARGET_NAMES) pool.release(`${COC_OWNER}.${encodeURIComponent(viewId)}.${name}`);
    views.delete(viewId);
  }
  return Object.freeze({
    acquire(frame, plan) {
      for (const size of [plan.renderSize, plan.reducedSize, plan.tileGridSize]) if (Math.max(size.width, size.height) > capabilities.maxTextureSize) throw new Error("CoC target exceeds MAX_TEXTURE_SIZE");
      if (!views.has(frame.viewId) && views.size >= COC_LIMITS.maxViews) throw new Error("CoC view capacity exceeded; dispose the installation before replacing views");
      const signature = JSON.stringify([frame.generation, plan.renderSize, plan.reducedSize, plan.tileGridSize]);
      if (views.get(frame.viewId)?.signature === signature) return views.get(frame.viewId).targets;
      const old = views.get(frame.viewId);
      const statistics = pool.stats();
      const requiredBytes = statistics.currentBytes - (old?.bytes ?? 0) + plan.estimatedTargetBytes;
      if (requiredBytes > statistics.budgetBytes) throw new Error(`CoC resource budget exceeded: ${requiredBytes} > ${statistics.budgetBytes}`);
      if (old) releaseView(frame.viewId);
      const targets = {};
      try {
        for (const name of TARGET_NAMES) {
          const size = name === "fullResolution" ? plan.renderSize : ["tiles", "horizontalTiles", "dilatedTiles"].includes(name) ? plan.tileGridSize : plan.reducedSize;
          targets[name] = pool.acquire(COC_OWNER, `${COC_OWNER}.${encodeURIComponent(frame.viewId)}.${name}`, { ...size, format: "rgba16f", filter: "nearest" });
        }
      } catch (error) { releaseView(frame.viewId); throw error; }
      views.set(frame.viewId, { signature, targets: Object.freeze(targets), bytes: plan.estimatedTargetBytes });
      return targets;
    },
    dispose() { for (const viewId of [...views.keys()]) releaseView(viewId); }
  });
}
