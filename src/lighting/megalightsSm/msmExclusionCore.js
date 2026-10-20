export const MSM_EXCLUSIVE_COMPETITOR = "MegaLights-lite";


export const MSM_EXCLUSION_SIGNAL_NAME = "megaLightsWanted";

function readCompetitorSignal(signals) {
  if (!signals || typeof signals !== "object") return null;
  return typeof signals.megaLightsWanted === "boolean" ? signals.megaLightsWanted : null;
}


export function describeMsmExclusion(signals) {
  const competitorAwake = readCompetitorSignal(signals);

  if (competitorAwake === null) {
    return {
      allowed: false,
      competitor: MSM_EXCLUSIVE_COMPETITOR,
      competitorAwake: null,
      reason:
        MSM_EXCLUSION_SIGNAL_NAME +
        " is not an explicit boolean - rule 5 needs proof that " +
        MSM_EXCLUSIVE_COMPETITOR +
        " is off, so the MSM sleeps",
    };
  }

  if (competitorAwake) {
    return {
      allowed: false,
      competitor: MSM_EXCLUSIVE_COMPETITOR,
      competitorAwake: true,
      reason:
        MSM_EXCLUSIVE_COMPETITOR +
        " is awake in this frame (mlWanted = true) - only one stochastic light system per frame",
    };
  }

  return {
    allowed: true,
    competitor: MSM_EXCLUSIVE_COMPETITOR,
    competitorAwake: false,
    reason:
      MSM_EXCLUSIVE_COMPETITOR +
      " is off in this frame (mlWanted = false) - the MSM may own the local lights",
  };
}


export function isMsmAllowedByExclusion(signals) {
  return readCompetitorSignal(signals) === false;
}
