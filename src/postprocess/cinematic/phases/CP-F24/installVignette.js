import { makeTextureResource, requireFiniteNumber } from "../../contracts/frameContract.js";
import { VIGNETTE_OWNER, VIGNETTE_COLOR_RESOURCE, VIGNETTE_STATE_RESOURCE, VIGNETTE_PROFILE, VIGNETTE_ORDER, VIGNETTE_PRECISION, VIGNETTE_VOLUME_PROPERTY } from "./vignetteContract.js";
import { createVignetteSettingsReader } from "./vignetteSettings.js";
import { createVignetteUniforms, updateVignetteUniforms } from "./vignetteUniforms.js";
import { validateVignetteInput, createVignetteMetadata } from "./vignetteInput.js";
import { createVignetteResources } from "./vignetteResources.js";

export function installVignette(services, resolvedSettingsResource = null) {
  const { graph, pool, capabilities, rendererAdapter: adapter } = services;
  if (!capabilities?.webgl2 || !capabilities.floatColorBuffer) throw new Error("CP-F24 requires WebGL2 and float color buffers; no RGBA8 fallback");
  if (!graph?.register || !pool?.acquire || !pool?.release || !pool?.releaseOwner || !adapter?.createMaterial || !adapter?.draw) throw new TypeError("CP-F24 requires graph, pool and renderer adapter services");
  const readSettings = createVignetteSettingsReader();
  readSettings(services.settings);
  const uniforms = createVignetteUniforms();
  const resources = createVignetteResources(adapter, pool, uniforms);
  let disposed = false;
  let unregister;
  function dispose() {
    if (disposed) return;
    disposed = true;
    resources.dispose();
  }
  try {
    unregister = graph.register({
      id: `${VIGNETTE_OWNER}.vignette`,
      owner: VIGNETTE_OWNER,
      stage: "filmFinish",
      order: VIGNETTE_ORDER,
      reads: resolvedSettingsResource ? ["$color", resolvedSettingsResource] : ["$color"],
      writes: [VIGNETTE_COLOR_RESOURCE, VIGNETTE_STATE_RESOURCE],
      transformsColor: true,
      dispose,
      execute(context) {
        if (disposed) throw new Error("CP-F24 has been disposed");
        const source = context.read("$color");
        const inheritedIntensity = resolvedSettingsResource ? context.read(resolvedSettingsResource).value?.values?.[VIGNETTE_VOLUME_PROPERTY] : 0;
        requireFiniteNumber(inheritedIntensity, "CP-F24 resolved volume intensity", 0, 1);
        const settings = readSettings(context.settings ?? services.settings, inheritedIntensity);
        validateVignetteInput(source, context.frame, settings);
        updateVignetteUniforms(uniforms, settings, context.frame);
        const target = resources.draw(source, context.frame);
        const color = Object.freeze({ ...makeTextureResource(target, context.frame, source.encoding), ...createVignetteMetadata(source, settings) });
        const state = Object.freeze({ profile: VIGNETTE_PROFILE, enabled: settings.enabled, intensity: settings.intensity, effectiveIntensity: uniforms.cp24Intensity.value, axisScale: Object.freeze([...uniforms.cp24AxisScale.value]), order: VIGNETTE_ORDER, precision: VIGNETTE_PRECISION, referenceVerified: false, inputEncoding: source.encoding, settingsResource: resolvedSettingsResource });
        context.publish(VIGNETTE_COLOR_RESOURCE, color);
        context.publish(VIGNETTE_STATE_RESOURCE, Object.freeze({ value: state, frameId: context.frame.frameId, viewId: context.frame.viewId, generation: context.frame.generation, provenance: "gpu" }));
        return { color };
      }
    });
    services.report?.({ phase: VIGNETTE_OWNER, status: "implemented", profile: VIGNETTE_PROFILE, referenceVerified: false, certification: "BLOCKED_REFERENCE", precision: VIGNETTE_PRECISION, order: "after film, before grain and output transfer", invalidPixelPolicy: "magenta diagnostic, no runtime readback", neutralDefault: true });
  } catch (error) {
    unregister?.();
    dispose();
    throw error;
  }
  return () => { unregister(); dispose(); };
}
