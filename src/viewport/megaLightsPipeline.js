import { executeGraph, implementedPassCount, listPasses } from "../lighting/megalights/mlPassGraph.js";
import { frameStageCount, listFrameStages, runFrameStages } from "../lighting/megalights/mlFrameStages.js";
import {
  isFlagActive,
  listFlags,
  setOverrideProvider,
} from "../lighting/megalights/runtime/megaLightsFlagRegistry.js";
import {
  MASTER_BASELINE_FLAG_ID,
  MASTER_ENABLE_FLAG_ID,
} from "../lighting/megalights/runtime/megaLightsMasterSwitchCore.js";
import { setContextProvider } from "../lighting/megalights/runtime/megaLightsPatchRegistry.js";
import { mlQa } from "../lighting/megalights/runtime/megaLightsTelemetry.js";
import { createMegaLightsSceneResources } from "./megaLightsSceneResources.js";
import {
  installMegaLightsPhasesOnce,
  megaLightsInstallReport,
} from "./megaLightsPhaseInstaller.js";
import {
  createMegaLightsEngineHost,
  describeMegaLightsEngineHost,
} from "./megaLightsEngineHost.js";


export const MEGALIGHTS_REFUSAL = Object.freeze({
  none: "none",
  notFutureTechnology: "technology is not Future",
  masterFlagOff: "MegaLightsEnabled is off for this tier",
  viewportDisabled: "MegaLights is disabled by the viewport",
  baselineVeto: "MegaLightsBaseline vetoes the pipeline",
  noCamera: "no camera was handed to the frame",
  disabledAfterFailures: "disabled after repeated frame failures",
});


const MAX_CONSECUTIVE_FRAME_FAILURES = 8;

const FRAME_SOURCE_ENGINE = "engine-render-loop";


const LIGHT_TELEMETRY_OWNER = "ML-F4";
const LIGHT_TELEMETRY_SOURCE_PUBLISHED = LIGHT_TELEMETRY_OWNER + " lightSceneData";


const lightTelemetryBuf = { total: 0, capacity: 0, source: "" };

function publishLightTelemetry(frameContext) {
  const packedLights = frameContext ? frameContext.lightSceneData : null;
  const isPublished = !!(packedLights && packedLights.ready);
  lightTelemetryBuf.total = isPublished ? Number(packedLights.lightCount) || 0 : 0;
  lightTelemetryBuf.capacity = isPublished ? Number(packedLights.capacity) || 0 : 0;


  lightTelemetryBuf.source = isPublished
    ? LIGHT_TELEMETRY_SOURCE_PUBLISHED
    : LIGHT_TELEMETRY_OWNER + " published no lightSceneData this frame: " +
      String((packedLights && packedLights.reason) || "pass not installed");
  mlQa.lights(lightTelemetryBuf);
}











export function createMegaLightsPipeline(setup) {
  const config = setup || {};
  const shaderLibrary = config.THREE || null;
  const renderer = config.renderer || null;
  const scene = config.scene || null;

  let currentTierName = "";
  let currentCamera = null;
  let currentPipelineEnabled = false;
  let framesDriven = 0;
  let consecutiveFailureCount = 0;
  let disabledAfterFailures = false;
  let lastFailureMessage = "";
  let lastRefusal = MEGALIGHTS_REFUSAL.notFutureTechnology;
  let lastFrameReport = null;
  let debugObserver = null;
  let phaseInstallObserved = false;
  let disposed = false;





  const engineHost = createMegaLightsEngineHost({
    THREE: shaderLibrary,
    renderer,
    scene,
    readCamera: () => currentCamera,
    readTierName: () => currentTierName,
  });

  const sceneResources = createMegaLightsSceneResources({ THREE: shaderLibrary, renderer, host: engineHost });

  function notifyDebug(frameContext, request) {
    if (!debugObserver) return;
    try { debugObserver({ frameContext, report: lastFrameReport, request, host: engineHost }); }
    catch (error) { mlQa.error(error, "MegaLights debug observer"); }
  }

  if (typeof config.overrideProvider === "function") {
    setOverrideProvider(config.overrideProvider);
  }


  setContextProvider(() => ({
    enabled: currentPipelineEnabled,
    tier: currentTierName,
    flag: (flagId) => isFlagActive(flagId, currentTierName),
  }));

  function refusalFor(request) {
    if (disposed) return "pipeline disposed";
    if (disabledAfterFailures) return MEGALIGHTS_REFUSAL.disabledAfterFailures;
    if (request.technology !== "Future") return MEGALIGHTS_REFUSAL.notFutureTechnology;
    if (request.megaLightsEnabled === false) return MEGALIGHTS_REFUSAL.viewportDisabled;
    if (!request.camera) return MEGALIGHTS_REFUSAL.noCamera;
    if (!isFlagActive(MASTER_ENABLE_FLAG_ID, request.tierName)) return MEGALIGHTS_REFUSAL.masterFlagOff;
    if (isFlagActive(MASTER_BASELINE_FLAG_ID, request.tierName)) return MEGALIGHTS_REFUSAL.baselineVeto;
    return MEGALIGHTS_REFUSAL.none;
  }

  function buildFrameContext(request) {
    const tierName = request.tierName;
    return {
      THREE: shaderLibrary,
      renderer,
      scene,
      camera: request.camera,
      tier: tierName,
      frameIndex: Number(request.frameIndex) || 0,
      frameSource: FRAME_SOURCE_ENGINE,
      nowMilliseconds: Number(request.nowMilliseconds) || 0,
      deltaMilliseconds: Number(request.deltaMilliseconds) || 0,
      drawingBufferSize: { x: Math.max(1, Number(request.pixelWidth) || 1), y: Math.max(1, Number(request.pixelHeight) || 1) },
      resolution: {
        width: Math.max(1, Math.floor(Number(request.pixelWidth) || 0)),
        height: Math.max(1, Math.floor(Number(request.pixelHeight) || 0)),
      },

      bench: engineHost,


      lights: [],
      mlQa,
      isFlagActive: (flagId) => isFlagActive(flagId, tierName),
    };
  }

  function recordFrameFailure(error, whileDoing) {
    consecutiveFailureCount += 1;
    lastFailureMessage = whileDoing + ": " + String((error && error.message) || error);
    mlQa.error(error, { megaLightsFrame: whileDoing, frameIndex: framesDriven });
    if (consecutiveFailureCount >= MAX_CONSECUTIVE_FRAME_FAILURES) {
      disabledAfterFailures = true;
      currentPipelineEnabled = false;
      mlQa.error(
        new Error(
          "MegaLights stood down after " + consecutiveFailureCount +
            " consecutive failed frames; the legacy path keeps rendering",
        ),
        { megaLightsFrame: "stand down" },
      );
    }
  }

  return {


    runFrame(frameRequest) {
      const request = frameRequest || {};
      currentTierName = String(request.tierName || "");
      currentCamera = request.camera || null;

      const refusal = refusalFor(request);
      lastRefusal = refusal;
      currentPipelineEnabled = refusal === MEGALIGHTS_REFUSAL.none;
      if (refusal !== MEGALIGHTS_REFUSAL.none) {
        lastFrameReport = { ran: false, refusal, frameIndex: Number(request.frameIndex) || 0 };
        notifyDebug(null, request);
        return lastFrameReport;
      }


      sceneResources.ensure();
      const phaseInstall = installMegaLightsPhasesOnce({
        THREE: shaderLibrary,
        renderer,
        scene,


        bench: engineHost,
        gBuffer: sceneResources.gBuffer(),
        mlQa,
        host: "engine",
      });
      if (!phaseInstallObserved) {
        phaseInstallObserved = true;
        phaseInstall.then(() => { if (disposed) sceneResources.dispose(); });
      }

      let graphReport = null;
      let stageReport = null;
      try {
        const frameContext = buildFrameContext(request);
        executeGraph(frameContext);
        stageReport = runFrameStages(frameContext);
        graphReport = frameContext;
        consecutiveFailureCount = 0;
      } catch (error) {
        recordFrameFailure(error, "runFrame");
        lastFrameReport = {
          ran: false,
          refusal: MEGALIGHTS_REFUSAL.none,
          failure: lastFailureMessage,
          frameIndex: Number(request.frameIndex) || 0,
        };
        notifyDebug(null, request);
        return lastFrameReport;
      }

      framesDriven += 1;
      mlQa.tier(currentTierName);
      publishLightTelemetry(graphReport);
      mlQa.render({
        frames: framesDriven,
        frameSource: FRAME_SOURCE_ENGINE,
        realClockFrozen: false,
      });

      lastFrameReport = {
        ran: true,
        refusal: MEGALIGHTS_REFUSAL.none,
        frameIndex: graphReport.frameIndex,
        tier: currentTierName,
        executedStages: stageReport ? stageReport.executed.slice() : [],
        failedStages: stageReport ? stageReport.failed.slice() : [],
      };
      notifyDebug(graphReport, request);
      return lastFrameReport;
    },

    setDebugObserver(observer) {
      debugObserver = typeof observer === "function" ? observer : null;
      return () => { if (debugObserver === observer) debugObserver = null; };
    },

    dispose() {
      disposed = true;
      currentPipelineEnabled = false;
      debugObserver = null;
      if (megaLightsInstallReport().status !== "running") sceneResources.dispose();
    },


    isDrivingFrames() {
      return !disposed && lastRefusal === MEGALIGHTS_REFUSAL.none && !disabledAfterFailures;
    },


    resumeAfterFailures() {
      disabledAfterFailures = false;
      consecutiveFailureCount = 0;
      lastFailureMessage = "";
      return true;
    },


    snapshot() {
      return {
        framesDriven,
        tier: currentTierName,
        refusal: lastRefusal,
        disabledAfterFailures,
        lastFailureMessage,
        lastFrame: lastFrameReport,
        passesImplemented: implementedPassCount(),
        passes: listPasses(),
        frameStageCount: frameStageCount(),
        frameStages: listFrameStages(),
        flags: listFlags(currentTierName),
        install: megaLightsInstallReport(),
        host: describeMegaLightsEngineHost(engineHost),
        sceneResources: sceneResources.describe(),
      };
    },
  };
}
