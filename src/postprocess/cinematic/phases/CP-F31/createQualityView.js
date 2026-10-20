import { createPostProcessPipeline } from "../../core/createPostProcessPipeline.js";
import robustnessPhase from "../CP-F32/index.js";
import qualityPhase from "./index.js";
import { createRobustResourcePool } from "../CP-F32/createRobustResourcePool.js";
import { createRobustnessRuntime } from "../CP-F32/createRobustnessRuntime.js";
import { guardTargetFactory } from "./guardTargetFactory.js";
import { assertSynchronous, freeze, QUALITY_VERSION } from "./qualityContract.js";

export async function createQualityView({ rendererAdapter, ledger, viewId, plan, inventory, phases, report }) {
  let releaseExternal = () => {};
  let registered = false;
  let pool;
  let runtime;
  let pipeline;
  let currentFrame = null;
  let reference = null;
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    const failures = [];
    for (const operation of [() => pipeline?.dispose(), () => runtime?.dispose(), () => pool?.dispose(), releaseExternal,
      () => { if (registered) ledger.releaseOwnerLimit(viewId); }]) {
      try { operation(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Quality view cleanup failed; unresolved targets remain charged");
  }
  try {
    ledger.setOwnerLimit(viewId, plan.budgetBytes);
    registered = true;
    releaseExternal = ledger.reserve(viewId, inventory.residentBytes);
    pool = createRobustResourcePool({ capabilities: rendererAdapter.capabilities, budgetBytes: plan.budgetBytes,
      createTarget: guardTargetFactory({ createTarget: rendererAdapter.createTarget, ledger, owner: viewId, capabilities: rendererAdapter.capabilities }) });
    runtime = createRobustnessRuntime({ rendererAdapter, pool, settings: plan.effectiveSettings, report,
      ownPool: true, onInvalidate: () => pipeline?.reset() });
    const qualityRuntime = Object.freeze({ stateFor(frame) {
      if (!currentFrame || frame.viewId !== viewId || frame.frameId !== currentFrame.frameId || frame.generation !== currentFrame.generation)
        throw new Error("Quality state does not belong to the current host frame");
      return freeze({ apiVersion: QUALITY_VERSION, applied: true, status: "applied-before-prepare",
        requestedProfileId: plan.requestedProfileId, profileId: plan.profileId, renderSize: { ...plan.renderSize },
        outputSize: { ...plan.outputSize }, budgetBytes: plan.budgetBytes, configurationKey: plan.configurationKey,
        options: plan.options, referenceStatus: reference.status, referenceApproved: reference.approved,
        memoryBeforeRender: ledger.stats(), inventory, estimateCoverage: plan.estimateCoverage });
    } });
    const adapter = Object.freeze({ ...runtime.adapter, robustnessRuntime: runtime, qualityRuntime });
    pipeline = createPostProcessPipeline({ rendererAdapter: adapter, pool, settings: plan.effectiveSettings,
      capabilities: adapter.capabilities, report });
    await pipeline.install(robustnessPhase);
    await pipeline.install(qualityPhase);
    for (const phase of phases) if (!["CP-F31", "CP-F32"].includes(phase.id)) await pipeline.install(phase);
    return Object.freeze({
      dispose,
      reset: () => pipeline.reset(),
      suspend: () => runtime.device.suspend(),
      resume: () => runtime.device.resume(),
      snapshot: () => ({ ...runtime.snapshot(), pool: pool.stats() }),
      render(frame, produceInputs, authorization) {
        if (disposed) throw new Error("Quality view is disposed");
        currentFrame = frame;
        reference = authorization;
        try {
          const prepared = pipeline.prepare(frame);
          const inputs = assertSynchronous(produceInputs(frame, adapter, pool, prepared.resources), "scene input producer");
          if (!inputs || typeof inputs !== "object") throw new TypeError("Scene input producer must return resources");
          return { status: "rendered", frame, ...pipeline.render(frame, inputs) };
        } catch (error) {
          pipeline.reset();
          throw error;
        } finally { currentFrame = null; }
      }
    });
  } catch (error) {
    try { dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Quality view installation failed"); }
    throw error;
  }
}
