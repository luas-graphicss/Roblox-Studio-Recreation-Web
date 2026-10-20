import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { createColorState } from "./createColorState.js";
import { createHdrTransportGpu } from "./createHdrTransportGpu.js";
import { createFrameColorTransport } from "./createFrameColorTransport.js";
import { validateCaptureColorState } from "./validateCaptureColorState.js";
import { applyQueuedPreExposure } from "./preExposureMailbox.js";
import { registerHdrSceneColorPass } from "./registerHdrSceneColorPass.js";

export { queueNextPreExposure } from "./preExposureMailbox.js";
export { createHdrTransportGpu } from "./createHdrTransportGpu.js";
export { createColorTransportPlan, transportRadianceRgb } from "./colorTransportPlan.js";

function valueResource(frame, value) {
  return Object.freeze({ value, frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "synthetic" });
}

function install(services) {
  validateCaptureColorState(services.rendererAdapter);
  if (!services.history?.read || !services.history?.write || !services.settings?.get) throw new TypeError("CP-F04 needs history and settings services");
  const gpu = createHdrTransportGpu(services);
  const unregister = [];
  let disposed = false;
  try {
    unregister.push(services.graph.register({
      id: "CP-F04.prepareColorState", owner: "CP-F04", stage: "prepare", order: 400, reads: [], writes: ["CP-F04.colorState"], transformsColor: false,
      execute(context) {
        validateCaptureColorState(services.rendererAdapter);
        const previous = services.history.read("CP-F04", "CP-F04.colorState", context.frame);
        applyQueuedPreExposure(context.settings, context.frame, previous);
        const authored = context.settings.get("CP-F04");
        if (authored !== undefined && authored !== null && (typeof authored !== "object" || Array.isArray(authored))) throw new TypeError("CP-F04 settings must be an object or AUTO/null");
        const state = createColorState(context.frame, { sourcePreExposure: 1, ...authored }, services.capabilities, previous);
        context.publish("CP-F04.colorState", valueResource(context.frame, state));
        services.history.write("CP-F04", "CP-F04.colorState", context.frame, state);
      }
    }));
    unregister.push(services.graph.register({
      id: "CP-F04.prepareTransport", owner: "CP-F04", stage: "prepare", order: 401, reads: ["CP-F04.colorState"], writes: ["CP-F04.transport"], transformsColor: false,
      execute(context) {
        const state = context.read("CP-F04.colorState").value;
        context.publish("CP-F04.transport", valueResource(context.frame, createFrameColorTransport(gpu, state, context.frame)));
      }
    }));
    unregister.push(registerHdrSceneColorPass(services));
    services.report?.({ phase: "CP-F04", type: "installed", resources: ["CP-F04.colorState", "CP-F04.transport", "CP-F04.sceneColor"], validation: "synchronous-diagnostic-readback", referenceCertified: false });
  } catch (error) {
    for (const remove of unregister.reverse()) remove();
    gpu.dispose();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    for (const remove of unregister.reverse()) remove();
    gpu.dispose();
    services.history.clearOwner("CP-F04");
  };
}

export default Object.freeze({ id: "CP-F04", contractVersion: CONTRACT_VERSION, status: "implemented", install });
