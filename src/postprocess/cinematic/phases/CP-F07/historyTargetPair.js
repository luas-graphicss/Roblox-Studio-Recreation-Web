import { TEMPORAL_PHASE_ID } from "./temporalContract.js";

export function createHistoryTargetPair(pool, identity, descriptor) {
  if (typeof pool?.acquire !== "function" || typeof pool?.release !== "function") throw new TypeError("History requires a releasable resource pool");
  const keys = [0, 1].map((slot) => `${TEMPORAL_PHASE_ID}.history.${encodeURIComponent(identity)}.${slot}`);
  const targets = [];
  const listeners = [];
  let released = false;
  let targetDisposed = false;
  try {
    for (const key of keys) {
      const target = pool.acquire(TEMPORAL_PHASE_ID, key, descriptor);
      targets.push(target);
      if (typeof target.addEventListener !== "function" || typeof target.removeEventListener !== "function") throw new TypeError("History targets must expose disposal events");
      const onDispose = () => { targetDisposed = true; };
      target.addEventListener("dispose", onDispose);
      listeners.push(onDispose);
    }
    if (targets[0] === targets[1] || targets[0].texture === targets[1].texture) throw new Error("History targets alias");
  } catch (error) {
    for (let index = 0; index < targets.length; index += 1) {
      if (listeners[index]) targets[index].removeEventListener("dispose", listeners[index]);
      pool.release(keys[index]);
    }
    throw error;
  }
  function assertAlive() {
    if (released || targetDisposed) throw new Error("History target was released or disposed");
  }
  return Object.freeze({
    isAlive: () => !released && !targetDisposed,
    get(slot) { assertAlive(); if (slot !== 0 && slot !== 1) throw new RangeError("Invalid history slot"); return targets[slot]; },
    assertAlive,
    release() {
      if (released) return;
      released = true;
      for (let index = 0; index < targets.length; index += 1) {
        targets[index].removeEventListener("dispose", listeners[index]);
        pool.release(keys[index]);
      }
    }
  });
}
