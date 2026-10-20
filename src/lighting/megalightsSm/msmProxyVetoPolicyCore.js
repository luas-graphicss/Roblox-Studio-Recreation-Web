import { MSM_ACTIVE_TIERS } from "./msmTierPolicy.js";

export const MSM_PROXY_VETO_OWNER = "MSM-F19";


export const MSM_PROXY_FIRST_TIER = "low";

export const MSM_PROXY_VETO_REASON = Object.freeze({
  NONE: "none",
  UNKNOWN_TIER: "unknown-tier",
  TIER_TOO_WEAK: "tier-too-weak",
  SOLD_BY_THE_LADDER: "sold-by-the-ladder",
  DISABLED_BY_FLAG: "disabled-by-flag",
});


export const MSM_PROXY_LADDER_RUNG_REQUEST = Object.freeze({
  id: "proxy-occlusion-off",
  label: "proxy occlusion OFF",
  requestedBy: "MSM-F19",
  ownerPhase: "MSM-F31",
  suggestedPosition: 6,
  soldFlagName: "isSoldByTheLadder",
  note: "section 6.3 has 7 rungs and none of them sells the proxy; without this rung the acceptance of F19 has no buyer",
});


export function msmProxyAllowedTiers() {
  const anchorIndex = MSM_ACTIVE_TIERS.indexOf(MSM_PROXY_FIRST_TIER);
  if (anchorIndex > -1) return MSM_ACTIVE_TIERS.slice(anchorIndex);
  throw new Error(
    `msmProxyVetoPolicyCore: tier ${MSM_PROXY_FIRST_TIER} left MSM_ACTIVE_TIERS, the reviewer has to repoint the phase`,
  );
}

function readTierText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function buildDecision(runsProxyOcclusion, vetoReason) {
  return { runsProxyOcclusion, vetoReason };
}








export function decideMsmProxyOcclusion(request) {
  const tier = readTierText(request ? request.tier : undefined);
  const allowedTiers = msmProxyAllowedTiers();

  if (MSM_ACTIVE_TIERS.indexOf(tier) === -1) {
    return buildDecision(false, MSM_PROXY_VETO_REASON.UNKNOWN_TIER);
  }
  if (allowedTiers.indexOf(tier) === -1) {
    return buildDecision(false, MSM_PROXY_VETO_REASON.TIER_TOO_WEAK);
  }
  if (request && request.isEnabledByFlag === false) {
    return buildDecision(false, MSM_PROXY_VETO_REASON.DISABLED_BY_FLAG);
  }
  if (request && request.isSoldByTheLadder === true) {
    return buildDecision(false, MSM_PROXY_VETO_REASON.SOLD_BY_THE_LADDER);
  }
  return buildDecision(true, MSM_PROXY_VETO_REASON.NONE);
}
