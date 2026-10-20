import { makeTextureResource } from "../../contracts/frameContract.js";
import { LENS_FLARE_OWNER, LENS_FLARE_PROFILE, LENS_FLARE_RESOURCES } from "./lensFlareContract.js";
import { createLensFlareSettingsReader } from "./lensFlareSettings.js";
import { createLensFlarePlan } from "./lensFlarePlan.js";
import { validateLensFlareInput, makeLensFlareColorMetadata } from "./lensFlareInput.js";
import { createLensFlareRenderer } from "./createLensFlareRenderer.js";
import { validateLensFlareCapabilities } from "./lensFlareCapabilities.js";

export function installLensFlare(services) {
  const { rendererAdapter: adapter, pool, capabilities, settings, graph, report } = services;
  validateLensFlareCapabilities(capabilities);
  if (![adapter?.createMaterial, adapter?.draw, pool?.acquire, pool?.release, graph?.register].every((value) => typeof value === "function")) throw new TypeError("CP-F16 requires material, draw, pool and graph services");
  const sourceBinding = settings?.get?.("CP-F16.sourceResource") ?? "$color";
  if (typeof sourceBinding !== "string" || !sourceBinding.length || sourceBinding.startsWith("CP-F16.")) throw new TypeError("Invalid CP-F16 image source binding");
  const readSettings = createLensFlareSettingsReader(settings);
  readSettings();
  const renderer = createLensFlareRenderer(adapter, pool);
  let unregister;
  let disposed = false;
  try {
    unregister = graph.register({
      id: "CP-F16.lensFlare", owner: LENS_FLARE_OWNER, stage: "lensFlare", order: 1600,
      reads: [...new Set(["$color", sourceBinding])], writes: Object.values(LENS_FLARE_RESOURCES), transformsColor: true,
      execute(context) {
        if ((settings?.get?.("CP-F16.sourceResource") ?? "$color") !== sourceBinding) throw new Error("CP-F16 source binding changed; reinstall to declare new graph reads");
        const compositionSource = context.read("$color");
        const source = context.read(sourceBinding);
        const resolved = readSettings();
        const plan = createLensFlarePlan(compositionSource.width, compositionSource.height, resolved, capabilities.maxTextureSize);
        validateLensFlareInput(compositionSource, context.frame, capabilities, plan.active);
        if (plan.active) {
          validateLensFlareInput(source, context.frame, capabilities);
          if (source.width !== compositionSource.width || source.height !== compositionSource.height) throw new Error("CP-F16 bound source and current color must have aligned extents");
        }
        const result = renderer.render(source, compositionSource, context.frame, resolved, plan);
        const metadata = makeLensFlareColorMetadata(compositionSource, plan.active);
        const color = Object.freeze({ ...makeTextureResource(result.color, context.frame, compositionSource.encoding), ...metadata });
        const glare = Object.freeze({ ...makeTextureResource(result.glare, context.frame, compositionSource.encoding), ...metadata, includesSceneColor: false, intensityApplied: true, alreadyComposited: plan.active, alphaMode: "range-error-flag-not-coverage" });
        context.publish(LENS_FLARE_RESOURCES.color, color);
        context.publish(LENS_FLARE_RESOURCES.glare, glare);
        context.publish(LENS_FLARE_RESOURCES.rangeMask, makeTextureResource(result.rangeMask, context.frame, "lens-flare-range-flags-rgb"));
        context.publish(LENS_FLARE_RESOURCES.diagnostics, Object.freeze({
          frameId: context.frame.frameId, viewId: context.frame.viewId, generation: context.frame.generation, provenance: "gpu",
          value: Object.freeze({ profile: LENS_FLARE_PROFILE, referenceVerified: false, sourceBinding, sourceProvenance: source.provenance, plan,
            bokehAsset: resolved.bokehShape.id, bokehRevision: resolved.bokehShape.revision, bokehBlend: "last-positive-override-no-texture-interpolation",
            sourceVisibility: "rasterized-image-only-no-world-light-query", rangePolicy: "explicit-fp16-saturation-with-range-mask",
            maskChannels: "R:any-invalid-or-overflow G:composition-input-invalid B:glare-invalid-or-overflow",
            includesSceneColor: false, intensityApplied: true, alreadyComposited: plan.active, materialCount: result.materialCount, retainedViews: result.retainedViews })
        }));
        return { color };
      }
    });
    report?.({ phase: LENS_FLARE_OWNER, status: "implemented", profile: LENS_FLARE_PROFILE, referenceVerified: false });
  } catch (error) { unregister?.(); renderer.dispose(); throw error; }
  return () => { if (disposed) return; disposed = true; unregister(); renderer.dispose(); };
}
