import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { installLedgerGlue } from "../mlLedgerGlue.js";
import { parityLedgerSummary } from "../mlParityLedgerCore.js";
import { auditFindingsSummary } from "../mlAuditFindingsCore.js";
import { canAnswerYes, listVerdictGates } from "../mlVerdictGatesCore.js";

export const PHASE_ID = "ML-F1";

const TEXTURE_UNITS_USED = 0;

export function installPhase() {
  const parity = installLedgerGlue();
  const ledger = parityLedgerSummary();
  const findings = auditFindingsSummary();
  const verdict = canAnswerYes({});

  mlQa.textureUnit(PHASE_ID, TEXTURE_UNITS_USED);
  mlQa.phase(PHASE_ID, {
    implemented: true,
    title: "Parity ledger",
    block: "A",
    ownsPass: null,
    registersFlag: false,
    injectsGlsl: false,
    parityTerms: ledger.totalTerms,
    termsNeedingVerification: ledger.needingVerification,
    verdictGates: listVerdictGates().length,
    auditFindings: findings.totalFindings,
    canAnswerYes: verdict.yes,
    note: "reading instrument: it authorises other phases, it does not render",
  });

  return {
    implemented: true,
    parity,
    ledger,
    findings,
    verdict,
  };
}
