import { createLensFlareGpuResources } from "./lensFlareGpuResources.js";
import { readLensFlarePreExposure } from "./lensFlareInput.js";
import { LENS_FLARE_PREFILTER_FRAGMENT } from "./lensFlarePrefilter.glsl.js";
import { LENS_FLARE_BOKEH_FRAGMENT, LENS_FLARE_BOKEH_UPLOAD_FRAGMENT } from "./lensFlareBokeh.glsl.js";
import { LENS_FLARE_FEATURES_FRAGMENT } from "./lensFlareFeatures.glsl.js";
import { LENS_FLARE_GLARE_FRAGMENT, LENS_FLARE_COMPOSITION_FRAGMENT } from "./lensFlareComposition.glsl.js";

export function createLensFlareRenderer(adapter, pool) {
  const gpu = createLensFlareGpuResources(adapter, pool);
  let uploadedShape = null;
  let uploadedTarget = null;
  const contextCanvas = adapter.renderer?.domElement ?? adapter.context?.canvas;
  const ghostParameters = new Float32Array(16);
  const ghostTints = new Float32Array(24);
  const maskWeights = new Float32Array(81);

  function resetDevice() { gpu.reset(); uploadedShape = null; uploadedTarget = null; }
  contextCanvas?.addEventListener?.("webglcontextrestored", resetDevice);

  function render(source, compositionSource, frame, settings, plan) {
    const acquire = gpu.begin(frame, plan);
    let glare;
    if (plan.active) {
      const bokeh = gpu.acquireBokeh(settings.bokehShape.width, settings.bokehShape.height);
      if (uploadedTarget !== bokeh || uploadedShape !== settings.bokehShape.signature) {
        maskWeights.fill(0);
        maskWeights.set(settings.bokehShape.weights);
        gpu.draw("bokehUpload", LENS_FLARE_BOKEH_UPLOAD_FRAGMENT, { maskWeights, maskWidth: settings.bokehShape.width }, bokeh);
        uploadedShape = settings.bokehShape.signature;
        uploadedTarget = bokeh;
      }
      const prefilter = acquire("prefilter", plan.workingWidth, plan.workingHeight);
      gpu.draw("prefilter", LENS_FLARE_PREFILTER_FRAGMENT, { sourceTexture: source.texture, outputSize: [plan.workingWidth, plan.workingHeight], threshold: settings.threshold, softKnee: settings.softKnee, sourcePreExposure: readLensFlarePreExposure(source) }, prefilter);
      const filtered = acquire("filtered", plan.workingWidth, plan.workingHeight);
      gpu.draw("bokeh", LENS_FLARE_BOKEH_FRAGMENT, { sourceTexture: prefilter.texture, bokehTexture: bokeh.texture, sourceSize: [source.width, source.height], radiusPixels: plan.bokehRadiusPixels }, filtered);
      ghostParameters.fill(0);
      ghostTints.fill(0);
      settings.ghosts.forEach((ghost, index) => { ghostParameters.set([ghost.position, ghost.weight], index * 2); ghostTints.set(ghost.tint, index * 3); });
      const features = acquire("features", plan.workingWidth, plan.workingHeight);
      gpu.draw("features", LENS_FLARE_FEATURES_FRAGMENT, {
        sourceTexture: filtered.texture, sourceSize: [source.width, source.height], ghostCount: settings.ghosts.length, ghostParameters, ghostTints,
        haloIntensity: settings.haloIntensity, haloRadiusPixels: plan.haloRadiusPixels, haloTint: settings.haloTint,
        dispersionPixels: settings.dispersionPixels, featureNormalization: plan.featureNormalization, flareEnabled: true
      }, features);
      glare = acquire("glare", source.width, source.height);
      gpu.draw("glare", LENS_FLARE_GLARE_FRAGMENT, { sourceTexture: features.texture, intensity: settings.intensity, tint: settings.tint, exposureRatio: readLensFlarePreExposure(compositionSource) / readLensFlarePreExposure(source) }, glare);
    } else {
      glare = acquire("glare", 1, 1);
      gpu.draw("black", "void main() { gl_FragColor = vec4(0.0); }", {}, glare);
    }
    const color = acquire("color", compositionSource.width, compositionSource.height);
    const rangeMask = acquire("rangeMask", compositionSource.width, compositionSource.height, "rgba8");
    const values = { sourceTexture: compositionSource.texture, glareTexture: glare.texture, flareEnabled: plan.active, diagnosticOnly: true };
    gpu.draw("composition", LENS_FLARE_COMPOSITION_FRAGMENT, values, rangeMask);
    values.diagnosticOnly = false;
    gpu.draw("composition", LENS_FLARE_COMPOSITION_FRAGMENT, values, color);
    return { glare, color, rangeMask, materialCount: gpu.materialCount(), retainedViews: gpu.retainedViews() };
  }

  return Object.freeze({
    render,
    dispose() { contextCanvas?.removeEventListener?.("webglcontextrestored", resetDevice); gpu.dispose(); }
  });
}
