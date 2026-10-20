export function readCertificationAuthorization(report, now = Date.now()) {
  const blocked = (status) => ({ status, promotionAllowed: false, exactClaimAllowed: false });
  if (!report) return blocked("BLOCKED_REFERENCE");
  const isolated = report.stage === "isolated" && report.promotionAllowed === true && report.exactClaimAllowed === false;
  const future = report.stage === "future" && report.exactClaimAllowed === true && report.promotionAllowed === false;
  if (!isolated && !future) return blocked(report.status ?? "BLOCKED_CERTIFICATION");
  const reviewedAt = Date.parse(report.approval?.reviewedAt);
  const expiresAt = Date.parse(report.approval?.expiresAt);
  if (report.approval?.passed !== true || ![now, reviewedAt, expiresAt].every(Number.isFinite) || reviewedAt >= expiresAt) return blocked("INVALID_CERTIFICATE_VALIDITY");
  if (now < reviewedAt) return blocked("CERTIFICATE_NOT_YET_VALID");
  if (now >= expiresAt) return blocked("CERTIFICATE_EXPIRED");
  return { status: isolated ? "ISOLATED_PROMOTION_AUTHORIZED" : "CERTIFIED_REFERENCE", promotionAllowed: isolated, exactClaimAllowed: future };
}
