import { makeTextureResource } from "../../contracts/frameContract.js";
import { createTemporalGpuResources } from "./temporalGpuResources.js";
import { temporalHistorySettingsKey, TEMPORAL_RECONSTRUCTION_PROFILE } from "./temporalSettings.js";
import { VELOCITY_DILATION_FRAGMENT } from "./velocityDilationShader.js";
import { TEMPORAL_RESOLVE_FRAGMENT } from "./temporalResolveShader.js";
import { TEMPORAL_DEPTH_FRAGMENT } from "./temporalDepthShader.js";
import { TEMPORAL_SHARPEN_FRAGMENT } from "./temporalSharpenShader.js";

const colorHistoryName = "CP-F21.color";
const depthHistoryName = "CP-F21.depth";

export function createTemporalFrameRenderer(services) {
  const { pool, history, rendererAdapter: adapter } = services;
  const resources = createTemporalGpuResources(pool, adapter);
  const scopes = new Map();
  let disposed = false;

  function releaseEffects(scope) {
    scope.releaseEffect(colorHistoryName);
    scope.releaseEffect(depthHistoryName);
  }

  function render(frame, inputs, settings) {
    if (disposed) throw new Error("CP-F21 renderer is disposed");
    if (adapter.context?.isContextLost?.()) throw new Error("CP-F21 cannot render on a lost device");
    const scope = inputs.temporal.histories;
    scopes.set(frame.viewId, scope);
    const previousState = history.read("CP-F21", "CP-F21.resolveState", frame);
    const settingsKey = JSON.stringify([temporalHistorySettingsKey(settings), inputs.color.encoding, inputs.color.colorSpace?.signature ?? "rec709", inputs.camera.projection, inputs.camera.nearMeters, inputs.camera.farMeters]);
    const settingsChanged = previousState && previousState.settingsKey !== settingsKey;
    if (!previousState || settingsChanged) releaseEffects(scope);
    const leases = [];
    try {
      const colorLease = scope.acquire(colorHistoryName, { ...frame.outputSize, format: "rgba16f", encoding: "scene-linear-rec709", exposureMode: "radiance", filter: "nearest" });
      leases.push({ lease: colorLease, closed: false });
      const depthLease = scope.acquire(depthHistoryName, { ...frame.outputSize, format: "r32f", encoding: "positive-view-depth-meters", exposureMode: "invariant", filter: "nearest" });
      leases.push({ lease: depthLease, closed: false });
      const previousColor = colorLease.read;
      const previousDepth = depthLease.read;
      const hasHistory = Boolean(previousColor && previousDepth);
      const colorTarget = colorLease.writeTarget;
      const depthTarget = depthLease.writeTarget;
      const velocityTarget = resources.acquire(frame, "dilatedVelocity", frame.renderSize);
      const rejectionTarget = resources.acquire(frame, "rejection", frame.outputSize);
      const renderSize = [frame.renderSize.width, frame.renderSize.height];
      const outputSize = [frame.outputSize.width, frame.outputSize.height];
      const depthPlanes = [inputs.camera.nearMeters, inputs.camera.farMeters];
      const hasValidity = Boolean(inputs.motionValidity);
      resources.draw("velocityDilation", VELOCITY_DILATION_FRAGMENT, {
        depthTexture: inputs.depth.texture,
        velocityTexture: inputs.velocity.texture,
        validityTexture: inputs.motionValidity?.texture ?? inputs.velocity.texture,
        renderSize,
        hasValidity,
        dilationEnabled: settings.velocityDilation
      }, velocityTarget);
      const values = {
        currentColorTexture: inputs.color.texture,
        dilatedVelocityTexture: velocityTarget.texture,
        depthTexture: inputs.depth.texture,
        validityTexture: inputs.motionValidity?.texture ?? inputs.velocity.texture,
        reactiveTexture: inputs.reactiveMask?.texture ?? inputs.velocity.texture,
        translucencyTexture: inputs.translucencyMask?.texture ?? inputs.velocity.texture,
        previousColorTexture: previousColor?.texture ?? inputs.color.texture,
        previousDepthTexture: previousDepth?.texture ?? inputs.depth.texture,
        renderSize,
        outputSize,
        jitterPixels: inputs.jitterPixels,
        depthPlanes,
        sourceExposureScale: inputs.sourceExposureScale,
        framePreExposure: frame.preExposure,
        baseHistoryWeight: settings.historyWeight,
        historySampleCount: previousColor?.sampleCount ?? 0,
        motionRejectionPixels: settings.motionRejectionPixels,
        depthRelativeThreshold: settings.depthRelativeThreshold,
        depthAbsoluteThreshold: settings.depthAbsoluteThresholdMeters,
        varianceGamma: settings.varianceGamma,
        reactiveStrength: settings.reactiveStrength,
        luminanceRejection: settings.luminanceRejection,
        hasHistory,
        accumulationEnabled: settings.enabled,
        hasValidity,
        hasReactiveMask: Boolean(inputs.reactiveMask),
        hasTranslucencyMask: Boolean(inputs.translucencyMask),
        varianceClipping: settings.clipping === "variance",
        cubicCurrentFilter: settings.reconstructionFilter === "catmull-rom",
        cubicHistoryFilter: settings.historyFilter === "catmull-rom",
        orthographicDepth: inputs.camera.projection === "orthographic",
        inputDepthLinear: inputs.depth.encoding === "positive-view-depth-meters",
        diagnosticOutput: false
      };
      resources.draw("resolve", TEMPORAL_RESOLVE_FRAGMENT, values, colorTarget);
      resources.draw("rejection", TEMPORAL_RESOLVE_FRAGMENT, { ...values, diagnosticOutput: true }, rejectionTarget);
      resources.draw("depthHistory", TEMPORAL_DEPTH_FRAGMENT, {
        depthTexture: inputs.depth.texture, rejectionTexture: rejectionTarget.texture, renderSize, jitterPixels: inputs.jitterPixels, depthPlanes,
        orthographicDepth: values.orthographicDepth, inputDepthLinear: values.inputDepthLinear
      }, depthTarget);
      let outputTarget = colorTarget;
      if (settings.enabled && settings.sharpening > 0) {
        outputTarget = resources.acquire(frame, "sharpened", frame.outputSize);
        resources.draw("sharpen", TEMPORAL_SHARPEN_FRAGMENT, { resolvedTexture: colorTarget.texture, outputSize, sharpening: settings.sharpening }, outputTarget);
      }
      const sampleCount = hasHistory && settings.enabled ? Math.min(65535, (previousColor.sampleCount ?? 1) + 1) : 1;
      const colorMetadata = {
        preExposure: frame.preExposure,
        transfer: "linear",
        samplerDecoded: false,
        colorSpace: inputs.workingColorSpace,
        jitterPixels: Object.freeze([0, 0]),
        temporalReconstruction: TEMPORAL_RECONSTRUCTION_PROFILE,
        alphaPolicy: "current-reconstructed-coverage"
      };
      const historyColor = colorLease.commit(Object.freeze({ ...makeTextureResource(colorTarget, frame, "scene-linear-rec709"), ...colorMetadata, sampleCount }));
      leases[0].closed = true;
      const depth = depthLease.commit(Object.freeze({ ...makeTextureResource(depthTarget, frame, "positive-view-depth-meters"), invalidValue: 0 }));
      leases[1].closed = true;
      const output = outputTarget === colorTarget ? historyColor : Object.freeze({ ...makeTextureResource(outputTarget, frame, "scene-linear-rec709"), ...colorMetadata });
      history.write("CP-F21", "CP-F21.resolveState", frame, { settingsKey });
      return {
        output,
        depth,
        velocity: makeTextureResource(velocityTarget, frame, "dilated-uv-motion-visibility-validity"),
        rejection: makeTextureResource(rejectionTarget, frame, "temporal-weight-reason-reactive-range"),
        metadata: Object.freeze({
          profile: TEMPORAL_RECONSTRUCTION_PROFILE,
          ...inputs.extent,
          enabled: settings.enabled,
          historyAvailable: hasHistory,
          historySourceFrameId: hasHistory ? previousColor.frameId : null,
          historyExposure: hasHistory ? previousColor.preExposure : null,
          historyReason: settingsChanged ? "resolve-settings-change" : colorLease.reason,
          resetReasons: inputs.temporal.histories.resetReasons,
          sampleCount,
          historyResolution: "output",
          reconstructionSampling: "distance-weighted-point-injection-for-upscale",
          historyCoordinateSpace: "unjittered-output-uv",
          rasterJitterPixels: Object.freeze([...inputs.jitterPixels]),
          jitterAppliedBy: "host",
          jitteredSampling: inputs.jitterPixels.some((value) => value !== 0),
          sourcePreExposure: inputs.sourcePreExposure,
          outputPreExposure: frame.preExposure,
          historySharpened: false,
          currentFilter: settings.reconstructionFilter,
          historyFilter: settings.historyFilter,
          materials: resources.materialCount(),
          submittedDraws: settings.enabled && settings.sharpening > 0 ? 5 : 4,
          depthRejection: "motion-producer-visibility-and-conservative-view-depth",
          rangePolicy: "invalid-pixels-magenta-and-rejection-alpha-one",
          fullTsr: false,
          referenceVerified: false,
          gpuReadbackInResolve: false
        })
      };
    } catch (error) {
      for (const entry of leases) if (!entry.closed) {
        try { entry.lease.abort(); } catch {}
      }
      releaseEffects(scope);
      resources.releaseView(frame.viewId);
      throw error;
    }
  }

  return Object.freeze({
    render,
    releaseView(viewId) {
      const scope = scopes.get(viewId);
      if (scope) releaseEffects(scope);
      scopes.delete(viewId);
      resources.releaseView(viewId);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [viewId, scope] of scopes) {
        try { releaseEffects(scope); }
        catch (error) {
          services.report?.({ phase: "CP-F21", type: "history-release-deferred-to-CP-F07", viewId, reason: error.message });
        }
      }
      scopes.clear();
      resources.dispose();
      history.clearOwner("CP-F21");
    }
  });
}
