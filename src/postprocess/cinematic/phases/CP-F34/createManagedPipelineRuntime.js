import { createRobustPipeline } from "../CP-F32/createRobustPipeline.js";
import { requireSynchronous } from "./adapterValidation.js";
import { requireSynchronousCallback } from "./synchronousCallbacks.js";
import { createPipelineFrameBinding } from "./createPipelineFrameBinding.js";

export async function createManagedPipelineRuntime({ rendererAdapter, settings, phases, budgetBytes, report, configureSettings, resizeResources, resetResources, disposeResources, signal }) {
  for (const [name, callback] of Object.entries({ configureSettings, resizeResources, resetResources, disposeResources })) requireSynchronousCallback(callback, name);
  if (!Array.isArray(phases)) throw new TypeError("Explicit pipeline phases are required");
  if (phases.some((phase) => ["CP-F32", "CP-F34"].includes(phase?.id))) throw new Error("Managed runtime owns the CP-F32 and CP-F34 installers");
  signal?.throwIfAborted();
  let managed = null;
  let binding = null;
  let disposed = false;
  let preparedEpoch = null;
  function assertActive() {
    if (disposed) throw new Error("Runtime is disposed");
    signal?.throwIfAborted();
  }
  function assertDevice() {
    assertActive();
    const device = managed.runtime.device.snapshot();
    if (device.state !== "ready") throw new Error(`Managed device is ${device.state}`);
    if (rendererAdapter.context?.isContextLost?.()) throw new Error("Managed device context is lost");
    return device.epoch;
  }
  function invalidate() { preparedEpoch = null; binding?.invalidate(); }
  function beginMutation() { assertActive(); binding.assertIdle(); invalidate(); }
  function dispose() {
    if (disposed) return;
    disposed = true;
    invalidate();
    const errors = [];
    for (const operation of [() => managed?.dispose(), () => requireSynchronous(disposeResources(), "Owned resource disposal")]) {
      try { operation(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Managed Future runtime cleanup failed");
  }
  try {
    managed = await createRobustPipeline({ rendererAdapter, settings, phases, budgetBytes, report });
    assertActive();
    binding = createPipelineFrameBinding(managed.pipeline);
    await managed.pipeline.install(binding.phase);
    assertActive();
  } catch (error) {
    try { dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Managed Future runtime installation failed"); }
    throw error;
  }
  return Object.freeze({
    configure(value) { beginMutation(); return requireSynchronous(configureSettings(value), "Settings bridge"); },
    resize(dimensions) { beginMutation(); requireSynchronous(resizeResources(dimensions), "Resource resize"); managed.reset(); },
    prepare(frame, execution) {
      assertActive(); binding.assertIdle(); invalidate();
      const epoch = assertDevice();
      try {
        const prepared = binding.prepare(frame, execution);
        const state = prepared.resources["CP-F32.deviceState"]?.value;
        if (state?.managedPipeline !== true || state.device.epoch !== epoch || assertDevice() !== epoch) throw new Error("Managed preparation did not authorize this device epoch");
        preparedEpoch = epoch;
        return Object.freeze({ ...prepared, inputContext: Object.freeze({ rendererAdapter: managed.rendererAdapter, pool: managed.pool }) });
      } catch (error) { invalidate(); throw error; }
    },
    render(frame, inputs) {
      assertActive(); binding.assertIdle();
      const epoch = preparedEpoch;
      preparedEpoch = null;
      try {
        if (epoch === null || assertDevice() !== epoch) throw new Error("Managed rendering requires current device authorization");
        const result = binding.render(frame, inputs);
        if (assertDevice() !== epoch) throw new Error("Device changed during frame submission");
        return result;
      } catch (error) { invalidate(); managed.reset(); throw error; }
    },
    reset(reason) { beginMutation(); managed.reset(); return requireSynchronous(resetResources(reason), "Resource reset"); },
    snapshot: () => ({ disposed, prepared: preparedEpoch !== null, robustness: managed.snapshot() }),
    dispose
  });
}
