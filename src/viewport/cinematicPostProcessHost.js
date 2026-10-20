import { createCinematicPostProcess } from "../postprocess/cinematic/phases/CP-F34/createCinematicPostProcess.js";
import { createManagedPipelineRuntime } from "../postprocess/cinematic/phases/CP-F34/createManagedPipelineRuntime.js";
import { readAuditedGetters } from "../postprocess/cinematic/phases/CP-F34/readAuditedGetters.js";
import { withThreeHostState } from "../postprocess/cinematic/phases/CP-F34/threeHostState.js";
import { loadPhaseModules } from "../postprocess/cinematic/core/phaseLoader.js";
import { createSettingsStore } from "../postprocess/cinematic/core/settingsStore.js";
import { createFrameBuilder } from "../postprocess/cinematic/render/frameBuilder.js";
import { createCinematicRendererAdapter } from "./cinematicRendererAdapter.js";
import { createCinematicSceneCapture } from "./cinematicSceneCapture.js";
import {
  CINEMATIC_ENGINE_AUDIT_DIGEST,
  CINEMATIC_PACKAGE_REVISION,
  CINEMATIC_PROMOTION_RECORD,
  verifyCinematicPromotion,
} from "./cinematicPromotionRecord.js";

const RUNTIME_OWNED_PHASES = new Set(["CP-F32", "CP-F34"]);
const RESOURCE_BUDGET_BYTES = 805306368;
const MAX_EVENTS = 64;
const FAILURE_LOG_INTERVAL_MS = 2000;
const FAILURE_PATTERN = /failed|missing|invalid|stale|blocked/;

function createLinearCaptureState(THREE, renderer) {
  let depth = 0;
  let saved = null;
  function applyLinear() {
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
  }
  function applySaved() {
    renderer.outputColorSpace = saved.outputColorSpace;
    renderer.toneMapping = saved.toneMapping;
  }
  return {
    enter() {
      if (depth++ === 0) {
        saved = { outputColorSpace: renderer.outputColorSpace, toneMapping: renderer.toneMapping };
        applyLinear();
      }
    },
    leave() {
      if (depth === 0) return;
      if (--depth === 0 && saved) {
        applySaved();
        saved = null;
      }
    },
    suspend(operation) {
      if (depth === 0 || !saved) return operation();
      applySaved();
      try {
        return operation();
      } finally {
        applyLinear();
      }
    },
  };
}

export function createCinematicPostProcessHost({
  options,
  legacy,
  readHostState,
  viewId = () => "edit",
  logger = console,
}) {
  const { THREE, renderer, scene, camera } = options;
  const rendererAdapter = createCinematicRendererAdapter({ THREE, renderer, scene, camera });
  const linearCapture = createLinearCaptureState(THREE, renderer);
  const capture = createCinematicSceneCapture({ THREE, renderer, scene, camera });
  const frameBuilder = createFrameBuilder(THREE);
  const events = [];
  const deviceListeners = new Set();
  let frameId = 0;
  let generation = 1;
  let lastTime = null;
  let lastFlag;
  let lastRouteActive = false;
  let lastFailureLog = 0;
  let phaseSummary = null;
  let disposed = false;

  function report(event) {
    events.push({ at: Date.now(), ...event });
    if (events.length > MAX_EVENTS) events.shift();
    const now = Date.now();
    if (FAILURE_PATTERN.test(String(event.type)) && now - lastFailureLog > FAILURE_LOG_INTERVAL_MS) {
      lastFailureLog = now;
      logger.warn(`[Pós cinematográfico] ${event.type}${event.message ? `: ${event.message}` : ""}`);
    }
  }

  function emitDevice(kind) {
    for (const listener of deviceListeners) listener(kind);
  }
  const onContextLost = () => emitDevice("lost");
  const onContextRestored = () => {
    generation += 1;
    frameBuilder.reset();
    capture.reset();
    rendererAdapter.clearErrors();
    emitDevice("restored");
  };
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

  function readState() {
    const state = readHostState() || {};
    return {
      technology: String(state.technology || "ShadowMap"),
      safeMode: state.safeMode === true,
      flag: state.flag === true ? true : state.flag === false ? false : null,
    };
  }

  function hostState() {
    const state = readState();
    return {
      technology: state.technology,
      safeMode: state.safeMode,
      deviceReady: !rendererAdapter.context.isContextLost(),
      capabilities: rendererAdapter.capabilities,
      promotion: CINEMATIC_PROMOTION_RECORD,
      engineAuditDigest: CINEMATIC_ENGINE_AUDIT_DIGEST,
    };
  }

  const adapter = createCinematicPostProcess({
    configuration: {
      enabled: null,
      environment: "engine",
      packageRevision: CINEMATIC_PACKAGE_REVISION,
      renderScale: 1,
    },
    verifyPromotion: verifyCinematicPromotion,
    report,
    schedule(callback) {
      const handle = setTimeout(callback, 0);
      return () => clearTimeout(handle);
    },
    async createRuntime({ signal }) {
      const loaded = await loadPhaseModules();
      phaseSummary = loaded.map(({ id, status, error }) => ({ id, status, error: error ?? null }));
      const failed = loaded.filter((phase) => phase.status === "failed");
      if (failed.length) {
        report({ type: "phase-load-failed", message: failed.map((phase) => `${phase.id}: ${phase.error}`).join("; ") });
      }
      const phases = loaded
        .filter((phase) => phase.status === "implemented" && !RUNTIME_OWNED_PHASES.has(phase.id))
        .map((phase) => phase.module);
      const settings = createSettingsStore();
      linearCapture.enter();
      try {
        return await createManagedPipelineRuntime({
        rendererAdapter,
        settings,
        phases,
        budgetBytes: RESOURCE_BUDGET_BYTES,
        report,
        signal,
        configureSettings(value) {
          for (const [key, entry] of Object.entries(value)) settings.set(key, entry);
        },
        resizeResources() {
          frameBuilder.reset();
          capture.reset();
        },
        resetResources() {
          frameBuilder.reset();
          capture.reset();
        },
        disposeResources() {
          capture.reset();
        },
      });
      } finally {
        linearCapture.leave();
      }
    },
    host: {
      getState: hostState,
      readGetters: () => readAuditedGetters(options),
      getFrame({ dimensions }) {
        const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
        const deltaSeconds = lastTime === null ? 0 : Math.min(1, Math.max(0, now - lastTime));
        lastTime = now;
        frameId += 1;
        const frame = frameBuilder.build({
          camera,
          frameId,
          timeSeconds: now,
          deltaSeconds,
          width: dimensions.renderSize.width,
          height: dimensions.renderSize.height,
          generation,
        });
        frame.viewId = viewId();
        frame.outputSize = { width: dimensions.outputSize.width, height: dimensions.outputSize.height };
        return frame;
      },
      finalizeFrame(frame) {
        const finalized = frameBuilder.finalizeCamera(frame, camera);
        frame.matrices = finalized.matrices;
        frame.camera = finalized.camera;
      },
      captureInputs(frame, getters, execution, prepared) {
        const pool = prepared?.inputContext?.pool;
        if (!pool) throw new Error("Managed preparation did not expose the resource pool");
        return capture.render(frame, pool);
      },
      present(color) {
        lastRouteActive = true;
        return capture.present(color);
      },
      renderLegacy(width, height) {
        lastRouteActive = false;
        return linearCapture.suspend(() => legacy.render(width, height));
      },
      withFrameState(operation) {
        return withThreeHostState(options, () => {
          linearCapture.enter();
          try {
            return operation();
          } finally {
            linearCapture.leave();
            capture.restoreScene();
          }
        });
      },
      acknowledgeOwnership: (ownership) => ownership,
      subscribeDevice(listener) {
        deviceListeners.add(listener);
        return () => deviceListeners.delete(listener);
      },
      requestRender() {
        if (typeof options.requestRender === "function") options.requestRender();
      },
    },
  });

  function syncFlag() {
    const { flag } = readState();
    if (flag === lastFlag) return;
    const reactivating = lastFlag === false;
    lastFlag = flag;
    adapter.configure({ enabled: flag });
    if (reactivating) adapter.reset("cinematic-flag-enabled");
  }

  function render(width, height) {
    if (disposed) return false;
    syncFlag();
    const result = adapter.render(width, height, renderer.getPixelRatio());
    if (result.route?.active !== true) lastRouteActive = false;
    return result.presented === true;
  }

  function renderLegacy(width, height) {
    if (disposed) return false;
    lastRouteActive = false;
    return linearCapture.suspend(() => legacy.render(width, height));
  }

  function setSize(width, height) {
    if (disposed) return;
    adapter.resize(width, height, renderer.getPixelRatio());
    legacy.setSize(width, height);
  }

  return Object.freeze({
    render,
    renderLegacy,
    setSize,
    getSceneRenderTarget() {
      const targets = capture.targets();
      if (lastRouteActive && targets?.color) return targets.color;
      return legacy.getSceneRenderTarget();
    },
    isPreparingForDisplay: () => legacy.isPreparingForDisplay(),
    isCinematicActive: () => lastRouteActive,
    snapshot: () => ({ ...adapter.snapshot(), flag: lastFlag ?? null, phases: phaseSummary, events: [...events] }),
    reset: (reason = "manual-reset") => adapter.reset(reason),
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      adapter.dispose();
      capture.dispose();
      rendererAdapter.dispose();
      legacy.dispose();
    },
  });
}
