import { canonicalJson, hexBytes, hashCanonicalJson } from "../CP-F01/referenceHash.js";
import { isText } from "./certificationData.js";

export async function verifyCertificationApproval(manifest, attestation, trustedReviewers, bindings, now = Date.now()) {
  try {
    if (!attestation || !Array.isArray(trustedReviewers)) throw new Error("An independent signature and out-of-band trust list are required");
    const { signatureHex, ...statement } = attestation;
    const matches = trustedReviewers.filter((key) => key.keyId === statement.keyId);
    if (matches.length !== 1) throw new Error("No unique externally trusted reviewer key");
    const key = matches[0];
    const identities = [manifest.preparedBy, manifest.executedBy].filter(isText).map((value) => value.trim().toLowerCase());
    if (key.purpose !== "certification" || key.revoked === true || key.reviewerId !== statement.reviewerId || !isText(key.reviewerId) || identities.includes(key.reviewerId.trim().toLowerCase())) throw new Error("Author, operator, synthetic and untrusted keys cannot approve certification");
    const reviewedAt = Date.parse(statement.reviewedAt);
    const expiresAt = Date.parse(statement.expiresAt);
    if (![now, reviewedAt, expiresAt].every(Number.isFinite) || reviewedAt > now || expiresAt <= now || reviewedAt >= expiresAt) throw new Error("Expired, future-dated or missing approval validity window");
    const decision = manifest.stage === "future" ? "certify-future" : "authorize-isolated-promotion";
    if (statement.schemaVersion !== "1.0.0" || statement.targetVersion !== "5.9" || statement.phase !== "CP-F36" || statement.stage !== manifest.stage || statement.decision !== decision || statement.noMandatoryResiduals !== true || statement.entireMatrixReviewed !== true) throw new Error("Incomplete or wrong-stage approval statement");
    for (const [field, expected] of Object.entries(bindings)) if (statement[field] !== expected) throw new Error(`Approval does not bind ${field}`);
    if (!/^[a-f0-9]{64}$/.test(key.publicKeyHex ?? "") || !/^[a-f0-9]{128}$/.test(signatureHex ?? "")) throw new Error("Invalid Ed25519 key or signature encoding");
    const publicKey = await globalThis.crypto.subtle.importKey("raw", hexBytes(key.publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    if (!await globalThis.crypto.subtle.verify({ name: "Ed25519" }, publicKey, hexBytes(signatureHex), new TextEncoder().encode(canonicalJson(statement)))) throw new Error("Signature verification failed");
    return { passed: true, reviewerId: key.reviewerId, reviewedAt: statement.reviewedAt, expiresAt: statement.expiresAt, attestationSha256: await hashCanonicalJson(attestation), issues: [] };
  } catch (error) { return { passed: false, reviewerId: null, expiresAt: null, attestationSha256: null, issues: [{ code: "INDEPENDENT_REVIEW_BLOCKED", path: "attestation", message: error.message }] }; }
}
