export const LL_TIER = Object.freeze({
  WEAK: "fraco",
  MEDIUM: "medio",
  STRONG: "forte",
});

export const LL_TIER_IDS = Object.freeze([LL_TIER.WEAK, LL_TIER.MEDIUM, LL_TIER.STRONG]);


export const DEFAULT_LL_TIER = LL_TIER.WEAK;


const STRONG_ENGINE_TIERS = Object.freeze(["ultra", "high"]);


const MEDIUM_ENGINE_TIERS = Object.freeze(["medium", "low", "lite", "micro"]);

export function isLocalLightTier(value) {
  return LL_TIER_IDS.indexOf(value) !== -1;
}


export function describeLocalLightTier(telemetry) {
  const source = telemetry && typeof telemetry === "object" ? telemetry : {};
  const rawTier = typeof source.tier === "string" ? source.tier.toLowerCase() : "";


  if (isLocalLightTier(rawTier)) {
    return { tier: rawTier, reason: "local-light tier informed directly: " + rawTier };
  }

  if (source.weakGpu === true) {
    return { tier: LL_TIER.WEAK, reason: "gpuBudget.weak = true" };
  }

  if (source.weakGpu !== false) {
    return {
      tier: DEFAULT_LL_TIER,
      reason: "weakGpu is not an explicit boolean - incomplete telemetry, graded as " + DEFAULT_LL_TIER,
    };
  }

  if (STRONG_ENGINE_TIERS.indexOf(rawTier) !== -1) {
    return { tier: LL_TIER.STRONG, reason: "strong GPU on renderer tier " + rawTier };
  }

  if (MEDIUM_ENGINE_TIERS.indexOf(rawTier) !== -1) {
    return { tier: LL_TIER.MEDIUM, reason: "strong GPU on renderer tier " + rawTier + " - graded medium" };
  }


  return {
    tier: LL_TIER.MEDIUM,
    reason: rawTier
      ? "unknown renderer tier \"" + rawTier + "\" on a non-weak GPU - graded medium"
      : "renderer tier absent on a non-weak GPU - graded medium",
  };
}


export function resolveLocalLightTier(telemetry) {
  const source = telemetry && typeof telemetry === "object" ? telemetry : {};
  const rawTier = typeof source.tier === "string" ? source.tier.toLowerCase() : "";

  if (isLocalLightTier(rawTier)) return rawTier;
  if (source.weakGpu === true) return LL_TIER.WEAK;
  if (source.weakGpu !== false) return DEFAULT_LL_TIER;
  if (STRONG_ENGINE_TIERS.indexOf(rawTier) !== -1) return LL_TIER.STRONG;
  if (MEDIUM_ENGINE_TIERS.indexOf(rawTier) !== -1) return LL_TIER.MEDIUM;
  return LL_TIER.MEDIUM;
}
