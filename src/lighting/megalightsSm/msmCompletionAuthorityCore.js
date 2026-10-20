import { MSM_REQUIREMENT_STATUS } from "./msmGateComparisonCore.js";
import { MSM_PHASE_COUNT, isKnownPhaseId, listPhases, phaseById } from "./msmPhaseRosterCore.js";
import {
  MSM_SECTION_11_GATE_COUNT,
  evaluateVerdictGate,
  gatesWithoutExecutableRequirement,
  verdictGatesForPhase,
} from "./msmVerdictGatesCore.js";
import {
  MSM_AMBITION_STATUS,
  MSM_SECTION_3_CONCEPT_COUNT,
  ambitionEntriesForPhase,
  ambitionLedgerCoverage,
} from "./msmAmbitionLedgerCore.js";

export const MSM_INSTRUMENT_PHASE_ID = "MSM-F1";


export function gatePlanIdsForPhase(phaseId) {
  const planIds = [];
  const remember = (planId) => {
    if (planIds.indexOf(planId) < 0) {
      planIds.push(planId);
    }
  };
  verdictGatesForPhase(phaseId).forEach((gate) => remember(gate.planId));
  ambitionEntriesForPhase(phaseId).forEach((entry) => entry.gatePlanIds.forEach(remember));
  return planIds;
}


export function phasesWithoutCorrespondingGate() {
  return listPhases()
    .filter((phase) => phase.id !== MSM_INSTRUMENT_PHASE_ID)
    .filter((phase) => gatePlanIdsForPhase(phase.id).length === 0)
    .map((phase) => phase.id);
}

function instrumentPhaseBlockingReasons() {
  const reasons = [];
  const coverage = ambitionLedgerCoverage();

  if (coverage.totalEntries !== MSM_SECTION_3_CONCEPT_COUNT) {
    reasons.push(
      "the ledger holds " + coverage.totalEntries + " concepts and section 3 declares " + MSM_SECTION_3_CONCEPT_COUNT,
    );
  }
  if (coverage.totalGates !== MSM_SECTION_11_GATE_COUNT) {
    reasons.push(
      "the registry holds " + coverage.totalGates + " gates and section 11 declares " + MSM_SECTION_11_GATE_COUNT,
    );
  }
  coverage.entriesWithoutOwningPhase.forEach((entryNumber) => {
    reasons.push("concept " + entryNumber + " names no owning phase");
  });
  coverage.entriesWithUnknownPhase.forEach((entryNumber) => {
    reasons.push("concept " + entryNumber + " names a phase that is not in the plan");
  });
  coverage.entriesWithoutGateOrRefusal.forEach((entryNumber) => {
    reasons.push("concept " + entryNumber + " has neither a gate nor a written refusal");
  });
  coverage.entriesWithUnknownGate.forEach((entryNumber) => {
    reasons.push("concept " + entryNumber + " cites a gate that does not exist in section 11");
  });
  coverage.gatesNeverCited.forEach((planId) => {
    reasons.push("gate " + planId + " closes no concept of section 3");
  });
  gatesWithoutExecutableRequirement().forEach((gate) => {
    reasons.push("gate " + gate.planId + " carries a requirement no spec can execute");
  });
  phasesWithoutCorrespondingGate().forEach((phaseId) => {
    reasons.push(phaseId + " owns no gate, so its completion could never be authorised");
  });

  return reasons;
}

function selfAuthorization(phaseId, measurements) {
  const ambitionEntryNumbers = ambitionEntriesForPhase(phaseId).map((entry) => entry.number);
  const gatePlanIds = gatePlanIdsForPhase(phaseId);
  const pendingGatePlanIds = [];
  const failedGatePlanIds = [];

  if (phaseId === MSM_INSTRUMENT_PHASE_ID) {
    return {
      ambitionEntryNumbers,
      gatePlanIds,
      pendingGatePlanIds,
      failedGatePlanIds,
      blockingReasons: instrumentPhaseBlockingReasons(),
    };
  }

  const blockingReasons = [];

  if (gatePlanIds.length === 0) {
    blockingReasons.push("no gate of section 11 corresponds to " + phaseId + ", so it cannot declare completion");
  }

  ambitionEntriesForPhase(phaseId).forEach((entry) => {
    if (entry.status === MSM_AMBITION_STATUS.refused) {
      return;
    }
    if (entry.status !== MSM_AMBITION_STATUS.proven) {
      blockingReasons.push("concept " + entry.number + " (" + entry.id + ") is " + entry.status + ", not proven");
    }
  });

  gatePlanIds.forEach((planId) => {
    const evaluation = evaluateVerdictGate(planId, measurements);
    if (!evaluation.blocks) {
      return;
    }
    if (evaluation.status === MSM_REQUIREMENT_STATUS.pending) {
      pendingGatePlanIds.push(planId);
    } else {
      failedGatePlanIds.push(planId);
    }
    blockingReasons.push("gate " + planId + " is " + evaluation.status + ": " + evaluation.reason);
  });

  return { ambitionEntryNumbers, gatePlanIds, pendingGatePlanIds, failedGatePlanIds, blockingReasons };
}












export function authorizePhaseCompletion(phaseId, measurements) {
  const measurementTable = measurements || {};

  if (!isKnownPhaseId(phaseId)) {
    return Object.freeze({
      phaseId,
      authorized: false,
      ambitionEntryNumbers: Object.freeze([]),
      gatePlanIds: Object.freeze([]),
      pendingGatePlanIds: Object.freeze([]),
      failedGatePlanIds: Object.freeze([]),
      unauthorizedDependencyIds: Object.freeze([]),
      blockingReasons: Object.freeze([
        '"' + String(phaseId) + '" is not one of the ' + MSM_PHASE_COUNT + " phases of the plan",
      ]),
    });
  }

  const own = selfAuthorization(phaseId, measurementTable);
  const blockingReasons = own.blockingReasons.slice();
  const unauthorizedDependencyIds = phaseById(phaseId).dependsOn.filter(
    (dependencyId) => selfAuthorization(dependencyId, measurementTable).blockingReasons.length > 0,
  );

  if (unauthorizedDependencyIds.length > 0) {
    blockingReasons.push("dependencies not authorised yet: " + unauthorizedDependencyIds.join(", "));
  }

  return Object.freeze({
    phaseId,
    authorized: blockingReasons.length === 0,
    ambitionEntryNumbers: Object.freeze(own.ambitionEntryNumbers),
    gatePlanIds: Object.freeze(own.gatePlanIds),
    pendingGatePlanIds: Object.freeze(own.pendingGatePlanIds),
    failedGatePlanIds: Object.freeze(own.failedGatePlanIds),
    unauthorizedDependencyIds: Object.freeze(unauthorizedDependencyIds),
    blockingReasons: Object.freeze(blockingReasons),
  });
}

export function completionAuthoritySummary(measurements) {
  const measurementTable = measurements || {};
  const authorizations = listPhases().map((phase) => authorizePhaseCompletion(phase.id, measurementTable));
  const authorized = authorizations.filter((entry) => entry.authorized);
  return {
    totalPhases: authorizations.length,
    authorized: authorized.length,
    refused: authorizations.length - authorized.length,
    authorizedPhaseIds: authorized.map((entry) => entry.phaseId),
    phasesWithoutCorrespondingGate: phasesWithoutCorrespondingGate(),
    instrumentPhaseId: MSM_INSTRUMENT_PHASE_ID,
  };
}
