export const CINEMATIC_PACKAGE_REVISION = "CP-F34-api1";
export const CINEMATIC_ENGINE_AUDIT_DIGEST = "bde449764ae37c4b58fb29eda619e70e345ac2e376ddfecd57004e30288b54f8";

export const CINEMATIC_PROMOTION_RECORD = Object.freeze({
  id: "aurora-engine-cinematic-preliminary-2026-09-15",
  packageRevision: CINEMATIC_PACKAGE_REVISION,
  engineAuditDigest: CINEMATIC_ENGINE_AUDIT_DIGEST,
  authority: "integrator",
  certification: "development",
  approvals: Object.freeze({
    "CP-F31": "passed",
    "CP-F32": "passed",
    "CP-F33": "passed",
    "CP-F35": "passed",
    "CP-F36": "authorized-preliminary",
  }),
  defaultEnabled: true,
  defaults: Object.freeze({}),
});

export function verifyCinematicPromotion(record) {
  if (!record || typeof record !== "object") return false;
  return record.id === CINEMATIC_PROMOTION_RECORD.id
    && record.packageRevision === CINEMATIC_PACKAGE_REVISION
    && record.engineAuditDigest === CINEMATIC_ENGINE_AUDIT_DIGEST
    && record.approvals?.["CP-F36"] === "authorized-preliminary";
}
