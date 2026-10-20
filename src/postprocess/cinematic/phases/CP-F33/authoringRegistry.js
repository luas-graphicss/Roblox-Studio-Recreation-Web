const sessions = new WeakMap();
export function registerAuthoringSession(session, internals) { sessions.set(session, internals); }
export function requireAuthoringSession(session) {
  if (!sessions.has(session)) throw new TypeError("CP-F33 requires a validated authoring session");
  return session;
}
export function authoringSessionInternals(session) { requireAuthoringSession(session); return sessions.get(session); }
