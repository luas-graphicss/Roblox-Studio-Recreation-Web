import { PHASE_MANIFEST } from "../contracts/phaseManifest.js";

const requiredGates = Object.freeze(["contract", "cpu", "gpu", "temporal", "reference", "performance", "integration"]);

export function evaluateReadiness({ phases, reference, evidence = {}, foundationPassed = false }) {
  const states = new Map(phases.map((phase) => [phase.id, phase]));
  const phaseResults = PHASE_MANIFEST.map((definition) => {
    const state = states.get(definition.id);
    const record = evidence[definition.id];
    const missingGates = requiredGates.filter((gate) => record?.gates?.[gate] !== "passed");
    const implemented = state?.status === "implemented";
    return {
      id: definition.id,
      title: definition.title,
      implemented,
      status: state?.status ?? "missing",
      error: state?.error ?? null,
      missingGates,
      evidenceVerified: implemented && record?.provenance === "measured" && record?.reviewed === true && missingGates.length === 0
    };
  });
  const referenceVerified = reference?.verified === true && reference?.version === "5.9" && Boolean(reference?.buildId) && Boolean(reference?.captureManifestSha256) && reference?.reviewed === true;
  const complete = foundationPassed && referenceVerified && phaseResults.every((phase) => phase.evidenceVerified);
  return {
    foundationReady: foundationPassed,
    referenceVerified,
    systemComplete: complete,
    certification: complete ? "CERTIFIED_REFERENCE" : referenceVerified ? "INCOMPLETE" : "BLOCKED_REFERENCE",
    totalPhases: phaseResults.length,
    implementedPhases: phaseResults.filter((phase) => phase.implemented).length,
    verifiedPhases: phaseResults.filter((phase) => phase.evidenceVerified).length,
    phases: phaseResults
  };
}
