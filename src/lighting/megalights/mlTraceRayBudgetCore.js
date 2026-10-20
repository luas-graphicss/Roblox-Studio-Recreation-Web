import { tierDefaults } from "./mlPipelineContract.js";
import { TRACE_CASCADE_ORDER, cascadeStepCount } from "./mlTraceCascadeCore.js";


export const TRACE_RAY_BUDGET_UNIFORM = "uMglTraceRayBudget";

export const TRACE_RAY_BUDGET_LIMITS = Object.freeze({


  raysPerTraceAttempt: 1,
  minimumRaysPerSample: 1,
  maximumRaysPerSample: TRACE_CASCADE_ORDER.length,
});


export function raysPerSampleEntitlement(tierName) {
  const declaredRays = Math.floor(Number(tierDefaults(tierName).raysPerPixel));
  if (!Number.isFinite(declaredRays)) return TRACE_RAY_BUDGET_LIMITS.minimumRaysPerSample;
  return Math.max(TRACE_RAY_BUDGET_LIMITS.minimumRaysPerSample, declaredRays);
}


export function raysToCompleteOneSample(tierName) {
  return raysPerSampleEntitlement(tierName) * cascadeStepCount(tierName);
}

export function normalizeSampleCount(rawSampleCount) {
  const sampleCount = Math.floor(Number(rawSampleCount));
  if (!Number.isFinite(sampleCount)) return 0;
  return Math.max(0, sampleCount);
}


export function frameRayBudget(request) {
  const input = request || {};
  return (
    raysPerSampleEntitlement(input.tierName) *
    cascadeStepCount(input.tierName) *
    normalizeSampleCount(input.sampleCount)
  );
}






export function createTraceRayBudget(request) {
  const input = request || {};
  const overrideRays = Math.floor(Number(input.rayBudgetOverride));
  const totalRays =
    Number.isFinite(overrideRays) && overrideRays >= 0 ? overrideRays : frameRayBudget(input);

  let spentRays = 0;
  let refusedRays = 0;
  let refusalCount = 0;

  function remainingRays() {
    return totalRays - spentRays;
  }

  return Object.freeze({
    totalRays: () => totalRays,
    remainingRays,
    spentRays: () => spentRays,
    refusedRays: () => refusedRays,
    refusalCount: () => refusalCount,


    trySpendRays(rayCount) {
      const requestedRays = Math.floor(Number(rayCount));
      if (!Number.isFinite(requestedRays) || requestedRays <= 0) {
        refusalCount += 1;
        return false;
      }
      if (requestedRays > remainingRays()) {
        refusedRays += requestedRays;
        refusalCount += 1;
        return false;
      }
      spentRays += requestedRays;
      return true;
    },

    describe() {
      return Object.freeze({
        uniform: TRACE_RAY_BUDGET_UNIFORM,
        totalRays,
        spentRays,
        remainingRays: remainingRays(),
        refusedRays,
        refusalCount,
      });
    },
  });
}
