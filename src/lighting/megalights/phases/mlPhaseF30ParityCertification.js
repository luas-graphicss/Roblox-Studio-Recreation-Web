import { mlQa } from "../runtime/megaLightsTelemetry.js";
import {
  authorizePhaseCompletion,
  listParityTerms,
  parityLedgerSummary,
} from "../mlParityLedgerCore.js";
import {
  STRUCTURAL_RESIDUALS,
  certifyParityLedger,
  describeHonestCeiling,
} from "../mlParityCertificationCore.js";

export const PHASE_ID = "ML-F30";
const SHARED_LIGHTING_TEXTURE_UNITS = 0;
const CERTIFICATION_GLOBAL_NAME = "__mlCertification";

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;


  let evidenceByTermId = {};
  let blindRound = {};

  const certify = () =>
    certifyParityLedger({ terms: listParityTerms(), evidenceByTermId, blindRound });

  const attachEvidence = (termId, evidence) => {
    if (typeof termId !== "string" || !termId) {
      return { attached: false, reason: "a term id is required" };
    }
    evidenceByTermId = Object.assign({}, evidenceByTermId);
    evidenceByTermId[termId] = evidence;
    return { attached: true, termId, report: publish() };
  };

  const recordBlindRound = (result) => {
    blindRound = result && typeof result === "object" ? result : {};
    return publish();
  };


  const authorizedPhases = () => {
    const phaseIds = [];
    listParityTerms().forEach((term) => {
      (term.phases || []).forEach((phaseId) => {
        if (phaseIds.indexOf(phaseId) === -1) phaseIds.push(phaseId);
      });
    });
    return phaseIds.sort().map((phaseId) => authorizePhaseCompletion(phaseId));
  };

  function publish() {
    const report = certify();
    const authorizations = authorizedPhases();
    telemetry.phase(PHASE_ID, {
      implemented: true,
      title: "Parity certification: the final verdict, and the ceiling it cannot pass",
      block: "H",
      ownsPass: null,
      flag: null,
      sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
      injectsGlslInSharedProgram: false,
      globalName: CERTIFICATION_GLOBAL_NAME,
      ledgerSummary: parityLedgerSummary(),
      counts: report.counts,
      blindRound: report.blindRound,
      certified: report.certified,
      honestCeiling: report.honestCeiling,
      structuralResiduals: STRUCTURAL_RESIDUALS,
      phasesAuthorizedByTheLedger: authorizations.filter((row) => row.authorized).map((row) => row.phaseId),
      phasesBlockedByTheLedger: authorizations.filter((row) => !row.authorized).length,
      acceptance: {
        noTermCertifiedWithoutAnEvidenceLink: true,
        noTermCertifiedWhileItsSourceIsUnverified: true,
        blindRoundNeedsThreeEvaluatorsAndSeventyPercentConfusion: true,
      },
      residuals: [
        "no reference source is verified against the target Unreal version yet, so every term is reported unverified however well it works on the bench",
        "the blind round needs humans: until three of them have taken it, this phase reports it as not run",
        "the seven structural residuals of WebGL2 are declared, not solved: no amount of bench work closes them",
      ],
      waitingFor: "verified sources and attached evidence: the code is done, the proof is what is missing",
    });
    return report;
  }

  const report = publish();
  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);

  const certification = {
    certify: publish,
    attachEvidence,
    recordBlindRound,
    authorizedPhases,
    describeCeiling: () => describeHonestCeiling(report),
  };
  if (typeof window !== "undefined") window[CERTIFICATION_GLOBAL_NAME] = certification;

  return {
    implemented: true,
    phaseId: PHASE_ID,
    passName: null,
    certification,
    inspect: () => publish(),
  };
}
