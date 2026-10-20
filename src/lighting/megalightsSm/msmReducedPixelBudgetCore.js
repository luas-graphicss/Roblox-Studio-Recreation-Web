import {
  MSM_NEW_VRAM_CEILING_BYTES,
  MSM_RESOLUTION_DIVISORS,
  resolveBufferPlan,
} from "./msmPipelineContract.js";
import { describeMsmTierPolicy } from "./msmTierPolicy.js";


export const MSM_DIVISOR_LADDER = Object.freeze(
  MSM_RESOLUTION_DIVISORS.slice().sort((left, right) => left - right),
);

function readViewportSide(value) {
  const parsed = Math.floor(Number(value));
  return parsed >= 1 ? parsed : 0;
}

function readRequestedDivisor(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function planFitsCeiling(plan) {
  return plan.withinVramCeiling && plan.maxReducedPixelCount >= plan.resolution.pixelCount;
}

function describePlanCost(plan) {
  return (
    plan.resolution.width +
    "x" +
    plan.resolution.height +
    " = " +
    plan.resolution.pixelCount +
    " reduced pixels (" +
    plan.newVramBytes +
    " B of the " +
    plan.ceilingBytes +
    " B ceiling)"
  );
}

function refusedBudget(fullWidth, fullHeight, requestedDivisor, reason) {
  return Object.freeze({
    fullWidth,
    fullHeight,
    requestedDivisor,
    divisor: 0,
    divisorEscalated: false,
    fits: false,
    reducedWidth: 0,
    reducedHeight: 0,
    reducedPixelCount: 0,
    maxReducedPixelCount: 0,
    newVramBytes: 0,
    ceilingBytes: MSM_NEW_VRAM_CEILING_BYTES,
    coverageCycleFrames: 0,
    reason,
  });
}

function budgetFromPlan(requestedDivisor, plan, fits, reason) {
  return Object.freeze({
    fullWidth: plan.resolution.fullWidth,
    fullHeight: plan.resolution.fullHeight,
    requestedDivisor,
    divisor: plan.resolution.divisor,
    divisorEscalated: plan.resolution.divisor > requestedDivisor,
    fits,
    reducedWidth: plan.resolution.width,
    reducedHeight: plan.resolution.height,
    reducedPixelCount: plan.resolution.pixelCount,
    maxReducedPixelCount: plan.maxReducedPixelCount,
    newVramBytes: plan.newVramBytes,
    ceilingBytes: plan.ceilingBytes,
    coverageCycleFrames: plan.resolution.coverageCycleFrames,
    reason,
  });
}


export function resolveReducedPixelBudget(request) {
  const source = request && typeof request === "object" ? request : {};
  const fullWidth = readViewportSide(source.width);
  const fullHeight = readViewportSide(source.height);
  const requestedDivisor = readRequestedDivisor(source.divisor);

  if (fullWidth < 1 || fullHeight < 1) {
    return refusedBudget(
      fullWidth,
      fullHeight,
      requestedDivisor,
      "viewport was not informed (" +
        fullWidth +
        "x" +
        fullHeight +
        ") - the MSM sizes no buffer before the screen is measured",
    );
  }

  if (MSM_DIVISOR_LADDER.indexOf(requestedDivisor) === -1) {
    return refusedBudget(
      fullWidth,
      fullHeight,
      requestedDivisor,
      'unknown resolution divisor "' +
        String(source.divisor) +
        '" - the contract of MSM-F2 accepts only ' +
        MSM_DIVISOR_LADDER.join(", "),
    );
  }

  const preferredPlan = resolveBufferPlan({
    width: fullWidth,
    height: fullHeight,
    divisor: requestedDivisor,
  });

  if (planFitsCeiling(preferredPlan)) {
    return budgetFromPlan(
      requestedDivisor,
      preferredPlan,
      true,
      "divisor " +
        requestedDivisor +
        " fits: " +
        describePlanCost(preferredPlan) +
        ", within the " +
        preferredPlan.maxReducedPixelCount +
        " reduced pixels the ceiling allows",
    );
  }

  const largerDivisors = MSM_DIVISOR_LADDER.filter((divisor) => divisor > requestedDivisor);
  let lastPlan = preferredPlan;

  for (const divisor of largerDivisors) {
    const plan = resolveBufferPlan({ width: fullWidth, height: fullHeight, divisor });
    lastPlan = plan;
    if (planFitsCeiling(plan)) {
      return budgetFromPlan(
        requestedDivisor,
        plan,
        true,
        "divisor " +
          requestedDivisor +
          " asks " +
          describePlanCost(preferredPlan) +
          ", above the " +
          plan.maxReducedPixelCount +
          " reduced pixels the ceiling allows - divisor " +
          divisor +
          " is the first that fits, with " +
          describePlanCost(plan),
      );
    }
  }

  return budgetFromPlan(
    requestedDivisor,
    lastPlan,
    false,
    "no divisor of the ladder " +
      MSM_DIVISOR_LADDER.join(", ") +
      " fits this viewport: even divisor " +
      lastPlan.resolution.divisor +
      " asks " +
      describePlanCost(lastPlan) +
      ", above the " +
      lastPlan.maxReducedPixelCount +
      " reduced pixels the ceiling allows - the MSM sleeps",
  );
}


export function resolveMsmTierPixelBudget(request) {
  const source = request && typeof request === "object" ? request : {};
  const tierAnswer = describeMsmTierPolicy(source.tier);

  if (!tierAnswer.runs) {
    return Object.freeze({
      tier: tierAnswer.tier,
      runs: false,
      budget: refusedBudget(
        readViewportSide(source.width),
        readViewportSide(source.height),
        0,
        tierAnswer.reason,
      ),
      reason: tierAnswer.reason,
    });
  }

  const budget = resolveReducedPixelBudget({
    width: source.width,
    height: source.height,
    divisor: tierAnswer.policy.resolutionDivisor,
  });

  return Object.freeze({
    tier: tierAnswer.tier,
    runs: budget.fits,
    budget,
    reason: "tier " + tierAnswer.tier + ": " + budget.reason,
  });
}


export function msmTierFitsPixelBudget(request) {
  return resolveMsmTierPixelBudget(request).runs;
}
