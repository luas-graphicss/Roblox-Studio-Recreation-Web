import { ML_PHASE_MANIFEST } from "./mlPhaseManifest.js";
import { mlQa } from "./runtime/megaLightsTelemetry.js";

export const PHASE_STATUS = Object.freeze({
  pending: "pending",
  loaded: "loaded",
  failed: "failed",
});

const phaseStates = new Map();
const phaseInstallations = new Map();
ML_PHASE_MANIFEST.forEach((phase) => {
  phaseStates.set(phase.id, {
    id: phase.id,
    block: phase.block,
    title: phase.title,
    status: PHASE_STATUS.pending,
    detail: "phase module not created yet",
  });
});

function isModuleNotFound(error) {
  const message = String((error && error.message) || error).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("not found") ||
    message.includes("404") ||
    message.includes("failed to resolve") ||
    message.includes("error resolving") ||
    message.includes("erro ao resolver") ||
    message.includes("cannot find module") ||
    message.includes("nao foi possivel carregar")
  );
}

function recordState(phase, status, detail, installation = "unavailable") {
  const state = {
    id: phase.id,
    block: phase.block,
    title: phase.title,
    status,
    installation,
    detail: detail || "",
  };
  phaseStates.set(phase.id, state);
  return state;
}

async function loadSinglePhase(phase, installContext) {
  phaseInstallations.delete(phase.id);
  let moduleNamespace = null;
  try {
    moduleNamespace = await phase.load();
  } catch (error) {
    if (isModuleNotFound(error)) {
      return recordState(phase, PHASE_STATUS.pending, "phase module not created yet");
    }

    mlQa.error(error, phase.id + " module load");
    return recordState(phase, PHASE_STATUS.failed, "module failed to load: " + String((error && error.message) || error));
  }

  if (!moduleNamespace || typeof moduleNamespace.installPhase !== "function") {
    const detail = "module loaded but does not export installPhase(installContext)";
    mlQa.error(phase.id + ": " + detail, phase.id + " module contract");
    return recordState(phase, PHASE_STATUS.failed, detail);
  }

  if (moduleNamespace.PHASE_ID && moduleNamespace.PHASE_ID !== phase.id) {
    const detail = "module declares PHASE_ID " + moduleNamespace.PHASE_ID + " but the manifest says " + phase.id;
    mlQa.error(phase.id + ": " + detail, phase.id + " module contract");
    return recordState(phase, PHASE_STATUS.failed, detail);
  }

  try {
    const result = await moduleNamespace.installPhase(installContext);
    phaseInstallations.set(phase.id, result || null);
    if (result && result.implemented === false) {
      return recordState(phase, PHASE_STATUS.loaded, String(result.reason || "installation refused"), "refused");
    }
  } catch (error) {
    mlQa.error(error, phase.id + " installPhase");
    return recordState(phase, PHASE_STATUS.failed, "installPhase threw: " + String((error && error.message) || error));
  }

  return recordState(phase, PHASE_STATUS.loaded, "installed", "installed");
}


export async function loadAllPhases(installContext) {
  const results = [];
  for (const phase of ML_PHASE_MANIFEST) {


    results.push(await loadSinglePhase(phase, installContext));
  }

  const loaded = results.filter((state) => state.status === PHASE_STATUS.loaded).map((state) => state.id);
  const pending = results.filter((state) => state.status === PHASE_STATUS.pending).map((state) => state.id);
  const failed = results
    .filter((state) => state.status === PHASE_STATUS.failed)
    .map((state) => ({ id: state.id, detail: state.detail }));

  mlQa.phaseRegistry({ total: results.length, loaded, pending, failed });
  return { loaded, pending, failed };
}

export async function reloadPhase(phaseId, installContext) {
  const phase = ML_PHASE_MANIFEST.find((entry) => entry.id === phaseId);
  if (!phase) return null;
  return loadSinglePhase(phase, installContext);
}

export function listPhases() {
  return ML_PHASE_MANIFEST.map((phase) => phaseStates.get(phase.id));
}

export function phaseState(phaseId) {
  return phaseStates.get(phaseId) || null;
}

export function registrySummary() {
  const states = listPhases();
  return {
    total: states.length,
    loaded: states.filter((state) => state.status === PHASE_STATUS.loaded).length,
    pending: states.filter((state) => state.status === PHASE_STATUS.pending).length,
    failed: states.filter((state) => state.status === PHASE_STATUS.failed).length,
  };
}

export function phaseInstallation(phaseId) {
  return phaseInstallations.get(phaseId) || null;
}
