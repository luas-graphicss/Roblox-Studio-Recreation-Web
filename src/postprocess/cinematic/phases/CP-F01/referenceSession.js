import { canonicalJson, hashCanonicalJson } from "./referenceHash.js";
import { validateReferenceManifest } from "./referenceValidator.js";
import { verifyAssetIntegrity } from "./referenceIntegrity.js";
import { verifyReferenceAttestation } from "./referenceAttestation.js";

const issuedSessions = new WeakMap();

function freezeTree(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) freezeTree(child); Object.freeze(value); }
  return value;
}

export function readReferenceSession(session) {
  return session && typeof session === "object" ? issuedSessions.get(session) ?? null : null;
}

export async function verifyReferenceBundle({ manifest, attestation, trustedReviewers = [], readAsset, limits } = {}) {
  let snapshot;
  const issues = [];
  try { snapshot = JSON.parse(canonicalJson(manifest)); }
  catch (error) { issues.push({ code: "INVALID_REFERENCE_JSON", path: "manifest", message: error.message }); }
  let validation = { valid: false, issues: [], counts: {} };
  let integrity = { passed: false, checkedAssets: 0, checkedBytes: 0, issues: [] };
  let approval = { passed: false, referenceAuthority: false, issues: [] };
  if (snapshot) {
    try { validation = validateReferenceManifest(snapshot); }
    catch (error) { validation = { valid: false, issues: [{ code: "MALFORMED_MANIFEST", path: "manifest", message: error.message }], counts: {} }; }
    issues.push(...validation.issues);
    if (validation.valid) {
      integrity = await verifyAssetIntegrity(snapshot, readAsset, limits);
      issues.push(...integrity.issues);
      approval = await verifyReferenceAttestation(snapshot, attestation, trustedReviewers);
      issues.push(...approval.issues);
    }
  }
  const genuineProvenance = snapshot?.provenance === "reference" && Array.isArray(snapshot.assets) && Array.isArray(snapshot.sources) && snapshot.assets.every((asset) => asset.provenance === "reference") && snapshot.sources.every((source) => source.provenance === "reference");
  if (!genuineProvenance) issues.push({ code: "NON_REFERENCE_PROVENANCE", path: "provenance", message: "Synthetic, diagnostic and unmeasured data cannot certify a UE reference" });
  if (!approval.referenceAuthority) issues.push({ code: "MISSING_REFERENCE_AUTHORITY", path: "trust", message: "A synthetic key, self-checksum or self-declared reviewed flag is not a reference authority" });
  const referenceReady = validation.valid && integrity.passed && approval.passed && approval.referenceAuthority && genuineProvenance;
  const report = freezeTree({ schemaVersion: "1.0.0", phase: "CP-F01", status: referenceReady ? "REFERENCE_READY_FOR_COMPARISON" : "BLOCKED_REFERENCE", referenceReady, exactClaimAllowed: false, implementation: "reference-validation-and-runtime-gate", manifestSha256: snapshot ? await hashCanonicalJson(snapshot) : null, validationPassed: validation.valid, integrityPassed: integrity.passed, approvalPassed: approval.passed, counts: validation.counts, checkedAssets: integrity.checkedAssets, checkedBytes: integrity.checkedBytes, checkedFacts: integrity.checkedFacts ?? 0, issues, certificationOwner: "CP-F36" });
  const session = Object.freeze({ phase: "CP-F01", schemaVersion: "1.0.0" });
  issuedSessions.set(session, report);
  return Object.freeze({ session, report });
}
