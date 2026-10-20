import { MGL_PASSES, MGL_TIER_DEFAULTS, tierDefaults } from "./mlPipelineContract.js";


export const MGL_TRACE_KIND = Object.freeze({
  none: "none",
  screenTrace: "screenTrace",
  virtualShadowMapTrace: "virtualShadowMapTrace",
  rayTrace: "rayTrace",
  policyFallback: "policyFallback",
});


export const TRACE_CASCADE_ORDER = Object.freeze([
  MGL_TRACE_KIND.screenTrace,
  MGL_TRACE_KIND.virtualShadowMapTrace,
  MGL_TRACE_KIND.rayTrace,
]);


export function tierNames() {
  return Object.keys(MGL_TIER_DEFAULTS);
}


export function isTracerKind(traceKind) {
  return TRACE_CASCADE_ORDER.indexOf(traceKind) !== -1;
}


export function resolveTraceCascade(tierName) {
  const tier = tierDefaults(tierName);
  const cascade = [MGL_TRACE_KIND.screenTrace];
  if (Number(tier.virtualShadowMapLightLimit) > 0) {
    cascade.push(MGL_TRACE_KIND.virtualShadowMapTrace);
  }
  if (tier.rayTraceEnabled === true) {
    cascade.push(MGL_TRACE_KIND.rayTrace);
  }
  return Object.freeze(cascade);
}


export function cascadeStepCount(tierName) {
  return resolveTraceCascade(tierName).length;
}

export function isTraceKindAllowedOnTier(traceKind, tierName) {
  return resolveTraceCascade(tierName).indexOf(traceKind) !== -1;
}


export function describeTraceCascadeByTier() {
  const cascadeByTier = {};
  tierNames().forEach((tierName) => {
    cascadeByTier[tierName] = resolveTraceCascade(tierName);
  });
  return Object.freeze(cascadeByTier);
}


export function cascadeFollowsContractPassOrder() {
  let previousPassIndex = -1;
  for (let stepIndex = 0; stepIndex !== TRACE_CASCADE_ORDER.length; stepIndex += 1) {
    const passIndex = MGL_PASSES.indexOf(TRACE_CASCADE_ORDER[stepIndex]);
    if (passIndex === -1) return false;
    if (passIndex <= previousPassIndex) return false;
    previousPassIndex = passIndex;
  }
  return true;
}
