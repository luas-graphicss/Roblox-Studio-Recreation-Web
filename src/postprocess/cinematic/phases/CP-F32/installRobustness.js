import { createDiagnosticReporter } from "./createDiagnosticReporter.js";
import {
  ROBUSTNESS_PHASE,
  ROBUSTNESS_RESOURCE,
  ROBUSTNESS_PREPARE_PASS,
  ROBUSTNESS_API_VERSION
} from "./robustnessContract.js";
import { createRobustnessRuntime } from "./createRobustnessRuntime.js";

export function installRobustness(services) {
  if (!services.pool?.acquire || !services.pool?.releaseOwner || !services.settings?.get)
    throw new TypeError("CP-F32 requires pool and settings services");
  const shared = services.rendererAdapter.robustnessRuntime;
  const runtime = shared ?? createRobustnessRuntime(services);
  let unregister;
  let disposed = false;
  try {
    unregister = services.graph.register({
      id: ROBUSTNESS_PREPARE_PASS,
      owner: ROBUSTNESS_PHASE,
      stage: "prepare",
      order: -3200,
      reads: [],
      writes: [ROBUSTNESS_RESOURCE],
      transformsColor: false,
      execute(context) {
        const state = runtime.prepare(context.frame);
        context.publish(
          ROBUSTNESS_RESOURCE,
          Object.freeze({
            frameId: context.frame.frameId,
            viewId: context.frame.viewId,
            generation: context.frame.generation,
            provenance: "synthetic",
            value: Object.freeze({ apiVersion: ROBUSTNESS_API_VERSION, ...state })
          })
        );
      }
    });
    createDiagnosticReporter(services.report)({
      phase: ROBUSTNESS_PHASE,
      type: "installed",
      scope: shared ? "managed-pipeline" : "phase-owned-lifecycle",
      automaticSharedServiceReplacement: false
    });
  } catch (error) {
    if (!shared) runtime.dispose();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    try {
      unregister();
    } finally {
      if (!shared) runtime.dispose();
    }
  };
}
