import { BRIDGE_OWNER } from "./bridgeContract.js";

const formats = Object.freeze({ color: "rgba16f", coverage: "r16f", reactive: "r16f", velocity: "rgba16f", validation: "rgba8" });

export function createBridgeTargetManager(pool, maxViews) {
  const views = new Map();
  function releaseView(viewId) {
    const view = views.get(viewId);
    if (!view) return;
    for (const key of view.keys) pool.release(key);
    views.delete(viewId);
  }
  function acquire(frame, stage, slot, extent) {
    let view = views.get(frame.viewId);
    if (view && view.generation !== frame.generation) {
      releaseView(frame.viewId);
      view = null;
    }
    if (!view) {
      if (views.size >= maxViews) throw new Error("CP-F27 view budget exceeded; release a view explicitly");
      view = { generation: frame.generation, keys: new Set(), stages: new Map() };
      views.set(frame.viewId, view);
    }
    const signature = `${extent.width}x${extent.height}`;
    const previous = view.stages.get(stage);
    const prefix = `${BRIDGE_OWNER}.targets.${JSON.stringify(frame.viewId)}.${stage}.`;
    if (previous !== signature) {
      for (const key of [...view.keys]) if (key.startsWith(prefix)) { pool.release(key); view.keys.delete(key); }
      view.stages.set(stage, signature);
    }
    const targets = {};
    try {
      for (const [kind, format] of Object.entries(formats)) {
        const key = `${prefix}${slot}.${kind}`;
        targets[kind] = pool.acquire(BRIDGE_OWNER, key, { width: extent.width, height: extent.height, format, filter: "nearest" });
        view.keys.add(key);
      }
    } catch (error) {
      releaseView(frame.viewId);
      throw error;
    }
    return targets;
  }
  return Object.freeze({ acquire, releaseView, dispose() { for (const viewId of [...views.keys()]) releaseView(viewId); } });
}
