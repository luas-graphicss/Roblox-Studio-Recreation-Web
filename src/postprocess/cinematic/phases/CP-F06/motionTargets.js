import { MOTION_PHASE_ID } from "./motionContract.js";

export function createMotionTargets(pool, maximumViews = 8) {
  const views = new Map();
  const liveTargets = new WeakSet();
  const listeners = new Map();

  function track(target) {
    if (!listeners.has(target)) {
      const onDispose = () => liveTargets.delete(target);
      target.addEventListener?.("dispose", onDispose);
      listeners.set(target, onDispose);
    }
    liveTargets.add(target);
    return target;
  }

  function releaseView(viewId) {
    const keys = views.get(viewId);
    if (!keys) return false;
    for (const key of keys) pool.release(key);
    views.delete(viewId);
    for (const [target, listener] of listeners) {
      if (liveTargets.has(target)) continue;
      target.removeEventListener?.("dispose", listener);
      listeners.delete(target);
    }
    return true;
  }

  return Object.freeze({
    acquire(frame, previous) {
      if (!views.has(frame.viewId) && views.size >= maximumViews)
        throw new Error(`CP-F06 view capacity ${maximumViews} exceeded; release an unused view`);
      const prefix = `${MOTION_PHASE_ID}.${encodeURIComponent(frame.viewId)}`;
      const names = ["velocity", "validity", "identity0", "identity1"];
      const keys = names.map((name) => `${prefix}.${name}`);
      views.set(frame.viewId, keys);
      const slot = previous ? 1 - previous.targets.slot : 0;
      const descriptor = { ...frame.renderSize, depth: true, filter: "nearest" };
      const acquire = (name, format) =>
        track(pool.acquire(MOTION_PHASE_ID, `${prefix}.${name}`, { ...descriptor, format }));
      const targets = {
        slot,
        velocity: acquire("velocity", "rgba16f"),
        validity: acquire("validity", "rgba8"),
        identity: acquire(`identity${slot}`, "rgba8"),
      };
      if (
        previous?.targets.identity === targets.identity ||
        previous?.targets.identity.texture === targets.identity.texture
      )
        throw new Error("CP-F06 previous visibility aliases current output");
      for (const [target, listener] of listeners) {
        if (liveTargets.has(target)) continue;
        target.removeEventListener?.("dispose", listener);
        listeners.delete(target);
      }
      return targets;
    },
    isAlive: (target) => liveTargets.has(target),
    releaseView,
    viewCount: () => views.size,
    dispose() {
      for (const viewId of [...views.keys()]) releaseView(viewId);
      for (const [target, listener] of listeners) target.removeEventListener?.("dispose", listener);
      listeners.clear();
      pool.releaseOwner(MOTION_PHASE_ID);
    },
  });
}
