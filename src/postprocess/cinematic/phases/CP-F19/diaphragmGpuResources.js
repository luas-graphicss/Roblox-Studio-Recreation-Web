import { DIAPHRAGM_OWNER } from "./diaphragmContract.js";

export function createDiaphragmGpuResources(pool) {
  let signature, targets;
  return Object.freeze({
    acquire(plan) {
      const next = `${plan.width}:${plan.height}:${plan.active}`;
      if (signature === next) return targets;
      pool.releaseOwner(DIAPHRAGM_OWNER);
      signature = undefined;
      targets = undefined;
      try {
        const auxiliary = plan.active ? { width: plan.width, height: plan.height } : { width: 1, height: 1 };
        const acquire = (name, size, format) => pool.acquire(DIAPHRAGM_OWNER, `${DIAPHRAGM_OWNER}.${name}`, { ...size, format, filter: "nearest", depth: false });
        targets = Object.freeze({
          normalization: acquire("normalizationTarget", auxiliary, "r32f"), near: acquire("nearTarget", auxiliary, "rgba16f"),
          far: acquire("farTarget", auxiliary, "rgba16f"), filledFar: acquire("filledFarTarget", auxiliary, "rgba16f"),
          color: acquire("colorTarget", { width: plan.width, height: plan.height }, "rgba16f")
        });
        signature = next;
        return targets;
      } catch (error) { pool.releaseOwner(DIAPHRAGM_OWNER); throw error; }
    },
    dispose() { pool.releaseOwner(DIAPHRAGM_OWNER); signature = undefined; targets = undefined; }
  });
}
