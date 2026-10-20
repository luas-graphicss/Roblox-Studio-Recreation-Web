import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { EXPOSURE_BINDING_KEY, EXPOSURE_PHASE_ID, EXPOSURE_RESOURCES } from "./exposureContract.js";
import { resolveExposureBinding } from "./exposureBinding.js";
import { registerExposureAdaptationPass } from "./exposureAdaptationPass.js";
import { registerExposureColorPass } from "./exposureColorPass.js";

export function createExposureAdaptationPhase(explicitBinding) {
  return Object.freeze({
    id: EXPOSURE_PHASE_ID,
    contractVersion: CONTRACT_VERSION,
    status: "implemented",
    install(services) {
      const binding = resolveExposureBinding(explicitBinding ?? services.settings?.get?.(EXPOSURE_BINDING_KEY));
      const unregisters = [];
      let disposed = false;
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        for (const unregister of unregisters.reverse()) unregister();
        services.history?.clearOwner(EXPOSURE_PHASE_ID);
        services.pool?.releaseOwner(EXPOSURE_PHASE_ID);
      };
      try {
        if (!binding) {
          services.report?.({ phase: EXPOSURE_PHASE_ID, status: "blocked-dependency", reason: "CP-F08 metering and CP-F04 exposure ownership require an explicit CP-F09.binding before installation" });
          unregisters.push(services.graph.register({
            id: "CP-F09.bindingStatus", owner: EXPOSURE_PHASE_ID, stage: "metering", order: 900,
            reads: [], writes: [EXPOSURE_RESOURCES.status], transformsColor: false,
            execute({ frame, publish }) {
              publish(EXPOSURE_RESOURCES.status, Object.freeze({ frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "synthetic", value: Object.freeze({ active: false, status: "blocked-dependency", reason: "No exposure binding configured" }) }));
            }
          }));
        } else {
          if (!services.capabilities?.webgl2 || !services.capabilities?.floatColorBuffer) throw new Error("CP-F09 requires WebGL2 with float color targets");
          unregisters.push(registerExposureAdaptationPass(services, binding));
          if (binding.applyToColor) unregisters.push(registerExposureColorPass(services, binding));
        }
        return cleanup;
      } catch (error) { cleanup(); throw error; }
    }
  });
}

export default createExposureAdaptationPhase();
