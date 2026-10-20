export const READINESS = Object.freeze({
  ready: "ready",
  partial: "partial",
  blocked: "blocked",
});


export const FUTURE_REQUIREMENTS = Object.freeze([
  Object.freeze({
    id: "directLighting",
    description: "shaded direct lighting actually reaching the screen",
    owedBy: "ML-F18",
    kind: "phase",
    essential: true,
  }),
  Object.freeze({
    id: "denoisedSignal",
    description: "a temporally and spatially filtered signal, not raw stochastic noise",
    owedBy: "ML-F21",
    kind: "pass",
    passName: "spatialFilter",
    essential: true,
  }),
  Object.freeze({
    id: "shadingConfidence",
    description: "the per pixel confidence signal Future uses to decide where to trust the lighting",
    owedBy: "ML-F22",
    kind: "frameStage",
    essential: true,
  }),
  Object.freeze({
    id: "worldRadianceGrid",
    description: "the world space radiance grid Future reads away from the screen",
    owedBy: "ML-F24",
    kind: "frameStage",
    essential: true,
  }),
  Object.freeze({
    id: "publicSurface",
    description: "a documented settings surface, so Future never reaches into internal buffers",
    owedBy: "ML-F27",
    kind: "phase",
    essential: true,
  }),
  Object.freeze({
    id: "performanceEvidence",
    description: "measured gates, so Future inherits a budget and not a hope",
    owedBy: "ML-F29",
    kind: "phase",
    essential: false,
  }),
]);

function phaseIsImplemented(phaseTable, phaseId) {
  const table = phaseTable && typeof phaseTable === "object" ? phaseTable : {};
  const entry = table[phaseId];
  return Boolean(entry && entry.implemented === true);
}

function passIsImplemented(passTable, passName) {
  const passes = Array.isArray(passTable) ? passTable : [];
  const found = passes.filter((pass) => pass && pass.passName === passName)[0];
  if (!found) return false;


  return found.implemented === true || found.isStub === false;
}

function frameStageIsRegistered(frameStages, owner) {
  const stages = Array.isArray(frameStages) ? frameStages : [];
  return stages.some((stage) => stage && stage.owner === owner && stage.disabledByError !== true);
}

function requirementIsMet(requirement, input) {
  if (requirement.kind === "pass") {
    return passIsImplemented(input.passTable, requirement.passName) && phaseIsImplemented(input.phaseTable, requirement.owedBy);
  }
  if (requirement.kind === "frameStage") {
    return frameStageIsRegistered(input.frameStages, requirement.owedBy) && phaseIsImplemented(input.phaseTable, requirement.owedBy);
  }
  return phaseIsImplemented(input.phaseTable, requirement.owedBy);
}




export function evaluateFutureReadiness(request) {
  const input = request || {};
  const rows = FUTURE_REQUIREMENTS.map((requirement) => {
    const met = requirementIsMet(requirement, input);
    return {
      id: requirement.id,
      description: requirement.description,
      owedBy: requirement.owedBy,
      kind: requirement.kind,
      essential: requirement.essential,
      met,
      reason: met ? "met by " + requirement.owedBy : requirement.owedBy + " has not delivered it in this session",
    };
  });

  const unmet = rows.filter((row) => !row.met);
  const unmetEssential = unmet.filter((row) => row.essential);
  let readiness = READINESS.ready;
  if (unmetEssential.length === rows.filter((row) => row.essential).length) readiness = READINESS.blocked;
  else if (unmet.length > 0) readiness = READINESS.partial;

  return {
    rows,
    readiness,
    metCount: rows.length - unmet.length,
    total: rows.length,
    blockingReasons: unmetEssential.map((row) => row.reason),
    mayExposeAsLightingBase: unmetEssential.length === 0,
  };
}


export function describeFutureSurface() {
  return {
    readOnly: true,
    entries: [
      { key: "shadedDirectLighting", providedBy: "ML-F18", how: "the composed frame on screen" },
      { key: "spatialFilteredShading", providedBy: "ML-F21", how: "frame context key, denoised radiance" },
      { key: "shadingConfidence", providedBy: "ML-F22", how: "frame context key, per pixel confidence" },
      { key: "worldVoxelSh", providedBy: "ML-F24", how: "world space spherical harmonics grid" },
      { key: "settings", providedBy: "ML-F27", how: "the guarded public settings surface" },
    ],
    forbidden: [
      "reading history buffers directly: ML-F20 owns their lifetime and may reallocate them",
      "writing any frame context key it does not own: the context is shared and mutated in place",
    ],
  };
}
