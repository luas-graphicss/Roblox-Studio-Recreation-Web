import { MGL_GATES } from "./mlPipelineContract.js";
import { ML_PARITY_TERM_STATUS } from "./mlParityLedgerCore.js";

export const CERTIFICATION = Object.freeze({
  matched: "matched",
  approximated: "approximated",
  residual: "residual",
  unverified: "unverified",
});

export const CERTIFICATION_REASON = Object.freeze({
  provenWithVerifiedSource: "proven on the bench, with evidence and a source verified against the target Unreal version",
  provenButSourceUnverified:
    "proven on the bench, but no source verifies the target Unreal version: the target itself is unconfirmed, so the match cannot be certified",
  inBenchWithEvidence: "implemented on the bench with evidence, gate not satisfied at the reference number",
  refusedOnPurpose: "deliberately not pursued, with a named reason: a declared residual, never a silent gap",
  noEvidence: "no evidence link: a term nobody can open is not certified, whatever its status says",
  openTerm: "nothing built for this term yet",
});


export const STRUCTURAL_RESIDUALS = Object.freeze([
  "no hardware ray tracing: every visibility test is a screen space or proxy trace, so what is off screen was never in the frame to be hit",
  "no compute shaders and no group shared memory: every reduction becomes a fragment pass over a texture",
  "no bindless textures: the sampler budget is 16 units, which is why every phase declares what it spends",
  "no 64 bit atomics: light grid compaction cannot be done the way the engine does it",
  "no mesh shaders and no hardware virtual shadow map page tables: the page table is emulated on the CPU",
  "no async compute: nothing overlaps, so every millisecond of the light pipeline is a millisecond of the frame",
  "no wave or subgroup intrinsics: per lane sorting and voting are emulated, and cost what emulation costs",
]);

function evidenceLinkOf(evidence) {
  if (!evidence) return null;
  if (typeof evidence === "string") return evidence.trim() || null;
  if (typeof evidence.url === "string" && evidence.url.trim()) return evidence.url.trim();
  if (typeof evidence.id === "string" && evidence.id.trim()) return evidence.id.trim();
  return null;
}






export function certifyTerm(request) {
  const input = request || {};
  const term = input.term || {};
  const evidenceLink = evidenceLinkOf(input.evidence);
  const status = term.status || ML_PARITY_TERM_STATUS.open;

  const row = {
    number: term.number === undefined ? null : term.number,
    id: term.id || null,
    term: term.term || null,
    phases: Array.isArray(term.phases) ? term.phases.slice() : [],
    status,
    needsVerification: term.needsVerification === true,
    evidence: evidenceLink,
    gateMetric: term.gate && term.gate.metric ? term.gate.metric : null,
  };


  if (status === ML_PARITY_TERM_STATUS.refused) {
    return Object.assign(row, {
      certification: CERTIFICATION.residual,
      reason: CERTIFICATION_REASON.refusedOnPurpose,
    });
  }
  if (!evidenceLink) {
    return Object.assign(row, {
      certification: CERTIFICATION.unverified,
      reason: status === ML_PARITY_TERM_STATUS.open ? CERTIFICATION_REASON.openTerm : CERTIFICATION_REASON.noEvidence,
    });
  }
  if (status === ML_PARITY_TERM_STATUS.proven) {
    if (row.needsVerification) {
      return Object.assign(row, {
        certification: CERTIFICATION.unverified,
        reason: CERTIFICATION_REASON.provenButSourceUnverified,
      });
    }
    return Object.assign(row, {
      certification: CERTIFICATION.matched,
      reason: CERTIFICATION_REASON.provenWithVerifiedSource,
    });
  }
  if (status === ML_PARITY_TERM_STATUS.inBench) {
    return Object.assign(row, {
      certification: CERTIFICATION.approximated,
      reason: CERTIFICATION_REASON.inBenchWithEvidence,
    });
  }
  return Object.assign(row, {
    certification: CERTIFICATION.unverified,
    reason: CERTIFICATION_REASON.openTerm,
  });
}


export function evaluateBlindRound(request) {
  const input = request || {};
  const evaluatorCount = typeof input.evaluatorCount === "number" ? input.evaluatorCount : null;
  const confusionRate = typeof input.confusionRate === "number" ? input.confusionRate : null;
  const requiredEvaluators = MGL_GATES.blindRoundMinimumEvaluators;
  const requiredConfusion = MGL_GATES.blindRoundMinimumConfusionRate;

  if (evaluatorCount === null || confusionRate === null) {
    return {
      ran: false,
      passed: false,
      evaluatorCount,
      confusionRate,
      requiredEvaluators,
      requiredConfusion,
      reason: "the blind round has not been run: no evaluator count and no confusion rate were supplied",
    };
  }
  if (requiredEvaluators > evaluatorCount) {
    return {
      ran: true,
      passed: false,
      evaluatorCount,
      confusionRate,
      requiredEvaluators,
      requiredConfusion,
      reason: "fewer than " + requiredEvaluators + " evaluators: that is an anecdote, not a blind round",
    };
  }
  const passed = confusionRate >= requiredConfusion;
  return {
    ran: true,
    passed,
    evaluatorCount,
    confusionRate,
    requiredEvaluators,
    requiredConfusion,
    reason: passed
      ? "evaluators could not reliably tell the two images apart"
      : "evaluators picked our image too often: at that confusion rate it is not parity",
  };
}


export function certifyParityLedger(request) {
  const input = request || {};
  const terms = Array.isArray(input.terms) ? input.terms : [];
  const evidenceByTermId = input.evidenceByTermId && typeof input.evidenceByTermId === "object" ? input.evidenceByTermId : {};

  const rows = terms.map((term) => certifyTerm({ term, evidence: evidenceByTermId[term && term.id] }));
  const countOf = (certification) => rows.filter((row) => row.certification === certification).length;
  const matched = countOf(CERTIFICATION.matched);
  const approximated = countOf(CERTIFICATION.approximated);
  const residual = countOf(CERTIFICATION.residual);
  const unverified = countOf(CERTIFICATION.unverified);
  const blindRound = evaluateBlindRound(input.blindRound);

  return {
    rows,
    counts: { total: rows.length, matched, approximated, residual, unverified },
    blindRound,
    structuralResiduals: STRUCTURAL_RESIDUALS,
    everyTermResolved: unverified === 0,


    certified: unverified === 0 && blindRound.passed,
    honestCeiling: describeHonestCeiling({ counts: { total: rows.length, matched, approximated, residual, unverified }, blindRound }),
  };
}


export function describeHonestCeiling(report) {
  const counts = (report && report.counts) || { total: 0, matched: 0, approximated: 0, residual: 0, unverified: 0 };
  const blindRound = (report && report.blindRound) || { ran: false, passed: false };
  const parts = [
    counts.matched + " of " + counts.total + " terms certified as matched",
    counts.approximated + " approximated",
    counts.residual + " declared residual",
    counts.unverified + " unverified",
  ];
  const blindRoundSentence = blindRound.ran
    ? blindRound.passed
      ? "the blind round passed"
      : "the blind round ran and did not pass"
    : "the blind round has not been run";
  return parts.join(", ") + "; " + blindRoundSentence + ".";
}
