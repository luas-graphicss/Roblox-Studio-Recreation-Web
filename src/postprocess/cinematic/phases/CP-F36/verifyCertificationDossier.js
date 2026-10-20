import { canonicalJson, hashCanonicalJson } from "../CP-F01/referenceHash.js";
import { readReferenceSession } from "../CP-F01/referenceSession.js";
import { createCertificationRequirements } from "./certificationRequirements.js";
import { verifyCertificationArtifacts } from "./certificationArtifacts.js";
import { verifyCertificationPackage } from "./certificationPackage.js";
import { verifyCertificationMatrix } from "./certificationMatrix.js";
import { verifyCertificationSequences } from "./certificationSequences.js";
import { verifyCertificationPerformance } from "./certificationPerformance.js";
import { verifyCertificationHandover } from "./certificationHandover.js";
import { verifyCertificationApproval } from "./certificationApproval.js";
import { createCertifiedRuntimeScopes } from "./certificationScopes.js";
import { isRecord, isText } from "./certificationData.js";

async function verifyDossier(options, priorReport) {
  const issues = [];
  const snapshot = JSON.parse(canonicalJson({ manifest: options.manifest ?? {}, referenceManifest: options.referenceManifest ?? null, sourceInventory: options.sourceInventory ?? null, budgetPolicy: options.budgetPolicy ?? null, attestation: options.attestation ?? null, trustedReviewers: options.trustedReviewers ?? [] }));
  const { manifest, referenceManifest, sourceInventory, budgetPolicy, attestation, trustedReviewers } = snapshot;
  if (!isRecord(manifest)) throw new TypeError("The certification manifest must be a plain JSON object");
  const reference = readReferenceSession(options.referenceSession);
  const referenceManifestSha256 = referenceManifest ? await hashCanonicalJson(referenceManifest) : null;
  const referenceReady = reference?.referenceReady === true && reference.manifestSha256 === referenceManifestSha256 && manifest.referenceManifestSha256 === referenceManifestSha256;
  if (!referenceReady) issues.push({ code: "BLOCKED_REFERENCE", path: "reference", message: "An authentic CP-F01 session for these exact UE5.9 reference bytes is mandatory" });
  if (manifest.schemaVersion !== "1.0.0" || manifest.targetVersion !== "5.9" || !["isolated", "future"].includes(manifest.stage) || manifest.provenance !== "measured" || !isText(manifest.preparedBy) || !isText(manifest.executedBy) || !isText(manifest.packageVersion)) issues.push({ code: "INVALID_CERTIFICATION_IDENTITY", path: "manifest", message: "Versioned, identified, measured data and an explicit stage are required" });
  if (!Array.isArray(manifest.assets) || manifest.assets.some((asset) => asset?.provenance !== "measured")) issues.push({ code: "SYNTHETIC_EVIDENCE", path: "assets", message: "Synthetic or unmeasured artifacts cannot authorize real certification" });
  const requirements = createCertificationRequirements(referenceManifest);
  const suiteSha256 = await hashCanonicalJson({ requirements, captureRuns: referenceManifest?.captureRuns ?? [], budgetPolicy });
  if (manifest.suiteSha256 !== suiteSha256) issues.push({ code: "SUITE_CHANGED", path: "suiteSha256", message: "Required scope, reference sequences and frozen budgets cannot be reduced or changed" });
  const artifacts = await verifyCertificationArtifacts(manifest.assets, options.readAsset, options.limits);
  const identity = await verifyCertificationPackage(manifest, sourceInventory, artifacts);
  const matrix = verifyCertificationMatrix(manifest, requirements, artifacts);
  const sequences = await verifyCertificationSequences(manifest, referenceManifest, artifacts, options.readReferenceAsset);
  const performance = verifyCertificationPerformance(manifest, referenceManifest, artifacts, budgetPolicy);
  const handover = await verifyCertificationHandover(manifest, artifacts, options.readPortedAsset);
  const manifestSha256 = await hashCanonicalJson(manifest);
  const bindings = { manifestSha256, packageSha256: identity.packageSha256, referenceManifestSha256, matrixSha256: await hashCanonicalJson(manifest.matrix ?? []), suiteSha256, budgetPolicySha256: await hashCanonicalJson(budgetPolicy), isolatedManifestSha256: manifest.isolatedManifestSha256 ?? null, isolatedAttestationSha256: manifest.isolatedAttestationSha256 ?? null };
  const now = options.now ?? Date.now();
  const approval = await verifyCertificationApproval(manifest, attestation, trustedReviewers, bindings, now);
  for (const component of [artifacts, identity, matrix, sequences, performance, handover, approval]) issues.push(...component.issues);
  if (manifest.stage === "future") {
    if (!priorReport?.promotionAllowed || priorReport.stage !== "isolated" || Date.parse(priorReport.approval.expiresAt) <= now || priorReport.manifestSha256 !== manifest.isolatedManifestSha256 || priorReport.approval.attestationSha256 !== manifest.isolatedAttestationSha256 || priorReport.packageSha256 !== identity.packageSha256 || priorReport.suiteSha256 !== suiteSha256 || priorReport.referenceManifestSha256 !== referenceManifestSha256) issues.push({ code: "MISSING_ISOLATED_PROMOTION", path: "isolatedSession", message: "Future needs a live isolated authorization for the same package, suite and reference; JSON flags are insufficient" });
  } else if (manifest.isolatedManifestSha256 != null || manifest.isolatedAttestationSha256 != null) issues.push({ code: "INVALID_PROMOTION_CHAIN", path: "isolatedManifestSha256", message: "The first isolated authorization cannot depend on a later certificate" });
  const runtimeScopes = createCertifiedRuntimeScopes(referenceManifest);
  if (!runtimeScopes.length) issues.push({ code: "MISSING_RUNTIME_SCOPE", path: "runtimeScopes", message: "No frozen display capture defines an enforceable runtime profile and representation" });
  const passed = issues.length === 0;
  const status = !referenceReady ? "BLOCKED_REFERENCE" : passed ? manifest.stage === "future" ? "CERTIFIED_REFERENCE" : "ISOLATED_PROMOTION_AUTHORIZED" : "BLOCKED_CERTIFICATION";
  return { schemaVersion: "1.0.0", phase: "CP-F36", stage: manifest.stage ?? "isolated", status, referenceReady, promotionAllowed: passed && manifest.stage === "isolated", exactClaimAllowed: passed && manifest.stage === "future", packageVersion: manifest.packageVersion ?? null, ...bindings, runtimeScopes, requiredRows: requirements.length, matrix: matrix.rows, comparisons: sequences.comparisons, performance: performance.measurements, handover, approval, artifacts: artifacts.verified, gates: { reference: referenceReady, integrity: artifacts.passed, package: identity.passed, matrix: matrix.passed, sequences: sequences.passed, performance: performance.passed, handover: handover.passed, review: approval.passed }, issues };
}

export async function verifyCertificationDossier(options = {}, priorReport = null) {
  try { return await verifyDossier(options, priorReport); }
  catch (error) { return { schemaVersion: "1.0.0", phase: "CP-F36", stage: "isolated", status: "BLOCKED_CERTIFICATION", referenceReady: false, promotionAllowed: false, exactClaimAllowed: false, runtimeScopes: [], matrix: [], comparisons: [], performance: [], artifacts: [], issues: [{ code: "INVALID_DOSSIER", path: "manifest", message: error.message }] }; }
}
