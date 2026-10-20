import { readBloomPreExposure } from "./bloomInputExposure.js";
import { makeTextureResource } from "../../contracts/frameContract.js";
import { BLOOM_OWNER, BLOOM_PROFILE, createBloomSettingsReader } from "./bloomSettings.js";
import { makeBloomColorResource } from "./bloomColorResource.js";
import { createBloomRenderer } from "./createBloomRenderer.js";

export function installStandardBloom(services) {
  const renderer = createBloomRenderer(services);
  const readSettings = createBloomSettingsReader(services.settings);
  const removers = [];
  let disposed = false;
  try {
    removers.push(services.graph.register({
      id: "CP-F14.buildGlare",
      owner: BLOOM_OWNER,
      stage: "bloom",
      order: 140,
      reads: ["$color"],
      writes: ["CP-F14.glare", "CP-F14.diagnostics"],
      transformsColor: false,
      execute(context) {
        const source = context.read("$color");
        const settings = readSettings();
        const result = renderer.renderGlare(source, context.frame, settings);
        context.publish("CP-F14.glare", makeBloomColorResource(result.target, context.frame, source));
        context.publish("CP-F14.diagnostics", Object.freeze({
          frameId: context.frame.frameId,
          viewId: context.frame.viewId,
          generation: context.frame.generation,
          provenance: "gpu",
          value: Object.freeze({
            owner: BLOOM_OWNER,
            profile: BLOOM_PROFILE,
            plan: result.plan,
            preExposure: readBloomPreExposure(source),
            intensity: settings.intensity,
            intensityApplied: true,
            includesSceneColor: false,
            glareAlpha: "range-error-flag-not-coverage",
            rangePolicy: "finite-fp16-saturation-with-CP-F14.rangeMask",
            boundaryPolicy: "half-sample-symmetric-mirror",
            referenceVerified: false,
            materialCount: renderer.materialCount()
          })
        }));
      }
    }));
    removers.push(services.graph.register({
      id: "CP-F14.compose",
      owner: BLOOM_OWNER,
      stage: "bloom",
      order: 141,
      reads: ["$color", "CP-F14.glare", "CP-F14.diagnostics"],
      writes: ["CP-F14.output", "CP-F14.rangeMask"],
      transformsColor: true,
      execute(context) {
        const source = context.read("$color");
        const glare = context.read("CP-F14.glare");
        const diagnostics = context.read("CP-F14.diagnostics").value;
        const result = renderer.compose(source, glare, context.frame, diagnostics.plan);
        const output = makeBloomColorResource(result.output, context.frame, source);
        context.publish("CP-F14.rangeMask", makeTextureResource(result.rangeMask, context.frame, "bloom-fp16-range-invalid"));
        context.publish("CP-F14.output", output);
        return { color: output };
      }
    }));
    services.report?.({ phase: BLOOM_OWNER, status: "implemented", profile: BLOOM_PROFILE, referenceVerified: false, rangeMask: "CP-F14.rangeMask" });
  } catch (error) {
    for (const remove of removers.reverse()) remove();
    renderer.dispose();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    for (const remove of removers.reverse()) remove();
    renderer.dispose();
  };
}
