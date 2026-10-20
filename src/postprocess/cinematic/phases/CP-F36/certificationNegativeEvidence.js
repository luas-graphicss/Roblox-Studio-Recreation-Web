import { decodeEvidenceJson, isText } from "./certificationData.js";

export function validateCertificationNegativeControl(evidence, requirement, manifest, artifacts, evidenceId) {
  const negative = evidence.negativeControl;
  if (!negative || !["disabled", "disconnected", "invalid-input"].includes(negative.mode) || negative.detected !== true || !isText(negative.evidenceId) || negative.evidenceId === evidenceId) throw new Error("A distinct detected negative control is mandatory");
  const asset = artifacts.assetsById.get(negative.evidenceId);
  const record = decodeEvidenceJson(artifacts.bytesById.get(negative.evidenceId), "negative control");
  if (asset?.role !== "negative-control" || asset.provenance !== "measured" || record?.provenance !== "measured" || record.requirementId !== requirement.id || record.mode !== negative.mode || record.detected !== true || record.mocked !== false || !isText(record.observation)) throw new Error("Negative control is not attributable measured evidence");
  for (const field of ["stage", "packageSha256", "referenceManifestSha256", "suiteSha256"]) {
    if (record[field] !== manifest[field]) throw new Error(`Negative control belongs to a different ${field}`);
  }
}
