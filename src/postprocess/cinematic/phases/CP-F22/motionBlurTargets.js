import { MOTION_BLUR_OWNER } from "./motionBlurContract.js";

export function createMotionBlurTargets(pool) {
  const views = new Map();
  function releaseView(viewId) {
    const entry = views.get(viewId);
    if (!entry) return;
    for (const key of entry.keys) pool.release(key);
    views.delete(viewId);
  }
  function prepare(viewId, plan) {
    const signature = `${plan.size.width}:${plan.size.height}:${plan.shutter.active}`;
    const previous = views.get(viewId);
    if (
      views.size > plan.settings.maximumViews ||
      (!previous && views.size >= plan.settings.maximumViews)
    )
      throw new RangeError(
        "CP-F22 live view limit exceeded; release the previous view first",
      );
    const otherBytes = [...views.entries()].reduce(
      (sum, [id, value]) => sum + (id === viewId ? 0 : value.bytes),
      0,
    );
    if (otherBytes + plan.bytes > plan.settings.maximumBytes)
      throw new RangeError("CP-F22 combined view target budget exceeded");
    if (previous?.signature === signature) return previous;
    releaseView(viewId);
    const entry = { signature, keys: [], bytes: plan.bytes, targets: {} };
    views.set(viewId, entry);
    const sizes = plan.shutter.active
      ? {
          color: plan.size,
          flattened: plan.size,
          tiles: plan.tiles,
          neighbors: plan.tiles,
        }
      : { color: plan.size };
    try {
      for (const [name, size] of Object.entries(sizes)) {
        const key = `${MOTION_BLUR_OWNER}.${encodeURIComponent(viewId)}.${name}`;
        entry.targets[name] = pool.acquire(MOTION_BLUR_OWNER, key, {
          ...size,
          format: "rgba16f",
          filter: "nearest",
          depth: false,
        });
        entry.keys.push(key);
      }
    } catch (error) {
      releaseView(viewId);
      throw error;
    }
    return entry;
  }
  return Object.freeze({
    prepare,
    get: (viewId, name) => views.get(viewId)?.targets[name],
    releaseView,
    clear() {
      for (const viewId of [...views.keys()]) releaseView(viewId);
    },
    stats: () => ({
      liveViews: views.size,
      targetBytes: [...views.values()].reduce(
        (sum, value) => sum + value.bytes,
        0,
      ),
    }),
  });
}
