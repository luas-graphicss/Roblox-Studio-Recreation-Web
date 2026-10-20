import { QUALITY_PHASE, QUALITY_RESOURCE, QUALITY_VERSION } from "./qualityContract.js";
import { readQualitySettings } from "./qualitySettings.js";

export function installQuality(services) {
  const shared = services.rendererAdapter?.qualityRuntime;
  if (!services.settings?.get || !services.graph?.register) throw new TypeError("CP-F31 requires graph and settings services");
  let disposed = false;
  const unregister = services.graph.register({
    id: "CP-F31.negotiateQuality", owner: QUALITY_PHASE, stage: "prepare", order: -3100,
    reads: [], writes: [QUALITY_RESOURCE], transformsColor: false,
    execute(context) {
      if (disposed) throw new Error("Quality phase is disposed");
      if (context.frame.referenceMode && !shared) throw new Error("CP-F31 BLOCKED_REFERENCE: unmanaged quality cannot claim an exact profile");
      const value = shared ? shared.stateFor(context.frame) : Object.freeze({
        apiVersion: QUALITY_VERSION, status: "host-bridge-required", applied: false,
        requestedProfileId: readQualitySettings(services.settings, context.frame.viewId).profile,
        referenceStatus: "BLOCKED_REFERENCE", reason: "Use createQualityPipeline before prepare; a prepare pass cannot resize host-owned inputs" });
      context.publish(QUALITY_RESOURCE, Object.freeze({ frameId: context.frame.frameId, generation: context.frame.generation,
        viewId: context.frame.viewId, provenance: "synthetic", value }));
    }
  });
  return () => { if (disposed) return; disposed = true; unregister(); };
}
