import { requireSettingsObject, requireSynchronous } from "./adapterValidation.js";

const requiredApprovals = Object.freeze(["CP-F31", "CP-F32", "CP-F33", "CP-F35"]);
const blocked = (reason) => Object.freeze({ active: false, reason });

export function resolveAdapterRoute(configuration, hostState, verifyPromotion) {
  if (!hostState || typeof hostState !== "object") return blocked("host-not-bound");
  if (configuration.safeMode || hostState.safeMode !== false) return blocked("safe-mode");
  if (hostState.technology !== "Future") return blocked("legacy-technology");
  if (configuration.enabled === false) return blocked("feature-disabled");
  if (hostState.deviceReady !== true) return blocked("device-unavailable");
  if (hostState.capabilities?.webgl2 !== true || hostState.capabilities?.floatColorBuffer !== true) return blocked("unsupported-hdr-backend");
  if (configuration.environment === "isolated") {
    return configuration.enabled === true
      ? Object.freeze({ active: true, reason: "isolated-opt-in", defaults: Object.freeze({}), approvalId: null })
      : blocked("isolated-opt-in-required");
  }
  const record = hostState.promotion;
  if (!record || record.packageRevision !== configuration.packageRevision) return blocked("package-not-approved");
  if (!/^[a-f0-9]{64}$/.test(record.engineAuditDigest ?? "")) return blocked("engine-audit-missing");
  if (record.engineAuditDigest !== hostState.engineAuditDigest) return blocked("engine-audit-stale");
  if (requiredApprovals.some((phase) => record.approvals?.[phase] !== "passed")) return blocked("completion-dependencies-blocked");
  if (record.approvals?.["CP-F36"] !== "authorized-preliminary") return blocked("promotion-not-authorized");
  if (typeof record.id !== "string" || !record.id || typeof verifyPromotion !== "function") return blocked("promotion-verifier-missing");
  if (requireSynchronous(verifyPromotion(record), "Promotion verification") !== true) return blocked("promotion-verification-failed");
  if (configuration.enabled === null && record.defaultEnabled !== true) return blocked("approved-default-disabled");
  const approvedDefaults = requireSettingsObject(record.defaults);
  return Object.freeze({ active: true, reason: "approved-future-base", defaults: approvedDefaults, approvalId: record.id });
}

export function assertOwnershipAcknowledgement(requested, acknowledged) {
  if (!acknowledged || Object.keys(requested).some((role) => acknowledged[role] !== requested[role])) {
    throw new Error("Host did not acknowledge exclusive processing ownership");
  }
}
