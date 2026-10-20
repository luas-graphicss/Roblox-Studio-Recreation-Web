import { loadAllPhases, listPhases, registrySummary } from "../lighting/megalights/mlPhaseRegistry.js";
import {
  checkAllAnchors,
  hasShaderLibrary,
  setShaderLibrary,
} from "../lighting/megalights/runtime/megaLightsPatchRegistry.js";
import { mlQa } from "../lighting/megalights/runtime/megaLightsTelemetry.js";

export const MEGALIGHTS_INSTALL_STATUS = Object.freeze({
  notStarted: "not started",
  running: "running",
  done: "done",
  failed: "failed",
});

let currentStatus = MEGALIGHTS_INSTALL_STATUS.notStarted;
let currentInstallPromise = null;
let phaseLoadOutcome = null;
let anchorAvailabilityReport = null;
let failureMessage = "";

function rememberFailure(error, whileDoing) {
  failureMessage = whileDoing + ": " + String((error && error.message) || error);
  mlQa.error(error, { megaLightsInstall: whileDoing });
}


export function installMegaLightsPhasesOnce(installContext) {
  if (currentInstallPromise) return currentInstallPromise;

  const context = installContext || {};
  currentStatus = MEGALIGHTS_INSTALL_STATUS.running;

  currentInstallPromise = (async () => {


    if (context.THREE && !hasShaderLibrary()) {
      try {
        setShaderLibrary(context.THREE);
      } catch (error) {
        rememberFailure(error, "setShaderLibrary");
      }
    }




    try {
      anchorAvailabilityReport = checkAllAnchors();
    } catch (error) {
      anchorAvailabilityReport = null;
      rememberFailure(error, "checkAllAnchors");
    }

    try {
      phaseLoadOutcome = await loadAllPhases(context);
      currentStatus = MEGALIGHTS_INSTALL_STATUS.done;
    } catch (error) {


      phaseLoadOutcome = null;
      currentStatus = MEGALIGHTS_INSTALL_STATUS.failed;
      rememberFailure(error, "loadAllPhases");
    }

    const report = megaLightsInstallReport();
    mlQa.phase("engine", { phaseInstall: report });
    return report;
  })();

  return currentInstallPromise;
}

export function megaLightsInstallStatus() {
  return currentStatus;
}

export function megaLightsPhasesAreInstalled() {
  return currentStatus === MEGALIGHTS_INSTALL_STATUS.done;
}


export function megaLightsInstallReport() {
  return {
    status: currentStatus,
    failureMessage,
    shaderLibraryReady: hasShaderLibrary(),
    summary: registrySummary(),
    loadedPhaseIds: phaseLoadOutcome ? phaseLoadOutcome.loaded.slice() : [],
    pendingPhaseIds: phaseLoadOutcome ? phaseLoadOutcome.pending.slice() : [],
    failedPhases: phaseLoadOutcome ? phaseLoadOutcome.failed.slice() : [],
    anchors: anchorAvailabilityReport,
  };
}

export function listMegaLightsPhases() {
  return listPhases();
}
