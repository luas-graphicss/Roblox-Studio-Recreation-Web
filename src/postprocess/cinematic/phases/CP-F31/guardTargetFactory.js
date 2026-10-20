import { normalizeTargetDescriptor } from "../CP-F32/targetDescriptor.js";
import { resourceBytes } from "./resourceMemory.js";

export function guardTargetFactory({ createTarget, ledger, owner, capabilities }) {
  const liveTargets = new WeakSet();
  return (input) => {
    const descriptor = normalizeTargetDescriptor(input, capabilities);
    const release = ledger.reserve(owner, resourceBytes({ kind: "target", width: descriptor.width,
      height: descriptor.height, format: descriptor.format, depth: descriptor.depth }), "target");
    let target;
    try {
      target = createTarget(descriptor);
      if (!target || typeof target.dispose !== "function" || typeof target.addEventListener !== "function" || typeof target.removeEventListener !== "function")
        throw new TypeError("Budgeted targets require disposal events");
      if (liveTargets.has(target)) throw new Error("Target factory returned an already-live target");
      const released = () => {
        target.removeEventListener("dispose", released);
        liveTargets.delete(target);
        release();
      };
      target.addEventListener("dispose", released);
      liveTargets.add(target);
      return target;
    } catch (error) {
      if (target && !liveTargets.has(target)) {
        try { target.dispose?.(); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], "Target allocation cleanup failed; reservation retained"); }
      }
      release();
      throw error;
    }
  };
}
