import { TEMPORAL_RECONSTRUCTION_RESOURCES, resolveTemporalBindings, temporalInputNames } from "./temporalBindings.js";
import { TEMPORAL_RECONSTRUCTION_PROFILE, resolveTemporalSettings } from "./temporalSettings.js";
import { readTemporalInputs } from "./temporalInputs.js";
import { createTemporalFrameRenderer } from "./temporalFrameRenderer.js";

export function installTemporalReconstruction(services) {
  const { rendererAdapter, capabilities, settings, graph } = services;
  if (!capabilities?.webgl2 || !capabilities?.floatColorBuffer) throw new Error("CP-F21 requires WebGL2 and floating-point render targets");
  if (typeof rendererAdapter?.draw !== "function" || typeof rendererAdapter?.createMaterial !== "function") throw new Error("CP-F21 requires the GPU renderer adapter");
  if (!Number.isInteger(capabilities.maxTextureSize) || capabilities.maxTextureSize < 1) throw new Error("CP-F21 requires a measured maximum texture size");
  const bindings = resolveTemporalBindings(settings?.get?.("CP-F21.bindings"));
  const bindingSignature = JSON.stringify(bindings);
  const renderer = createTemporalFrameRenderer(services);
  let unregister;
  let disposed = false;
  try {
    unregister = graph.register({
      id: "CP-F21.reconstruct",
      owner: "CP-F21",
      stage: "temporal",
      order: 2100,
      reads: temporalInputNames(bindings),
      writes: Object.values(TEMPORAL_RECONSTRUCTION_RESOURCES),
      transformsColor: true,
      execute(context) {
        if (disposed) throw new Error("CP-F21 phase is disposed");
        const currentBindings = resolveTemporalBindings(context.settings?.get?.("CP-F21.bindings"));
        if (JSON.stringify(currentBindings) !== bindingSignature) throw new Error("CP-F21 binding changes require reinstallation to redeclare graph inputs");
        const controls = resolveTemporalSettings(context.settings?.get?.("CP-F21.controls"));
        const inputs = readTemporalInputs(context, bindings, controls, capabilities.maxTextureSize);
        const result = renderer.render(context.frame, inputs, controls);
        for (const name of ["velocity", "output", "rejection", "depth"]) context.publish(TEMPORAL_RECONSTRUCTION_RESOURCES[name], result[name]);
        const metadata = Object.freeze({ ...result.metadata, motionProfile: bindings.profile, bindings, translucencyIntegration: bindings.translucencyMask ? "explicit-mask" : "motion-producer-reactive-only", integrationCertified: false });
        context.publish(TEMPORAL_RECONSTRUCTION_RESOURCES.metadata, Object.freeze({
          value: metadata, frameId: context.frame.frameId, viewId: context.frame.viewId, generation: context.frame.generation, provenance: "gpu"
        }));
        return { color: result.output };
      }
    });
    services.report?.({ phase: "CP-F21", status: "implemented", profile: TEMPORAL_RECONSTRUCTION_PROFILE, motionProfile: bindings.profile, fullTsr: false, referenceVerified: false });
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    try { unregister(); } finally { renderer.dispose(); }
  };
}
