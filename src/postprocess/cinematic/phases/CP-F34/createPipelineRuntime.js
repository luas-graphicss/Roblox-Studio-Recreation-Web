import { createPostProcessPipeline } from "../../core/createPostProcessPipeline.js";
import { requireSynchronous } from "./adapterValidation.js";
import { requireSynchronousCallback } from "./synchronousCallbacks.js";
import { createPipelineFrameBinding } from "./createPipelineFrameBinding.js";

export async function createPipelineRuntime({ services, phases, configureSettings, resizeResources, resetResources, disposeResources, signal }) {
  for (const [name, callback] of Object.entries({ configureSettings, resizeResources, resetResources, disposeResources })) requireSynchronousCallback(callback, name);
  if (!Array.isArray(phases)) throw new TypeError("Explicit pipeline phases are required");
  signal?.throwIfAborted();
  const pipeline = createPostProcessPipeline(services);
  const binding = createPipelineFrameBinding(pipeline);
  let disposed = false;
  function assertActive() {
    if (disposed) throw new Error("Runtime is disposed");
    signal?.throwIfAborted();
  }
  function beginMutation() { assertActive(); binding.assertIdle(); binding.invalidate(); }
  function dispose() {
    if (disposed) return;
    disposed = true;
    binding.invalidate();
    const errors = [];
    for (const operation of [() => pipeline.dispose(), () => requireSynchronous(disposeResources(), "Owned resource disposal")]) {
      try { operation(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Future runtime cleanup failed");
  }
  try {
    for (const phase of phases) { assertActive(); await pipeline.install(phase); }
    await pipeline.install(binding.phase);
    assertActive();
  } catch (error) {
    try { dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Future runtime installation failed"); }
    throw error;
  }
  return Object.freeze({
    configure(settings) { beginMutation(); return requireSynchronous(configureSettings(settings), "Settings bridge"); },
    resize(dimensions) { beginMutation(); requireSynchronous(resizeResources(dimensions), "Resource resize"); pipeline.reset(); },
    prepare(frame, execution) { assertActive(); return binding.prepare(frame, execution); },
    render(frame, inputs) { assertActive(); return binding.render(frame, inputs); },
    reset(reason) { beginMutation(); pipeline.reset(); return requireSynchronous(resetResources(reason), "Resource reset"); },
    dispose
  });
}
