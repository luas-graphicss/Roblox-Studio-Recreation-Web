import { createColorTransportPlan } from "./colorTransportPlan.js";

export function createFrameColorTransport(gpu, state, frame) {
  const workingSpace = state.plan.destination;
  const formatPolicy = state.plan.formatPolicy;
  const negativePolicy = state.negativePolicy;
  const workingPlan = (source, destinationPreExposure) => createColorTransportPlan({ sourceSpace: source.colorSpace ?? workingSpace, workingSpace, sourceTransfer: "linear", sourcePreExposure: source.preExposure ?? state.currentPreExposure, destinationPreExposure, formatPolicy, negativePolicy });
  return Object.freeze({
    ingest(source) { return gpu.convert({ source, frame, plan: state.plan, key: "CP-F04.ingest" }); },
    normalizeHistory(source) {
      if (!state.historyValid) throw new Error(`CP-F04 history rejected: ${state.invalidationReason}`);
      return gpu.convert({ source, frame, plan: workingPlan(source, state.currentPreExposure), key: "CP-F04.history", history: true });
    },
    normalizeEmissive(source) {
      if (source.preExposure !== 1) throw new Error("Authored emissive input must be scene-linear and unexposed");
      return gpu.convert({ source, frame, plan: workingPlan(source, state.currentPreExposure), key: "CP-F04.emissive" });
    },
    forMetering(source) { return gpu.convert({ source, frame, plan: workingPlan(source, 1), key: "CP-F04.metering" }); },
    finalExposure(source, exposure) { return gpu.convert({ source, frame, plan: workingPlan(source, exposure), key: "CP-F04.finalExposure" }); }
  });
}
