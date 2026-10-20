import { REFERENCE_SESSION_SETTING, REFERENCE_CLAIM_SETTING, REFERENCE_STATE_RESOURCE } from "./referenceConstants.js";
import { readReferenceSession } from "./referenceSession.js";

const missingReference = Object.freeze({ status: "BLOCKED_REFERENCE", referenceReady: false, exactClaimAllowed: false, manifestSha256: null, issues: Object.freeze([{ code: "MISSING_VERIFIED_SESSION", message: "No in-memory reference session issued by byte and independent-signature verification is installed" }]) });

export class ReferenceBlockedError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = "ReferenceBlockedError"; this.code = code; }
}

export function installReferenceGate(services) {
  let lastState;
  let lastClaim;
  let disposed = false;
  const unregister = services.graph.register({
    id: "CP-F01.referenceGate",
    owner: "CP-F01",
    stage: "prepare",
    order: -1000,
    reads: [],
    writes: [REFERENCE_STATE_RESOURCE],
    transformsColor: false,
    execute(context) {
      const state = readReferenceSession(context.settings?.get?.(REFERENCE_SESSION_SETTING)) ?? missingReference;
      const claim = context.settings?.get?.(REFERENCE_CLAIM_SETTING) ?? "development";
      if (state !== lastState || claim !== lastClaim) {
        services.report?.({ owner: "CP-F01", type: "reference-status", status: state.status, referenceReady: state.referenceReady, exactClaimAllowed: false, requestedClaim: claim, issueCodes: [...new Set(state.issues.map((issue) => issue.code))] });
        lastState = state;
        lastClaim = claim;
      }
      if (claim === "exact-ue59") throw new ReferenceBlockedError(state.referenceReady ? "UNCERTIFIED_SYSTEM" : "BLOCKED_REFERENCE", "CP-F01 never grants the CP-F36 whole-system exactness certificate");
      if (!["development", "reference-comparison"].includes(claim)) throw new ReferenceBlockedError("UNSUPPORTED_REFERENCE_CLAIM", String(claim));
      if ((context.frame.referenceMode === true || claim === "reference-comparison") && !state.referenceReady) throw new ReferenceBlockedError("BLOCKED_REFERENCE", "A verified UE5.9 reference bundle is required before reference-mode capture");
      context.publish(REFERENCE_STATE_RESOURCE, Object.freeze({ value: state, frameId: context.frame.frameId, viewId: context.frame.viewId, generation: context.frame.generation, provenance: state.referenceReady ? "reference" : "synthetic" }));
    }
  });
  return () => { if (disposed) return; disposed = true; unregister(); lastState = undefined; lastClaim = undefined; };
}
