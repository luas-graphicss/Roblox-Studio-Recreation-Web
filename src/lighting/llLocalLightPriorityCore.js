import { RECENCY_HALF_LIFE_PLANS, rankByShadowPriority, recencyWeight } from "./llShadowPriorityCore.js";
import { fadedIntensity } from "./llLightFadeCore.js";

export const LOCAL_LIGHT_PRIORITY_SOURCE = "LL-F12";
export const LOCAL_LIGHT_PRIORITY_HALF_LIFE_PLANS = RECENCY_HALF_LIFE_PLANS;

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}


export function rankLocalLights(input) {
  const request = asObject(input);
  const candidates = Array.isArray(request.candidates) ? request.candidates : [];
  const planIndex = Math.max(Math.floor(finiteOr(request.planIndex, 0)), 0);
  const halfLifePlans = Math.max(finiteOr(request.halfLifePlans, LOCAL_LIGHT_PRIORITY_HALF_LIFE_PLANS), 1);
  const entries = candidates.map((rawCandidate, order) => {
    const candidate = asObject(rawCandidate);
    const key = String(candidate.key === undefined ? order : candidate.key);
    return {
      key,
      coverage: candidate.coverage,
      intensity: fadedIntensity(candidate.intensity, candidate.fadeFactor === undefined ? 1 : candidate.fadeFactor),
      recency: recencyWeight({
        planIndex,
        lastVisiblePlanIndex: finiteOr(candidate.lastVisiblePlanIndex, planIndex),
        halfLifePlans,
      }),
    };
  });
  return rankByShadowPriority(entries);
}


export function priorityByKeyOf(ranked) {
  const priorityByKey = new Map();
  (Array.isArray(ranked) ? ranked : []).forEach((item) => {
    priorityByKey.set(String(asObject(item).key), Number(asObject(item).priority) || 0);
  });
  return priorityByKey;
}
