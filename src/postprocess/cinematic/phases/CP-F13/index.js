import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { createLutRuntime } from "./createLutRuntime.js";
import { LUT_PHASE_ID, LUT_STATE_RESOURCE, LUT_COLOR_RESOURCE, LUT_ASSET_PASS, LUT_COLOR_PASS } from "./lutPhaseContract.js";

export function installLutPhase(services) {
  const runtime = createLutRuntime(services);
  const registrations = [];
  let disposed = false;
  function cleanup() {
    if (disposed) return;
    disposed = true;
    for (const unregister of registrations.reverse()) unregister();
    runtime.dispose();
  }
  try {
    registrations.push(services.graph.register({
      id: LUT_ASSET_PASS, owner: LUT_PHASE_ID, stage: "grading", order: 129,
      reads: [], writes: [LUT_STATE_RESOURCE], transformsColor: false,
      execute(context) { context.publish(LUT_STATE_RESOURCE, runtime.prepare(context.frame)); }
    }));
    registrations.push(services.graph.register({
      id: LUT_COLOR_PASS, owner: LUT_PHASE_ID, stage: "grading", order: 130,
      reads: ["$color", LUT_STATE_RESOURCE], writes: [LUT_COLOR_RESOURCE], transformsColor: true,
      execute: runtime.render, dispose: runtime.dispose
    }));
    services.report?.({ phase: LUT_PHASE_ID, status: "implemented", default: "neutral-copy", reference: "BLOCKED_REFERENCE", setting: "CP-F13.looks", activeLookLimit: 4 });
  } catch (error) {
    cleanup();
    throw error;
  }
  cleanup.snapshot = runtime.snapshot;
  return cleanup;
}

export default Object.freeze({ id: LUT_PHASE_ID, contractVersion: CONTRACT_VERSION, status: "implemented", install: installLutPhase });
