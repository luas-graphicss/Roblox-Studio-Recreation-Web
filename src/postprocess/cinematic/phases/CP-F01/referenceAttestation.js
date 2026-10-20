import { canonicalJson, hexBytes, hashCanonicalJson } from "./referenceHash.js";
import { isRecord, isText, isSha256 } from "./referenceValidation.js";

export async function verifyReferenceAttestation(manifest, attestation, trustedReviewers = []) {
  try {
    if (!isRecord(attestation) || !Array.isArray(trustedReviewers)) throw new Error("Independent signed attestation and an out-of-band trust list are required");
    const { signatureHex, ...statement } = attestation;
    const keys = trustedReviewers.filter((entry) => entry.keyId === statement.keyId);
    if (keys.length !== 1) throw new Error("No unique trusted reviewer key; manifest-provided keys are never trusted");
    const key = keys[0];
    if (!isText(key.reviewerId) || statement.reviewerId !== key.reviewerId || statement.reviewerId === manifest.preparedBy || statement.reviewerId === manifest.capturedBy) throw new Error("An independent, identified reviewer is required");
    if (!["reference", "synthetic"].includes(key.purpose)) throw new Error("Reviewer key purpose is missing");
    if (statement.schemaVersion !== "1.0.0" || statement.targetVersion !== "5.9" || statement.decision !== "approved-for-reference-comparison" || statement.rightsConfirmed !== true || statement.inventoryComplete !== true || !Number.isFinite(Date.parse(statement.reviewedAt))) throw new Error("Incomplete reference approval statement");
    const manifestSha256 = await hashCanonicalJson(manifest);
    if (!isSha256(statement.manifestSha256) || statement.manifestSha256 !== manifestSha256) throw new Error("Approval does not cover these manifest bytes");
    const buildAsset = manifest.assets.find((asset) => asset.id === manifest.build.identityAssetId);
    if (statement.buildIdentitySha256 !== buildAsset?.sha256) throw new Error("Approval does not bind the build identity artifact");
    if (!/^[a-f0-9]{64}$/.test(key.publicKeyHex) || !/^[a-f0-9]{128}$/.test(signatureHex)) throw new Error("Invalid Ed25519 key or signature encoding");
    const publicKey = await globalThis.crypto.subtle.importKey("raw", hexBytes(key.publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    const signatureValid = await globalThis.crypto.subtle.verify({ name: "Ed25519" }, publicKey, hexBytes(signatureHex), new TextEncoder().encode(canonicalJson(statement)));
    if (!signatureValid) throw new Error("Independent reviewer signature verification failed");
    return { passed: true, referenceAuthority: key.purpose === "reference", reviewerId: key.reviewerId, manifestSha256, issues: [] };
  } catch (error) {
    return { passed: false, referenceAuthority: false, issues: [{ code: "UNVERIFIED_ATTESTATION", path: "attestation", message: error.message }] };
  }
}
