import { callSynchronousMethod, requireSynchronousCallback } from "./synchronousCallbacks.js";
import { normalizeConfiguration } from "./adapterConfiguration.js";
import { requireSettingsObject } from "./adapterValidation.js";
import { createDeferredRuntime } from "./deferredRuntime.js";
import { executeCinematicFrame } from "./executeCinematicFrame.js";
import { resolvePixelDimensions } from "./pixelDimensions.js";
import { resolveAdapterRoute } from "./promotionPolicy.js";

export function createCinematicPostProcess({ host, createRuntime, schedule, configuration: initial = {}, verifyPromotion, report: reporter = () => {} }) {
  const requiredHostMethods = ["getState", "getFrame", "readGetters", "finalizeFrame", "captureInputs", "present", "renderLegacy", "withFrameState", "acknowledgeOwnership", "subscribeDevice", "requestRender"];
  for (const name of requiredHostMethods) requireSynchronousCallback(host?.[name], `Host ${name}`);
  let configuration = normalizeConfiguration(initial);
  let dimensions = null;
  let disposed = false;
  let rendering = false;
  let deviceStatus = "ready";
  let appliedSettings = null;
  let activeRoute = false;
  let latest = { presented: false, route: { active: false, reason: "not-rendered" } };
  let requestedSettings = configuration.settings;

  function report(event) {
    try { reporter({ owner: "CP-F34", ...event }); } catch {}
  }

  function assertMutable() {
    if (disposed) throw new Error("Adapter is disposed");
    if (rendering) throw new Error("Adapter mutation during render is not allowed");
  }

  function notify() {
    if (!disposed) {
      try { callSynchronousMethod(host, "requestRender"); } catch (error) { report({ type: "request-render-failed", message: error.message }); }
    }
  }

  const deferred = createDeferredRuntime({ createRuntime, schedule, report, notify, initialize(runtime) {
    callSynchronousMethod(runtime, "configure", requestedSettings);
    appliedSettings = JSON.stringify(requestedSettings);
    if (dimensions) callSynchronousMethod(runtime, "resize", dimensions);
  } });

  function fallback(request, route) {
    if (deviceStatus !== "ready") return { presented: false, route: { active: false, reason: deviceStatus } };
    try {
      if (callSynchronousMethod(host, "getState")?.deviceReady === false) return { presented: false, route: { active: false, reason: "device-unavailable" } };
    } catch (error) {
      report({ type: "device-state-failed", message: error.message });
      return { presented: false, route: { active: false, reason: "device-state-unavailable" } };
    }
    let presented = false;
    try {
      const returned = callSynchronousMethod(host, "renderLegacy", request.cssWidth, request.cssHeight);
      if (typeof returned !== "boolean") throw new TypeError("Legacy render must return a boolean");
      presented = returned;
    } catch (error) {
      report({ type: "legacy-render-failed", message: error.message });
      return { presented: true, uncertainPresentation: true, route: { active: false, reason: "legacy-presentation-uncertain" } };
    }
    return { presented, route };
  }

  function applySettings(route) {
    requestedSettings = requireSettingsObject({ ...route.defaults, ...configuration.settings });
    const signature = JSON.stringify(requestedSettings);
    const runtime = deferred.get();
    if (runtime && signature !== appliedSettings) {
      callSynchronousMethod(runtime, "configure", requestedSettings);
      appliedSettings = signature;
    }
  }

  function resize(width, height, pixelRatio = 1) {
    assertMutable();
    return updateDimensions(resolvePixelDimensions(width, height, pixelRatio, configuration.renderScale));
  }

  function updateDimensions(next) {
    if (JSON.stringify(next) === JSON.stringify(dimensions)) return false;
    const runtime = deferred.get();
    try {
      if (runtime) callSynchronousMethod(runtime, "resize", next);
      dimensions = next;
    } catch (error) { deferred.fail(error); throw error; }
    return true;
  }

  function configure(patch) {
    assertMutable();
    const next = normalizeConfiguration(patch, configuration);
    const structuralChange = next.environment !== configuration.environment || next.packageRevision !== configuration.packageRevision || JSON.stringify(next.ownership) !== JSON.stringify(configuration.ownership) || JSON.stringify(next.output) !== JSON.stringify(configuration.output);
    const oldScale = configuration.renderScale;
    configuration = next;
    if (structuralChange) deferred.invalidate("cold", "configuration-changed");
    if (oldScale !== next.renderScale && dimensions) resize(dimensions.cssSize.width, dimensions.cssSize.height, dimensions.pixelRatio);
    if (next.safeMode || next.enabled === false) {
      deferred.invalidate("cold", "legacy-route-selected");
      activeRoute = false;
    }
    notify();
    return configuration;
  }

  function render(width, height, pixelRatio = 1) {
    if (disposed) return { presented: false, route: { active: false, reason: "disposed" } };
    if (rendering) throw new Error("Reentrant adapter rendering is not allowed");
    const request = { cssWidth: width, cssHeight: height };
    let nextDimensions;
    try { nextDimensions = resolvePixelDimensions(width, height, pixelRatio, configuration.renderScale); }
    catch (error) { report({ type: "invalid-size", message: error.message }); return latest = { presented: false, route: { active: false, reason: "invalid-size" } }; }
    rendering = true;
    try {
      if (deviceStatus !== "ready") return latest = { presented: false, route: { active: false, reason: deviceStatus } };
      const state = callSynchronousMethod(host, "getState");
      if (state?.deviceReady === false) {
        if (activeRoute || ["scheduled", "loading"].includes(deferred.snapshot().status)) deferred.invalidate("cold", "device-unavailable");
        activeRoute = false;
        dimensions = nextDimensions;
        return latest = { presented: false, route: { active: false, reason: "device-unavailable" } };
      }
      const route = resolveAdapterRoute(configuration, state, verifyPromotion);
      if (!route.active) {
        if (activeRoute || ["scheduled", "loading"].includes(deferred.snapshot().status)) deferred.invalidate("cold", "legacy-route-selected");
        activeRoute = false;
        dimensions = nextDimensions;
        return latest = fallback(request, route);
      }
      activeRoute = true;
      try { updateDimensions(nextDimensions); }
      catch (error) {
        report({ type: "runtime-resize-failed", message: error.message });
        return latest = fallback(request, { active: false, reason: "runtime-resize-failed" });
      }
      applySettings(route);
      deferred.ensure();
      const runtime = deferred.get();
      if (!runtime) return latest = fallback(request, { active: false, reason: `runtime-${deferred.snapshot().status}` });
      const result = executeCinematicFrame({ host, runtime, request: { ...request, dimensions }, configuration, route, assertActive() {
        if (deviceStatus !== "ready" || deferred.get() !== runtime || callSynchronousMethod(host, "getState")?.deviceReady !== true) throw new Error("Frame device or runtime became unavailable");
      } });
      if (result.error) { report({ type: result.route.reason, message: result.error.message }); deferred.fail(result.error); }
      if (!result.presented) return latest = fallback(request, result.error ? result.route : { active: false, reason: "presentation-declined" });
      return latest = { ...result, error: result.error?.message };
    } catch (error) {
      deferred.fail(error);
      return latest = fallback(request, { active: false, reason: "host-contract-failed" });
    } finally { rendering = false; }
  }

  function reset(reason = "manual-reset") {
    assertMutable();
    if (typeof reason !== "string" || !reason) throw new TypeError("Reset reason is required");
    const runtime = deferred.get();
    if (runtime) {
      try { callSynchronousMethod(runtime, "reset", reason); }
      catch (error) { deferred.fail(error); throw error; }
    } else deferred.invalidate("cold", reason);
    notify();
  }

  const unsubscribe = callSynchronousMethod(host, "subscribeDevice", (event) => {
    if (disposed) return;
    if (event === "lost" || event === "suspend") {
      deviceStatus = event === "lost" ? "device-lost" : "suspended";
      deferred.invalidate(deviceStatus, event);
    } else if (event === "restored" || event === "resume") {
      deviceStatus = "ready";
      deferred.invalidate("cold", event);
      appliedSettings = null;
      notify();
    } else report({ type: "unknown-device-event", event });
  });
  requireSynchronousCallback(unsubscribe, "Device unsubscription");

  return Object.freeze({ configure, resize, render, reset,
    snapshot: () => ({ version: "1.0.0", disposed, deviceStatus, dimensions, lifecycle: deferred.snapshot(), route: { ...latest.route }, presented: latest.presented, uncertainPresentation: latest.uncertainPresentation === true, frameId: latest.frameId ?? null, viewId: latest.viewId ?? null, passes: Array.isArray(latest.passes) ? [...latest.passes] : [] }),
    dispose() {
      if (disposed) return;
      assertMutable();
      disposed = true;
      latest = { presented: false, route: { active: false, reason: "disposed" } };
      try { unsubscribe(); } catch (error) { report({ type: "unsubscribe-failed", message: error.message }); }
      deferred.invalidate("disposed", "disposed");
      dimensions = null;
    }
  });
}
