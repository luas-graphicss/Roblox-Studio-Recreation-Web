import { makeTextureResource } from "../../contracts/frameContract.js";
import { normalizeLocalExposureSettings } from "./localExposureSettings.js";
import { validateLocalExposureTextures, resolveLocalExposureControls, resolveLocalExposurePreExposure } from "./localExposureInputs.js";
import { localExposureHistoryWeight } from "./localExposureHistory.js";
import { createLocalExposureTargets } from "./localExposureTargets.js";
import { createLocalExposureMaterials, updateLocalExposureUniforms } from "./localExposureMaterials.js";

const OWNER = "CP-F10";

function valueResource(value, frame, provenance) {
  return Object.freeze({ value, frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance });
}

export function installLocalExposure(services, bindings) {
  const { rendererAdapter: adapter, capabilities, pool, history, graph, settings: settingsStore, report = () => {} } = services;
  if (!capabilities?.webgl2 || !capabilities.floatColorBuffer || capabilities.maxTextureUnits < 4) throw new Error("CP-F10 requires WebGL2, float color targets and four fragment texture units");
  if (!adapter?.createMaterial || !adapter.draw || !pool?.acquire || !pool.release || !history?.read || !history.write || !settingsStore?.get) throw new TypeError("CP-F10 requires the complete B00 rendering services");
  const materials = createLocalExposureMaterials(adapter);
  const targetStore = createLocalExposureTargets(pool, history, bindings.maxViews);
  const unregisterPasses = [];
  let disposed = false;
  let scope = null;
  let cachedSettings = null;
  let cachedAuthored = null;
  let cachedRevision = null;

  function cleanup() {
    if (disposed) return;
    disposed = true;
    for (const unregister of unregisterPasses.splice(0).reverse()) unregister();
    materials.dispose();
    targetStore.dispose();
    history.clearOwner(OWNER);
    scope = null;
  }

  function register(name, order, reads, writes, execute, transformsColor = false) {
    unregisterPasses.push(graph.register({ id: `${OWNER}.${name}`, owner: OWNER, stage: "localExposure", order, reads, writes, transformsColor, execute }));
  }

  function publishTexture(context, name, target, encoding, metadata = {}) {
    const resource = Object.freeze({ ...makeTextureResource(target, context.frame, encoding), ...metadata });
    context.publish(name, resource);
    return resource;
  }

  function currentScope(context) {
    if (!scope || scope.frameId !== context.frame.frameId || scope.viewId !== context.frame.viewId || scope.generation !== context.frame.generation) throw new Error("CP-F10 pass ran without its current-frame guide");
    return scope;
  }

  function executeFilter(context, inputName, outputName, horizontal) {
    const current = currentScope(context);
    const controls = context.read("CP-F10.controls").value;
    const input = context.read(inputName);
    updateLocalExposureUniforms(materials.filter, {
      uInput: input.texture, uDirection: horizontal ? [1 / input.width, 0] : [0, 1 / input.height],
      uRadius: controls.kernelRadiusPixels, uSpatialSigma: controls.spatialSigmaPixels,
      uRangeSigma: controls.rangeSigmaStops, uEdgeThreshold: controls.edgeThresholdStops
    });
    const target = horizontal ? current.targets.horizontal : current.targets.base;
    adapter.draw(materials.filter, target);
    publishTexture(context, outputName, target, "local-exposure-base-detail-log2");
  }

  try {
    const externalReads = [bindings.exposureResource, bindings.meteringResource].filter(Boolean);
    register("luminance", 0, [...new Set([bindings.colorResource, bindings.velocityResource, ...externalReads])], ["CP-F10.luminance", "CP-F10.controls"], (context) => {
      const color = context.read(bindings.colorResource);
      const velocity = context.read(bindings.velocityResource);
      validateLocalExposureTextures(color, velocity, context.frame, capabilities);
      const authored = settingsStore.get("CP-F10.settings");
      const revision = settingsStore.revision?.();
      if (!cachedSettings || cachedAuthored !== authored || cachedRevision !== revision) {
        cachedSettings = normalizeLocalExposureSettings(authored);
        cachedAuthored = authored;
        cachedRevision = revision;
      }
      const exposure = bindings.exposureResource ? context.read(bindings.exposureResource) : null;
      const metering = bindings.meteringResource ? context.read(bindings.meteringResource) : null;
      const controls = resolveLocalExposureControls(cachedSettings, exposure, metering);
      scope = {
        ...context.frame, width: color.width, height: color.height,
        encoding: color.encoding, sourcePreExposure: resolveLocalExposurePreExposure(color), settingsKey: JSON.stringify(controls), exposureOffsetStops: controls.exposureOffsetStops,
        targets: targetStore.acquire(context.frame.viewId, color.width, color.height)
      };
      updateLocalExposureUniforms(materials.luminance, { uSceneColor: color.texture, uPreExposure: scope.sourcePreExposure });
      adapter.draw(materials.luminance, scope.targets.luminance);
      publishTexture(context, "CP-F10.luminance", scope.targets.luminance, "scene-log2-luminance-rec709");
      context.publish("CP-F10.controls", valueResource(controls, context.frame, exposure?.provenance ?? "synthetic"));
    });
    register("horizontalBase", 10, ["CP-F10.luminance", "CP-F10.controls"], ["CP-F10.horizontalBase"], (context) => executeFilter(context, "CP-F10.luminance", "CP-F10.horizontalBase", true));
    register("bilateralBase", 20, ["CP-F10.horizontalBase", "CP-F10.controls"], ["CP-F10.base"], (context) => executeFilter(context, "CP-F10.horizontalBase", "CP-F10.base", false));
    register("temporalGain", 30, ["CP-F10.base", "CP-F10.controls", bindings.colorResource, bindings.velocityResource], ["CP-F10.gain", "CP-F10.diagnostics"], (context) => {
      const current = currentScope(context);
      const controls = context.read("CP-F10.controls").value;
      const color = context.read(bindings.colorResource);
      const previous = history.read(OWNER, "CP-F10.gain", context.frame);
      const target = context.frame.frameId % 2 === 0 ? current.targets.gainEven : current.targets.gainOdd;
      const previousIsLive = previous && [current.targets.gainEven, current.targets.gainOdd].includes(previous.target) && previous.target !== target;
      const weight = controls.enabled && previousIsLive ? localExposureHistoryWeight(previous, current, context.frame.deltaSeconds, controls.temporalHalfLifeSeconds) : 0;
      const jitterDelta = previous ? [(previous.jitterPixels[0] - context.frame.jitterPixels[0]) / color.width, (previous.jitterPixels[1] - context.frame.jitterPixels[1]) / color.height] : [0, 0];
      updateLocalExposureUniforms(materials.gain, {
        uBase: context.read("CP-F10.base").texture, uSceneColor: color.texture,
        uVelocity: context.read(bindings.velocityResource).texture, uHistory: weight > 0 ? previous.target.texture : color.texture,
        uInverseSize: [1 / color.width, 1 / color.height], uJitterDeltaUv: jitterDelta,
        uHistoryWeight: weight, uHistoryRejectionStops: controls.historyRejectionStops,
        uHighlightContrast: controls.highlightContrast, uShadowContrast: controls.shadowContrast, uDetailStrength: controls.detailStrength,
        uPivotStops: Math.log2(controls.middleGray) + controls.middleGrayBiasStops, uExposureOffsetStops: controls.exposureOffsetStops,
        uBlurredLuminanceBlend: controls.blurredLuminanceBlend, uEdgeThreshold: controls.edgeThresholdStops,
        uDetailLimit: controls.detailLimitStops, uMaxGainStops: controls.maxGainStops, uEnabled: controls.enabled
      });
      adapter.draw(materials.gain, target);
      publishTexture(context, "CP-F10.gain", target, "local-exposure-gain-stops");
      const metadata = {
        frameId: current.frameId, viewId: current.viewId, generation: current.generation, width: current.width, height: current.height,
        qualityTier: current.qualityTier, encoding: current.encoding, settingsKey: current.settingsKey,
        exposureOffsetStops: current.exposureOffsetStops, jitterPixels: [...context.frame.jitterPixels], target
      };
      history.write(OWNER, "CP-F10.gain", context.frame, metadata);
      const diagnostics = Object.freeze({
        phase: OWNER, implementation: "separable-joint-bilateral-base-detail", referenceCertified: false,
        exposureMode: bindings.exposureResource ? "bound-exposure-resource" : "manual-diagnostic-pivot",
        meteringMode: bindings.meteringResource ? "bound-metering-resource" : "not-bound",
        historyWeight: weight, pixelHistoryRejection: "velocity-validity+bounds+radiance+neighborhood-clamp",
        inputProvenance: color.provenance, sourcePreExposure: current.sourcePreExposure, gainChannels: "R: gain stops; G: scene log luminance; B: base; A: history weight, -1 means FP16 headroom limited",
        incrementalTargetBytes: color.width * color.height * targetStore.bytesPerPixel,
        passes: 5, gpuReadbacksPerFrame: 0, performanceCertified: false
      });
      context.publish("CP-F10.diagnostics", valueResource(diagnostics, context.frame, "gpu"));
      report(diagnostics);
    });
    register("compose", 40, [bindings.colorResource, "CP-F10.gain"], ["CP-F10.color"], (context) => {
      const current = currentScope(context);
      const color = context.read(bindings.colorResource);
      updateLocalExposureUniforms(materials.composite, { uSceneColor: color.texture, uGain: context.read("CP-F10.gain").texture });
      adapter.draw(materials.composite, current.targets.color);
      return { color: publishTexture(context, "CP-F10.color", current.targets.color, color.encoding, {
        preExposure: current.sourcePreExposure, transfer: "linear", samplerDecoded: false,
        ...(color.colorSpace ? { colorSpace: color.colorSpace } : {})
      }) };
    }, true);
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
