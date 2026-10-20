import {
  CHROMATIC_OWNER,
  CHROMATIC_PASS,
  CHROMATIC_COLOR,
  CHROMATIC_STATE,
  CHROMATIC_PROFILE,
  CHROMATIC_ORDER,
} from "./chromaticContract.js";
import { createChromaticSettingsReader } from "./chromaticSettings.js";
import { resolveChromaticGeometry } from "./chromaticGeometry.js";
import { validateChromaticInput } from "./chromaticInput.js";
import { createChromaticColor } from "./chromaticMetadata.js";
import { createChromaticResources } from "./chromaticResources.js";

export function installChromaticAberration(services, bindings) {
  const { graph, pool, rendererAdapter: adapter, capabilities } = services;
  if (!capabilities?.webgl2 || !capabilities.floatColorBuffer)
    throw new Error("CP-F23 requires WebGL2 and float color buffers; no RGBA8 fallback");
  if (!Number.isInteger(capabilities.maxTextureSize) || capabilities.maxTextureSize < 1)
    throw new TypeError("CP-F23 requires maxTextureSize capability");
  if (
    !graph?.register ||
    !pool?.acquire ||
    !pool?.release ||
    !pool?.releaseOwner ||
    !adapter?.createMaterial ||
    !adapter?.draw
  )
    throw new TypeError("CP-F23 requires graph, resource pool and renderer services");
  const readSettings = createChromaticSettingsReader(services.settings);
  readSettings("installation");
  const resources = createChromaticResources(adapter, pool, capabilities);
  let unregister;
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    resources.dispose();
  }
  try {
    unregister = graph.register({
      id: CHROMATIC_PASS,
      owner: CHROMATIC_OWNER,
      stage: "lensWarp",
      order: CHROMATIC_ORDER,
      reads: bindings.cameraResource
        ? [bindings.sourceResource, bindings.cameraResource]
        : [bindings.sourceResource],
      writes: [CHROMATIC_COLOR, CHROMATIC_STATE],
      transformsColor: true,
      dispose,
      execute(context) {
        if (disposed) throw new Error("CP-F23 has been disposed");
        const source = context.read(bindings.sourceResource);
        const settings = readSettings(context.frame.viewId);
        validateChromaticInput(source, context.frame, settings);
        const camera = bindings.cameraResource ? context.read(bindings.cameraResource) : null;
        const geometry = resolveChromaticGeometry(settings, source, context.frame, camera);
        const rendered = resources.draw(source, context.frame, settings, geometry);
        const color = createChromaticColor(source, rendered, context.frame, settings, geometry);
        const state = Object.freeze({
          profile: CHROMATIC_PROFILE,
          referenceVerified: false,
          settings,
          geometry,
          bindings,
          alphaPolicy:
            source.alphaMode === "premultiplied"
              ? "unpremultiply-sample-repremultiply-at-unshifted-alpha"
              : "unshifted-alpha",
          inputEncoding: source.encoding,
          invalidPixelPolicy: "magenta-diagnostic",
          timing: "not-production-timing",
        });
        context.publish(CHROMATIC_COLOR, color);
        context.publish(
          CHROMATIC_STATE,
          Object.freeze({
            value: state,
            frameId: context.frame.frameId,
            viewId: context.frame.viewId,
            generation: context.frame.generation,
            provenance: "gpu",
          }),
        );
        return { color };
      },
    });
    services.report?.({
      owner: CHROMATIC_OWNER,
      status: "implemented",
      profile: CHROMATIC_PROFILE,
      certification: "BLOCKED_REFERENCE",
      neutralDefault: true,
      lensDistortion: "not-added",
      bindings,
    });
  } catch (error) {
    unregister?.();
    dispose();
    throw error;
  }
  return () => {
    if (disposed) return;
    try {
      unregister();
    } finally {
      dispose();
    }
  };
}
