import { createDiagnosticReporter } from "./createDiagnosticReporter.js";
import { createDeviceState } from "./createDeviceState.js";
import { bindDeviceEvents } from "./bindDeviceEvents.js";
import { createManagedRendererAdapter } from "./createManagedRendererAdapter.js";
import { resolveRobustnessSettings } from "./robustnessSettings.js";

export function createRobustnessRuntime({
  rendererAdapter,
  pool,
  settings,
  report = () => {},
  onInvalidate = () => {},
  ownPool = false
}) {
  const emit = createDiagnosticReporter(report);
  const configuration = resolveRobustnessSettings(settings?.get?.("CP-F32"));
  const adapter = createManagedRendererAdapter(rendererAdapter, {
    pool,
    report: emit,
    ...configuration
  });
  let disposed = false;
  let lastFrame = null;
  const device = createDeviceState({
    maxViews: configuration.maxViews,
    onInvalidate(reason) {
      adapter.cancelWarmup();
      if (reason === "context-loss" || reason === "context-restored") adapter.invalidatePrograms();
      if (ownPool) pool.clear();
      else pool.releaseOwner("CP-F32");
      onInvalidate(reason);
      lastFrame = null;
      emit({ phase: "CP-F32", type: "lifecycle-reset", reason });
    }
  });
  const events = bindDeviceEvents(
    rendererAdapter.renderer?.domElement ?? rendererAdapter.eventTarget,
    device,
    emit
  );
  let capabilityProbe;
  try {
    capabilityProbe = adapter.createMaterial(
      "uniform float frameMarker; void main() { gl_FragColor = vec4(frameMarker, 0.25, 0.5, 1.0); }",
      { frameMarker: { value: 0 } }
    );
  } catch (error) {
    events.dispose();
    device.dispose();
    adapter.dispose();
    throw error;
  }
  function snapshot() {
    return Object.freeze({
      device: device.snapshot(),
      resources: pool.stats?.(),
      shaders: adapter.managedStats(),
      eventListeners: !disposed && events.attached ? 2 : 0,
      managedPipeline: ownPool
    });
  }
  return Object.freeze({
    adapter,
    device,
    prepare(frame) {
      if (disposed) throw new Error("Robustness runtime is disposed");
      device.acceptFrame(frame);
      const key = JSON.stringify([frame.viewId, frame.generation, frame.frameId]);
      if (lastFrame === key) throw new Error("Duplicate CP-F32 preparation");
      lastFrame = key;
      const options = resolveRobustnessSettings(settings?.get?.("CP-F32"));
      adapter.requeueMaterials();
      const warmup = adapter.warmup({
        maxPrograms: options.maxWarmupProgramsPerFrame,
        budgetMilliseconds: options.warmupBudgetMilliseconds
      });
      if (warmup.results.some((result) => result.status === "failed"))
        emit({ phase: "CP-F32", type: "warmup-failed", results: warmup.results });
      return snapshot();
    },
    renderProbe(frame) {
      device.acceptFrame(frame);
      const target = pool.acquire("CP-F32", `CP-F32.probe.${encodeURIComponent(frame.viewId)}`, {
        width: 2,
        height: 2,
        format: "rgba16f",
        filter: "nearest"
      });
      capabilityProbe.uniforms.frameMarker.value = ((frame.frameId % 127) + 1) / 128;
      adapter.draw(capabilityProbe, target);
      return target;
    },
    snapshot,
    dispose() {
      if (disposed) return;
      disposed = true;
      events.dispose();
      device.dispose();
      try {
        adapter.dispose();
      } finally {
        pool.releaseOwner("CP-F32");
      }
    }
  });
}
