const sessions = new WeakMap();

function freezeReport(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeReport(child);
    Object.freeze(value);
  }
  return value;
}

export function readCertificationSession(session) {
  return session && typeof session === "object" ? sessions.get(session) ?? null : null;
}

export async function createCertificationSession(options = {}) {
  const { verifyCertificationDossier } = await import("./verifyCertificationDossier.js");
  const priorReport = readCertificationSession(options?.isolatedSession);
  const report = freezeReport(await verifyCertificationDossier(options, priorReport));
  const session = Object.freeze({ phase: "CP-F36", schemaVersion: "1.0.0" });
  sessions.set(session, report);
  return Object.freeze({ session, report });
}
