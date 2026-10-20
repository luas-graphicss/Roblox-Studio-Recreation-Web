export const TRACE_POLICY_REFUSALS = Object.freeze([
  Object.freeze({
    code: "tracePolicy.noUnknownLeavingTheCascade",
    refuses: "letting a sample leave the cascade still marked unknown",
    because:
      "the shading pass would read whatever was in the sampleVisibility texel - last frame, or nothing - and the artifact appears exactly where information is missing. A defined, labelled fallback is the only honest exit.",
  }),
  Object.freeze({
    code: "tracePolicy.noSilentFallback",
    refuses: "writing the fallback without the policyFallback kind and a named reason",
    because:
      "ML-F18 and ML-F22 lower their confidence precisely on the samples nobody resolved. An unlabelled fallback is indistinguishable from a real visible answer, which is how a light leak becomes permanent.",
  }),
  Object.freeze({
    code: "tracePolicy.noRetracingResolvedSamples",
    refuses: "handing an already resolved sample to the next tracer",
    because:
      "compaction between steps IS the cheapness of the cascade. Re-tracing resolved samples makes every sample pay the most expensive tracer of the frame, and the escalation becomes pure loss.",
  }),
  Object.freeze({
    code: "tracePolicy.noRayTraceOnTheWeakTier",
    refuses: "escalating to the BVH on the weak tier",
    because:
      "mlPassRefusals already states rayTrace.noWeakTier: BVH traversal in the fragment shader resets a weak driver. The weak tier stops after the screen trace and falls back, on purpose.",
  }),
  Object.freeze({
    code: "tracePolicy.noBudgetProportionalToLightCount",
    refuses: "sizing the ray budget from the number of lights",
    because:
      "the promise of MegaLights is a cost that follows the sample budget. A ray budget that grows with the lights is the lite version wearing the name.",
  }),
]);

export function tracePolicyRefusalCodes() {
  return TRACE_POLICY_REFUSALS.map((refusal) => refusal.code);
}

export function tracePolicyRefusal(refusalCode) {
  return TRACE_POLICY_REFUSALS.find((refusal) => refusal.code === refusalCode) || null;
}
