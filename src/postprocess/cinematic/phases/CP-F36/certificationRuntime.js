import { readCertificationSession } from "./certificationSession.js";
import { readCertificationAuthorization } from "./certificationAuthorization.js";
import { CERTIFICATION_SESSION_SETTING, CERTIFICATION_CLAIM_SETTING, CERTIFICATION_BINDING_SETTING, CERTIFICATION_STATE_RESOURCE } from "./certificationContract.js";

export class CertificationBlockedError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "CertificationBlockedError";
    this.code = code;
  }
}

function matchesCertifiedScope(report, binding, frame, color, authorization) {
  if (!authorization.exactClaimAllowed || report.stage !== "future" || binding?.host !== "future-engine" || binding.packageSha256 !== report.packageSha256 || binding.referenceManifestSha256 !== report.referenceManifestSha256 || binding.suiteSha256 !== report.suiteSha256 || binding.engineAfterSha256 !== report.handover?.engineAfterSha256 || color.provenance !== "gpu") return false;
  return report.runtimeScopes.some((scope) => scope.profileId === binding.profileId && scope.qualityTier === frame.qualityTier && scope.renderWidth === frame.renderSize.width && scope.renderHeight === frame.renderSize.height && scope.width === color.width && scope.height === color.height && scope.encoding === color.encoding && scope.format === color.format && scope.width === frame.outputSize.width && scope.height === frame.outputSize.height);
}

export function installCertificationGate(services) {
  let disposed = false;
  let lastReport;
  let lastClaim;
  let lastReason;
  const unregister = services.graph.register({
    id: "CP-F36.certificationGate", owner: "CP-F36", stage: "debug", order: 3600,
    reads: ["$color"], writes: [CERTIFICATION_STATE_RESOURCE], transformsColor: false,
    execute(context) {
      const color = context.read("$color");
      if (!color?.texture) throw new CertificationBlockedError("MISSING_RENDERED_COLOR", "The gate requires a rendered texture");
      const report = readCertificationSession(context.settings?.get?.(CERTIFICATION_SESSION_SETTING));
      const claim = context.settings?.get?.(CERTIFICATION_CLAIM_SETTING) ?? "development";
      const binding = context.settings?.get?.(CERTIFICATION_BINDING_SETTING);
      const authorization = readCertificationAuthorization(report);
      const certified = matchesCertifiedScope(report, binding, context.frame, color, authorization);
      const reason = authorization.exactClaimAllowed && !certified ? "CERTIFICATE_SCOPE_MISMATCH" : authorization.status;
      if (report !== lastReport || claim !== lastClaim || reason !== lastReason) {
        services.report?.({ owner: "CP-F36", type: "certification-status", status: reason, requestedClaim: claim, exactClaimAllowed: certified, promotionAllowed: authorization.promotionAllowed });
        lastReport = report;
        lastClaim = claim;
        lastReason = reason;
      }
      if (!["development", "exact-ue59"].includes(claim)) throw new CertificationBlockedError("UNSUPPORTED_CERTIFICATION_CLAIM", String(claim));
      if (claim === "exact-ue59" && !certified) throw new CertificationBlockedError(reason, "No authentic final review covers this Future package, profile and output");
      context.publish(CERTIFICATION_STATE_RESOURCE, Object.freeze({
        value: Object.freeze({ status: reason, exactClaimAllowed: certified, promotionAllowed: authorization.promotionAllowed, manifestSha256: report?.manifestSha256 ?? null, observedOutput: Object.freeze({ width: color.width, height: color.height, format: color.format, encoding: color.encoding, provenance: color.provenance }) }),
        frameId: context.frame.frameId, viewId: context.frame.viewId, generation: context.frame.generation, provenance: color.provenance
      }));
    }
  });
  return () => {
    if (disposed) return;
    disposed = true;
    unregister();
    lastReport = null;
    lastClaim = null;
    lastReason = null;
  };
}
