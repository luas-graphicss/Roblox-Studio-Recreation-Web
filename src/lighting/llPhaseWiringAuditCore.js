export const WIRING_STATE = Object.freeze({
  AWAKE: "awake",
  DORMANT: "dormant",
});


export const WIRING_REASON = Object.freeze({
  WIRED: "wired",
  NO_ENGINE_GLUE: "no-engine-glue",
  FLAG_NOT_REGISTERED: "flag-not-registered",
  PATCH_NOT_REGISTERED: "patch-not-registered",
});


export const WIRING_REASON_DETAIL = Object.freeze({
  [WIRING_REASON.WIRED]: "engine glue registered this phase",
  [WIRING_REASON.NO_ENGINE_GLUE]:
    "no engine module registered this phase: the code may exist but nothing imports it",
  [WIRING_REASON.FLAG_NOT_REGISTERED]:
    "the tri-state flag of the phase is absent from the flag registry",
  [WIRING_REASON.PATCH_NOT_REGISTERED]:
    "the GLSL patch of the phase is absent from the shader patch registry",
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}


function indexHandlesByPhaseId(phaseHandles) {
  const byPhaseId = new Map();
  for (const handle of asArray(phaseHandles)) {
    if (!handle || typeof handle !== "object") continue;
    const phaseId = asText(handle.phaseId);
    if (!phaseId) continue;
    byPhaseId.set(phaseId, handle);
  }
  return byPhaseId;
}


function readRegisteredPatchIds(registryState) {
  const state = registryState && typeof registryState === "object" ? registryState : null;
  const ids = new Set();
  if (!state) return ids;
  for (const patch of asArray(state.registeredPatches)) {
    const id = patch && typeof patch === "object" ? asText(patch.id) : "";
    if (id) ids.add(id);
  }
  return ids;
}










function auditOnePhase(phase, evidence) {
  const id = asText(phase && phase.id);
  const row = {
    id,
    block: asText(phase && phase.block),
    title: asText(phase && phase.title),
    state: WIRING_STATE.DORMANT,
    reason: WIRING_REASON.NO_ENGINE_GLUE,
    flagId: "",
    patchId: "",
    appliedThisSession: false,
    reportedTelemetry: false,
  };

  const handle = evidence.handlesByPhaseId.get(id);
  if (!handle) return row;

  row.flagId = asText(handle.flagId);
  row.patchId = asText(handle.patchId);
  row.reportedTelemetry = Object.prototype.hasOwnProperty.call(evidence.telemetryPhases, id);
  row.appliedThisSession = row.patchId ? evidence.appliedPatchIds.has(row.patchId) : false;

  if (row.flagId && !evidence.registeredFlagIds.has(row.flagId)) {
    row.reason = WIRING_REASON.FLAG_NOT_REGISTERED;
    return row;
  }
  if (row.patchId && !evidence.registeredPatchIds.has(row.patchId)) {
    row.reason = WIRING_REASON.PATCH_NOT_REGISTERED;
    return row;
  }

  row.state = WIRING_STATE.AWAKE;
  row.reason = WIRING_REASON.WIRED;
  return row;
}


export function auditLocalLightPhaseWiring(input) {
  const settings = input && typeof input === "object" ? input : {};
  const registryState = settings.registryState && typeof settings.registryState === "object"
    ? settings.registryState
    : null;
  const evidence = {
    handlesByPhaseId: indexHandlesByPhaseId(settings.phaseHandles),
    registeredFlagIds: new Set(asArray(settings.registeredFlagIds).map(asText).filter(Boolean)),
    registeredPatchIds: readRegisteredPatchIds(registryState),
    appliedPatchIds: new Set(
      registryState ? asArray(registryState.lastAppliedPatchIds).map(asText).filter(Boolean) : [],
    ),
    telemetryPhases:
      settings.telemetryPhases && typeof settings.telemetryPhases === "object"
        ? settings.telemetryPhases
        : {},
  };

  const rows = asArray(settings.phases)
    .filter((phase) => phase && asText(phase.id))
    .map((phase) => auditOnePhase(phase, evidence));

  return Object.assign(summarizeLocalLightWiring(rows), {
    rows,
    technologyGate: registryState ? registryState.technologyGate : null,
    registryRefusalCount: registryState ? asArray(registryState.refusals).length : 0,
  });
}


export function summarizeLocalLightWiring(rows) {
  const list = asArray(rows);
  const dormantIds = list
    .filter((row) => row && row.state !== WIRING_STATE.AWAKE)
    .map((row) => asText(row.id));
  const total = list.length;
  const dormantCount = dormantIds.length;
  const awakeCount = total - dormantCount;
  return {
    total,
    awakeCount,
    dormantCount,
    dormantIds,
    coverageRatio: total === 0 ? 0 : awakeCount / total,
  };
}


export function describeDormantPhases(rows) {
  return asArray(rows)
    .filter((row) => row && row.state !== WIRING_STATE.AWAKE)
    .map(
      (row) =>
        asText(row.id) +
        (row.block ? " (block " + row.block + ")" : "") +
        ": " +
        asText(row.reason) +
        " - " +
        (WIRING_REASON_DETAIL[row.reason] || ""),
    );
}
