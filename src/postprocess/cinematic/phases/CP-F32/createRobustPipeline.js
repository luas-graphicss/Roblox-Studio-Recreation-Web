import { createDiagnosticReporter } from "./createDiagnosticReporter.js";
import { createPostProcessPipeline } from "../../core/createPostProcessPipeline.js";
import { createRobustResourcePool } from "./createRobustResourcePool.js";
import { createRobustnessRuntime } from "./createRobustnessRuntime.js";
import { installRobustness } from "./installRobustness.js";
import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";

export async function createRobustPipeline({
  rendererAdapter,
  settings,
  phases = [],
  budgetBytes = 268435456,
  report = () => {}
}) {
  const emit = createDiagnosticReporter(report);
  const pool = createRobustResourcePool({
    createTarget: rendererAdapter.createTarget,
    capabilities: rendererAdapter.capabilities,
    budgetBytes
  });
  let pipeline = null;
  let disposed = false;
  let executing = false;
  let runtime = null;
  const failures = [];
  function remember(error) {
    failures.push(error.message);
    if (failures.length > 32) failures.shift();
    emit({ phase: "CP-F32", type: "pipeline-frame-failed", message: error.message });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const cleanup of [
      () => pipeline?.dispose(),
      () => runtime?.dispose(),
      () => pool.dispose()
    ]) {
      try {
        cleanup();
      } catch (error) {
        remember(error);
      }
    }
  }
  try {
    runtime = createRobustnessRuntime({
      rendererAdapter,
      pool,
      settings,
      report: emit,
      ownPool: true,
      onInvalidate() {
        pipeline?.reset();
      }
    });
    const adapter = Object.freeze({ ...runtime.adapter, robustnessRuntime: runtime });
    pipeline = createPostProcessPipeline({
      rendererAdapter: adapter,
      pool,
      settings,
      capabilities: rendererAdapter.capabilities,
      report: emit
    });
    await pipeline.install({
      id: "CP-F32",
      contractVersion: CONTRACT_VERSION,
      status: "implemented",
      install: installRobustness
    });
    for (const phase of phases) if (phase.id !== "CP-F32") await pipeline.install(phase);
    return Object.freeze({
      rendererAdapter: adapter,
      pool,
      pipeline,
      runtime,
      renderFrame(frame, produceInputs) {
        if (disposed) throw new Error("Managed pipeline is disposed");
        if (executing) throw new Error("Pipeline frame reentry is forbidden");
        const state = runtime.device.snapshot().state;
        if (state !== "ready")
          return { status: state, color: null, resources: {}, frameId: frame.frameId };
        executing = true;
        try {
          const prepared = pipeline.prepare(frame);
          const inputs =
            typeof produceInputs === "function"
              ? produceInputs(frame, adapter, pool, prepared.resources)
              : produceInputs;
          if (!inputs || typeof inputs.then === "function")
            throw new TypeError("Scene input production must be synchronous");
          return { status: "rendered", frameId: frame.frameId, ...pipeline.render(frame, inputs) };
        } catch (error) {
          remember(error);
          pipeline.reset();
          return {
            status: "failed",
            frameId: frame.frameId,
            color: null,
            resources: {},
            error: error.message
          };
        } finally {
          executing = false;
        }
      },
      suspend: () => runtime.device.suspend(),
      resume: () => runtime.device.resume(),
      reset() {
        if (disposed) throw new Error("Managed pipeline is disposed");
        pipeline.reset();
      },
      snapshot: () => ({
        ...runtime.snapshot(),
        failures: [...failures],
        diagnosticDelivery: emit.stats(),
        disposed
      }),
      dispose
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
