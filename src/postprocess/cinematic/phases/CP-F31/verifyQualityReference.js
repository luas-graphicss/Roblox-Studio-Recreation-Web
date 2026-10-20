import { assertSynchronous } from "./qualityContract.js";

export function verifyQualityReference({ plan, frame, verifier }) {
  if (!frame.referenceMode) return Object.freeze({ status: "BLOCKED_REFERENCE", approved: false });
  if (typeof verifier !== "function" || plan.pipelineRevision === "unversioned")
    throw new Error("CP-F31 BLOCKED_REFERENCE: exact-ue59 requires an external profile-specific verifier and pipeline revision");
  const result = assertSynchronous(verifier(Object.freeze({ mode: "exact-ue59", engineVersion: "5.9",
    profileId: plan.profileId, configurationKey: plan.configurationKey, pipelineRevision: plan.pipelineRevision,
    outputSize: plan.outputSize, renderSize: plan.renderSize })), "reference verifier");
  if (result?.status !== "verified" || result?.reviewed !== true || result?.engineVersion !== "5.9" ||
    result?.mode !== "exact-ue59" || result?.profileId !== plan.profileId || result?.configurationKey !== plan.configurationKey ||
    result?.pipelineRevision !== plan.pipelineRevision || typeof result?.reviewer !== "string" || !result.reviewer.trim() ||
    !/^[a-f0-9]{64}$/i.test(result?.artifactSha256 ?? ""))
    throw new Error("CP-F31 BLOCKED_REFERENCE: missing or mismatched exact profile authorization");
  return Object.freeze({ status: "externally-authorized-profile", approved: true,
    reviewer: result.reviewer, artifactSha256: result.artifactSha256,
    scope: "Quality gate only; every installed phase and final integration must still pass their own reference gates" });
}
