import { makeTextureResource, validateResource } from "../../contracts/frameContract.js";
import { createMeteringLayout, METERING_RESOURCES } from "./meteringLayout.js";
import { validatePreExposure } from "./meteringSettings.js";
import { resolveManualEv100 } from "./physicalExposure.js";
import { STATISTICS_INITIAL_SHADER, STATISTICS_REDUCE_SHADER, EMPTY_METERING_SHADER } from "./statisticsShaders.js";
import { HISTOGRAM_GATHER_SHADER, HISTOGRAM_REDUCE_SHADER } from "./histogramShaders.js";
import { EXPOSURE_RESOLVE_SHADER } from "./exposureResolveShader.js";
import { createHistogramScatterPass } from "./histogramScatterPass.js";

export function createMeteringGpu({ rendererAdapter: adapter, pool, capabilities }) {
  if (!capabilities?.webgl2 || !capabilities?.floatColorBuffer || !pool?.acquire || !adapter?.THREE) throw new Error("CP-F08 requires the B00 WebGL2 float-target adapter and pool");
  const { THREE } = adapter;
  const floatBlendAvailable = Boolean(adapter.context.getExtension("EXT_float_blend"));
  const uniforms = {
    uSceneColor: { value: null }, uMeteringMask: { value: null },
    uSourceSize: { value: new THREE.Vector2() }, uMaskSize: { value: new THREE.Vector2(1, 1) },
    uHasMask: { value: false }, uLogPreExposure: { value: 0 }, uMinimumLog: { value: -20 },
    uHistogramRange: { value: new THREE.Vector2(-10, 20) }, uHistogramRows: { value: 1 }
  };
  const statisticsReduceUniforms = { uPreviousLevel: { value: null }, uPreviousSize: { value: new THREE.Vector2() } };
  const histogramReduceUniforms = { uPreviousLevel: { value: null }, uPreviousRows: { value: 1 } };
  const resolveUniforms = {
    uStatistics: { value: null }, uHistogram: { value: null }, uMode: { value: 0 },
    uHistogramRange: uniforms.uHistogramRange, uPercentiles: { value: new THREE.Vector2() },
    uEvBounds: { value: new THREE.Vector2() }, uMiddleGray: { value: 0.18 },
    uLuminanceCalibration: { value: 12.5 }, uManualEv100: { value: 0 }, uManualExposureCalibration: { value: 1.2 }
  };
  const initialMaterial = adapter.createMaterial(STATISTICS_INITIAL_SHADER, uniforms);
  const statisticsReduceMaterial = adapter.createMaterial(STATISTICS_REDUCE_SHADER, statisticsReduceUniforms);
  const gatherMaterial = adapter.createMaterial(HISTOGRAM_GATHER_SHADER, uniforms);
  const histogramReduceMaterial = adapter.createMaterial(HISTOGRAM_REDUCE_SHADER, histogramReduceUniforms);
  const resolveMaterial = adapter.createMaterial(EXPOSURE_RESOLVE_SHADER, resolveUniforms);
  const emptyMaterial = adapter.createMaterial(EMPTY_METERING_SHADER);
  const scatter = floatBlendAvailable ? createHistogramScatterPass(adapter, uniforms) : null;
  const views = new Map();
  let disposed = false;

  function releaseView(viewId) {
    const view = views.get(viewId);
    if (!view) return;
    for (const key of view.keys) pool.release(key);
    views.delete(viewId);
  }

  function acquireView(frame, source, settings, includeHistogram) {
    const signature = `${frame.generation}:${source.width}:${source.height}:${settings.mode}:${includeHistogram}`;
    let view = views.get(frame.viewId);
    if (view && view.signature !== signature) { releaseView(frame.viewId); view = null; }
    if (!view) {
      const layout = createMeteringLayout(source.width, source.height, capabilities.maxTextureSize, settings.mode, includeHistogram);
      view = { signature, layout, keys: new Set(), prefix: `CP-F08.${encodeURIComponent(frame.viewId)}` };
      views.set(frame.viewId, view);
    }
    return view;
  }

  function targetFor(view, label, width, height) {
    const key = `${view.prefix}.${label}`;
    const target = pool.acquire("CP-F08", key, { width, height, format: "r32f", filter: "nearest" });
    view.keys.add(key);
    return target;
  }

  function setSourceUniforms(preExposure, source, mask, settings) {
    uniforms.uSceneColor.value = source.texture;
    uniforms.uMeteringMask.value = mask?.texture ?? source.texture;
    uniforms.uSourceSize.value.set(source.width, source.height);
    uniforms.uMaskSize.value.set(mask?.width ?? 1, mask?.height ?? 1);
    uniforms.uHasMask.value = Boolean(mask);
    uniforms.uLogPreExposure.value = Math.log2(preExposure);
    uniforms.uMinimumLog.value = Math.log2(settings.minimumLuminance);
    uniforms.uHistogramRange.value.set(settings.histogramMinLog2, settings.histogramMaxLog2);
  }

  function renderStatistics(view) {
    let previous = null;
    for (const [index, level] of view.layout.statisticsLevels.entries()) {
      const target = targetFor(view, `statistics-${index}`, level.width, level.height);
      if (index === 0) adapter.draw(initialMaterial, target);
      else {
        statisticsReduceUniforms.uPreviousLevel.value = previous.texture;
        statisticsReduceUniforms.uPreviousSize.value.set(previous.width, previous.height);
        adapter.draw(statisticsReduceMaterial, target);
      }
      previous = target;
    }
    if (!previous) { previous = targetFor(view, "statistics-empty", 4, 1); adapter.draw(emptyMaterial, previous); }
    return previous;
  }

  function renderHistogram(view, backend) {
    let previous = null;
    for (const [index, level] of view.layout.histogramLevels.entries()) {
      const target = targetFor(view, `histogram-${index}`, level.width, level.height);
      if (index === 0) {
        uniforms.uHistogramRows.value = level.height;
        if (backend === "scatter") scatter.draw(target, view.layout.inputPixelCount);
        else adapter.draw(gatherMaterial, target);
      } else {
        histogramReduceUniforms.uPreviousLevel.value = previous.texture;
        histogramReduceUniforms.uPreviousRows.value = previous.height;
        adapter.draw(histogramReduceMaterial, target);
      }
      previous = target;
    }
    if (!previous) { previous = targetFor(view, "histogram-empty", 64, 1); adapter.draw(emptyMaterial, previous); }
    return previous;
  }

  function execute(frame, source, mask, settings) {
    if (disposed) throw new Error("CP-F08 GPU metering is disposed");
    if (adapter.context.isContextLost()) throw new Error("CP-F08 WebGL context is lost");
    validateResource(source, frame, "CP-F08 scene radiance");
    const preExposure = validatePreExposure(source.preExposure === undefined ? 1 : source.preExposure);
    if (source.encoding !== "scene-linear-rec709" || !["rgba16f", "rgba32f"].includes(source.format)) throw new Error("CP-F08 requires explicitly scene-linear Rec.709 HDR radiance");
    if (mask) {
      validateResource(mask, frame, "CP-F08 metering mask");
      if (mask.encoding !== "metering-weight-linear") throw new Error("CP-F08 mask must declare metering-weight-linear encoding");
    }
    const includeHistogram = settings.mode !== "manual" && (settings.mode === "histogram" || settings.debugHistogram);
    const backend = includeHistogram ? settings.histogramBackend === "auto" ? (floatBlendAvailable ? "scatter" : "gather") : settings.histogramBackend : "disabled";
    if (backend === "scatter" && !floatBlendAvailable) throw new Error("CP-F08 scatter histogram requires EXT_float_blend; choose gather explicitly or auto");
    const manualEv100 = settings.mode === "manual" ? resolveManualEv100(settings, frame.camera) : 0;
    const view = acquireView(frame, source, settings, includeHistogram);
    setSourceUniforms(preExposure, source, mask, settings);
    try {
      const statistics = renderStatistics(view);
      const histogram = renderHistogram(view, backend);
      const exposure = targetFor(view, "exposure", 4, 1);
      resolveUniforms.uStatistics.value = statistics.texture;
      resolveUniforms.uHistogram.value = histogram.texture;
      resolveUniforms.uMode.value = ["basic", "histogram", "manual"].indexOf(settings.mode);
      resolveUniforms.uPercentiles.value.set(settings.lowPercent, settings.highPercent);
      resolveUniforms.uEvBounds.value.set(settings.minimumEv100, settings.maximumEv100);
      resolveUniforms.uMiddleGray.value = settings.middleGray;
      resolveUniforms.uLuminanceCalibration.value = settings.luminanceCalibration;
      resolveUniforms.uManualEv100.value = manualEv100;
      resolveUniforms.uManualExposureCalibration.value = settings.manualExposureCalibration;
      adapter.draw(resolveMaterial, exposure);
      const provenance = source.provenance === "synthetic" || mask?.provenance === "synthetic" ? "synthetic" : "gpu";
      return {
        [METERING_RESOURCES.exposure]: makeTextureResource(exposure, frame, "metering-result-r32f-v1", provenance),
        [METERING_RESOURCES.histogram]: makeTextureResource(histogram, frame, "histogram-weight-64-r32f-v1", provenance),
        [METERING_RESOURCES.statistics]: makeTextureResource(statistics, frame, "metering-statistics-r32f-v1", provenance),
        [METERING_RESOURCES.metadata]: {
          frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance,
          value: Object.freeze({ mode: settings.mode, histogramAvailable: includeHistogram, histogramBackend: backend, histogramRange: [settings.histogramMinLog2, settings.histogramMaxLog2], binCount: 64, textureBytes: view.layout.textureBytes, inputPixelCount: view.layout.inputPixelCount, readback: "none", referenceVerified: false, sourceEncoding: source.encoding, preExposure, framePreExposure: frame.preExposure, sourceFrameId: source.frameId, emptyMaskPolicy: "identity exposure and zero weight", exposureFields: ["meanLog2Luminance", "targetEv100", "targetExposure", "totalWeight"], statisticsFields: ["weightedLogSum", "totalWeight", "invalidPixelCount", "blackWeight"] })
        }
      };
    } catch (error) { releaseView(frame.viewId); throw error; }
  }

  return Object.freeze({
    execute,
    releaseView,
    floatBlendAvailable,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const viewId of [...views.keys()]) releaseView(viewId);
      for (const material of [initialMaterial, statisticsReduceMaterial, gatherMaterial, histogramReduceMaterial, resolveMaterial, emptyMaterial]) material.dispose();
      scatter?.dispose();
    }
  });
}
