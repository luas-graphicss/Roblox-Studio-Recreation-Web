import { sameIdentifierSet, decodeEvidenceJson } from "./certificationData.js";
import { validateCertificationExecution } from "./certificationExecutionEvidence.js";
import { validateCertificationConsumer } from "./certificationConsumerEvidence.js";
import { validateCertificationNegativeControl } from "./certificationNegativeEvidence.js";

const renderedEvidenceKinds = new Set(["gpu", "temporal", "sequence", "integration", "conformance", "reference", "profile"]);

export function verifyCertificationMatrix(manifest, requirements, artifacts) {
  const issues = [];
  const rows = Array.isArray(manifest.matrix) ? manifest.matrix : [];
  const records = new Map(rows.map((row) => [row?.id, row]));
  if (!requirements.length || !sameIdentifierSet(rows.map((row) => row?.id), requirements.map(({ id }) => id))) issues.push({ code: "INCOMPLETE_MATRIX", path: "matrix", message: "Every required row must occur exactly once; omission and extra rows are forbidden" });
  const results = requirements.map((requirement) => {
    const row = records.get(requirement.id);
    const reasons = [];
    if (row?.status !== "passed") reasons.push(`Required row is ${row?.status ?? "missing"}`);
    if (row?.implementation !== "exact" || row?.deadFeature !== false || row?.scopeReduced !== false || row?.mocked !== false) reasons.push("Exact implementation, live consumers and unreduced, nonmocked scope must be explicit");
    try {
      const asset = artifacts.assetsById.get(row?.evidenceId);
      if (asset?.role !== "matrix-evidence" || asset.provenance !== "measured") throw new Error("Measured matrix-evidence bytes are required");
      const evidence = decodeEvidenceJson(artifacts.bytesById.get(row.evidenceId), requirement.id);
      for (const field of ["stage", "packageSha256", "referenceManifestSha256", "suiteSha256"]) if (evidence[field] !== manifest[field]) throw new Error(`Evidence belongs to a different ${field}`);
      if (evidence.requirementId !== requirement.id || evidence.owner !== requirement.owner || evidence.provenance !== "measured" || evidence.status !== "passed" || evidence.mocked !== false) throw new Error("Measured case identity, ownership or provenance differs");
      validateCertificationExecution(evidence);
      if (renderedEvidenceKinds.has(requirement.kind)) {
        validateCertificationConsumer(evidence, requirement, artifacts);
        validateCertificationNegativeControl(evidence, requirement, manifest, artifacts, row.evidenceId);
      }
    } catch (error) { reasons.push(error.message); }
    if (reasons.length) issues.push({ code: "MATRIX_ROW_BLOCKED", path: requirement.id, message: reasons.join("; ") });
    return { ...requirement, status: reasons.length ? "blocked" : "passed", reportedStatus: row?.status ?? "missing", evidenceId: row?.evidenceId ?? null, reasons };
  });
  return { passed: issues.length === 0, rows: results, issues };
}
