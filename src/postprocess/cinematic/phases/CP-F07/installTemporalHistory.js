import { TEMPORAL_PHASE_ID, TEMPORAL_FRAME_RESOURCE, TEMPORAL_CONTROLS_SETTING, TEMPORAL_PREPARE_PASS, TEMPORAL_API_VERSION } from "./temporalContract.js";
import { resolveTemporalControls } from "./temporalControls.js";
import { sampleTemporalJitter, createJitteredProjection } from "./deterministicJitter.js";
import { createTemporalHistoryController } from "./temporalHistoryController.js";
import { createGpuHistoryRescale } from "./gpuHistoryRescale.js";

export function installTemporalHistory(services) {
  const converter = createGpuHistoryRescale(services.rendererAdapter);
  const controller = createTemporalHistoryController({ pool: services.pool, history: services.history, rescaleHistory: converter.rescale, report: services.report });
  let disposed = false;
  let unregister;
  try {
    unregister = services.graph.register({
      id: TEMPORAL_PREPARE_PASS,
      owner: TEMPORAL_PHASE_ID,
      stage: "prepare",
      order: 700,
      reads: [],
      writes: [TEMPORAL_FRAME_RESOURCE],
      transformsColor: false,
      execute(context) {
        const { frame } = context;
        const controls = resolveTemporalControls(context.settings?.get?.(TEMPORAL_CONTROLS_SETTING));
        const histories = controller.beginFrame(frame, controls);
        const samplePixels = sampleTemporalJitter(frame.frameId, controls);
        const jitterPixels = controls.jitterEnabled && !controls.paused ? samplePixels : Object.freeze([0, 0]);
        const previousJitterPixels = histories.resetReasons.length || !controls.jitterEnabled || controls.paused ? jitterPixels : sampleTemporalJitter(frame.frameId - 1, controls);
        const projection = frame.matrices?.projection;
        const jitteredProjection = projection?.length === 16 ? createJitteredProjection(projection, jitterPixels, frame.renderSize) : null;
        context.publish(TEMPORAL_FRAME_RESOURCE, Object.freeze({
          frameId: frame.frameId,
          viewId: frame.viewId,
          generation: frame.generation,
          provenance: "synthetic",
          value: Object.freeze({ apiVersion: TEMPORAL_API_VERSION, samplePixels, jitterPixels, previousJitterPixels, jitteredProjection, projectionApplication: "host-owned", histories })
        }));
      }
    });
  } catch (error) {
    controller.dispose();
    converter.dispose();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    try { unregister(); }
    finally { controller.dispose(); converter.dispose(); }
  };
}
