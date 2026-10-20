import { mlQa } from "./runtime/megaLightsTelemetry.js";
import {
  ML_PARITY_TERM_STATUS,
  authorizePhaseCompletion,
  listParityTerms,
  parityLedgerSummary,
  parityTermById,
  parityTermByNumber,
  parityTermsForPhase,
  termsNeedingVerification,
} from "./mlParityLedgerCore.js";
import {
  auditFindingsForParityTerm,
  auditFindingsSummary,
  listAuditFindings,
  unconfirmedAuditFindings,
} from "./mlAuditFindingsCore.js";
import {
  ML_UNREAL_TARGET_VERSION,
  listReferenceSources,
  referenceSource,
} from "./mlReferenceSourcesCore.js";
import {
  canAnswerYes,
  evaluateAllGates,
  evaluateGate,
  listVerdictGates,
  verdictGatesForSection,
} from "./mlVerdictGatesCore.js";


const STANDALONE_GLOBAL_NAME = "__mlParity";

function buildParityApi() {
  return {
    termStatus: ML_PARITY_TERM_STATUS,
    targetUnrealVersion: ML_UNREAL_TARGET_VERSION,

    terms: listParityTerms,
    term: (numberOrId) =>
      typeof numberOrId === "number" ? parityTermByNumber(numberOrId) : parityTermById(numberOrId),
    termsForPhase: parityTermsForPhase,
    needsVerification: termsNeedingVerification,
    summary: parityLedgerSummary,
    authorizePhase: authorizePhaseCompletion,

    findings: listAuditFindings,
    findingsForTerm: auditFindingsForParityTerm,
    unconfirmedFindings: unconfirmedAuditFindings,
    findingsSummary: auditFindingsSummary,

    sources: listReferenceSources,
    source: referenceSource,

    gates: listVerdictGates,
    gatesForSection: verdictGatesForSection,
    evaluateGate,
    evaluateGates: evaluateAllGates,


    canAnswerYes,
  };
}

function publishTelemetry(parityApi) {
  const ledger = parityApi.summary();
  const findings = parityApi.findingsSummary();
  const verdict = parityApi.canAnswerYes({});
  mlQa.phase("ML-F1", {
    parityTerms: ledger.totalTerms,
    termsWithOwningPhase: ledger.withOwningPhase,
    termsWithExecutableGate: ledger.withExecutableGate,
    termsWithKnownSource: ledger.withKnownSource,
    termsNeedingVerification: ledger.needingVerification,
    termsProven: ledger.proven,
    gateTargetsProposedByTheBench: ledger.gateTargetsProposedByTheBench,
    verdictGates: parityApi.gates().length,
    auditFindings: findings.totalFindings,
    unconfirmedAuditFindings: findings.unconfirmed,
    canAnswerYes: verdict.yes,
  });
}


export function installLedgerGlue() {
  const parityApi = buildParityApi();
  publishTelemetry(parityApi);

  if (typeof window !== "undefined") {
    if (window.__mlLab) {
      window.__mlLab.parity = parityApi;
    } else {


      window[STANDALONE_GLOBAL_NAME] = parityApi;
      mlQa.error(
        new Error("__mlLab was not ready, the parity ledger was published as window." + STANDALONE_GLOBAL_NAME),
        "ML-F1 installLedgerGlue",
      );
    }
  }

  return parityApi;
}
