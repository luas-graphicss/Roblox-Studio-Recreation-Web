import { validateFrame } from "../../contracts/frameContract.js";

export function createDeviceState({ maxViews = 16, onInvalidate = () => {} } = {}) {
  if (!Number.isInteger(maxViews) || maxViews < 1 || typeof onInvalidate !== "function")
    throw new TypeError("Invalid device state configuration");
  const views = new Map();
  let disposed = false;
  let suspended = false;
  let lost = false;
  let epoch = 0;
  let lossCount = 0;
  let restoreCount = 0;
  let reason = null;
  function assertActive() {
    if (disposed) throw new Error("Device state is disposed");
  }
  function invalidate(nextReason) {
    epoch += 1;
    reason = nextReason;
    onInvalidate(nextReason);
  }
  return Object.freeze({
    acceptFrame(frame) {
      assertActive();
      validateFrame(frame);
      if (lost || suspended)
        throw new Error(lost ? "Device context is lost" : "Pipeline is suspended");
      const previous = views.get(frame.viewId);
      if (previous?.restoreRequired && frame.generation <= previous.generation)
        throw new Error("Device restore requires a new host generation");
      if (!previous && views.size >= maxViews)
        throw new RangeError("Device view capacity exceeded");
      views.set(frame.viewId, { generation: frame.generation, restoreRequired: false });
      return epoch;
    },
    suspend() {
      assertActive();
      if (suspended) return false;
      suspended = true;
      invalidate("suspend");
      return true;
    },
    resume() {
      assertActive();
      if (!suspended) return false;
      suspended = false;
      reason = lost ? "context-loss" : "resume";
      return true;
    },
    lose() {
      if (disposed || lost) return false;
      lost = true;
      lossCount += 1;
      for (const view of views.values()) view.restoreRequired = true;
      invalidate("context-loss");
      return true;
    },
    restore() {
      if (disposed || !lost) return false;
      lost = false;
      restoreCount += 1;
      invalidate("context-restored");
      return true;
    },
    releaseView(viewId) {
      assertActive();
      return views.delete(viewId);
    },
    snapshot: () =>
      Object.freeze({
        state: disposed ? "disposed" : lost ? "lost" : suspended ? "suspended" : "ready",
        epoch,
        lossCount,
        restoreCount,
        views: views.size,
        reason
      }),
    dispose() {
      if (disposed) return;
      disposed = true;
      views.clear();
    }
  });
}
