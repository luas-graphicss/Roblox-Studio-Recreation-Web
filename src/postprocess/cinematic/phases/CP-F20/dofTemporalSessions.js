import { DOF_TEMPORAL_OWNER, DOF_GUIDE_ENCODING, DOF_HISTORY_ENCODING, DOF_REJECTION_ENCODING } from "./dofTemporalContract.js";
import { resolveDofHistoryPolicy } from "./dofHistoryPolicy.js";

export function createDofTemporalSessions(services) {
  const active = new Set();
  const latestScopes = new Map();
  const effectNames = ["guide", "color", "statistics"];
  let disposed = false;
  function acquire(context, settings, capture, inputs) {
    if (disposed) throw new Error("CP-F20 temporal sessions are disposed");
    const frame = context.frame;
    const temporal = context.read("CP-F07.temporalFrame").value;
    if (temporal?.apiVersion !== "1.0.0" || typeof temporal.histories?.acquire !== "function") throw new Error("CP-F20 requires the real CP-F07 temporal-frame API 1.0.0");
    const scope = temporal.histories;
    if (scope.frameId !== frame.frameId || scope.viewId !== frame.viewId || scope.generation !== frame.generation) throw new Error("CP-F20 received a stale history scope");
    const key = "CP-F20.checkpoint";
    const previous = services.history.read(DOF_TEMPORAL_OWNER, key, frame);
    const policy = resolveDofHistoryPolicy(previous, frame, settings, capture, scope.resetReasons);
    const effectIds = effectNames.map((name) => `${DOF_TEMPORAL_OWNER}.${name}`);
    const leases = {};
    const encodings = [DOF_GUIDE_ENCODING, DOF_HISTORY_ENCODING, DOF_REJECTION_ENCODING];
    try {
      effectNames.forEach((name, index) => {
        leases[name] = scope.acquire(effectIds[index], { ...frame.renderSize, format: "rgba16f", encoding: encodings[index], exposureMode: "invariant", filter: "nearest" });
      });
    } catch (error) {
      for (const id of effectIds) scope.releaseEffect(id);
      throw error;
    }
    latestScopes.set(frame.viewId, { scope, effectIds });
    const session = { frame, settings, capture, inputs, scope, key, previous, policy, leases, effectIds, closed: false };
    active.add(session);
    return session;
  }
  function finish(session) { session.closed = true; active.delete(session); }
  function abort(session) {
    if (session.closed) return;
    for (const lease of Object.values(session.leases)) { try { lease.abort(); } catch {} }
    for (const id of session.effectIds) { try { session.scope.releaseEffect(id); } catch {} }
    finish(session);
  }
  return Object.freeze({
    acquire, finish, abort,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const session of [...active]) abort(session);
      for (const { scope, effectIds } of latestScopes.values()) for (const id of effectIds) { try { scope.releaseEffect(id); } catch {} }
      latestScopes.clear();
      services.history.clearOwner(DOF_TEMPORAL_OWNER);
    }
  });
}
