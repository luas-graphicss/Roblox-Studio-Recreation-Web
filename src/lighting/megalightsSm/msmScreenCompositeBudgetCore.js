import { listPasses } from "./msmPipelineContract.js";
import { describeMsmTierPolicy, getMsmTierPolicy } from "./msmTierPolicy.js";
import {
  MSM_SCREEN_COMPOSITE_OWNER_PHASE,
  MSM_SCREEN_COMPOSITE_PATCH_SLOT_ID,
} from "./msmScreenCompositeCore.js";


export const MSM_BUDGET_VERDICT = Object.freeze({
  PASS: "PASS",
  REFUSED: "REFUSED",
  PENDING: "PENDING",
});


export const MSM_SCREEN_COMPOSITE_TARGET_MS = 0.2;
export const MSM_SCREEN_COMPOSITE_TARGET_MS_FROM_PLAN = false;


export const MSM_PLAN_SIDE_COSTS = Object.freeze([
  Object.freeze({
    id: "world-grid-rebuild",
    targetMs: 0.6,
    nature: "cpu",
    ownerPhase: "MSM-F8",
    onlyOnDirtyFrames: true,
    partOfModeA: true,
  }),
  Object.freeze({
    id: "atlas-pages",
    targetMs: 0.4,
    nature: "gpu",
    ownerPhase: "MSM-F17",
    onlyOnDirtyFrames: true,
    partOfModeA: true,
  }),
  Object.freeze({
    id: "forward-injection",
    targetMs: 0.2,
    nature: "gpu",
    ownerPhase: "MSM-F24",
    onlyOnDirtyFrames: false,
    partOfModeA: false,
  }),
]);

function sumTargetMs(entries) {
  return entries.reduce((total, entry) => total + entry.targetMs, 0);
}

function roundToMicroseconds(value) {
  return Math.round(value * 1000) / 1000;
}

function listModeACostIds() {
  const passIds = listPasses().map((pass) => pass.id);
  return passIds.concat([MSM_SCREEN_COMPOSITE_PATCH_SLOT_ID]);
}

function readMeasurement(measuredMsById) {
  const costIds = listModeACostIds();
  const source = measuredMsById && typeof measuredMsById === "object" ? measuredMsById : null;
  if (!source) {
    return { measurementTaken: false, measuredTotalMs: 0, missingCostIds: Object.freeze(costIds) };
  }
  const missingCostIds = [];
  let measuredTotalMs = 0;
  costIds.forEach((costId) => {
    const measured = Number(source[costId]);
    if (Number.isFinite(measured) && measured >= 0) {
      measuredTotalMs += measured;
      return;
    }
    missingCostIds.push(costId);
  });
  return {
    measurementTaken: missingCostIds.length === 0,
    measuredTotalMs: roundToMicroseconds(measuredTotalMs),
    missingCostIds: Object.freeze(missingCostIds),
  };
}


export function describeScreenCompositeBudget(request) {
  const source = request && typeof request === "object" ? request : {};
  const tierAnswer = describeMsmTierPolicy(source.tier);
  const policy = getMsmTierPolicy(source.tier);

  if (!policy) {
    return Object.freeze({
      known: false,
      ownerPhase: MSM_SCREEN_COMPOSITE_OWNER_PHASE,
      tier: tierAnswer.tier,
      reason: tierAnswer.reason,
      verdict: MSM_BUDGET_VERDICT.REFUSED,
    });
  }

  const passTargets = listPasses().map((pass) =>
    Object.freeze({ id: pass.id, targetMs: pass.budgetTargetMs }),
  );
  const declaredPassMs = roundToMicroseconds(sumTargetMs(passTargets));
  const declaredModeATotalMs = roundToMicroseconds(declaredPassMs + MSM_SCREEN_COMPOSITE_TARGET_MS);
  const modeASideCosts = MSM_PLAN_SIDE_COSTS.filter((sideCost) => sideCost.partOfModeA === true);
  const gpuSideCostMs = roundToMicroseconds(
    sumTargetMs(modeASideCosts.filter((sideCost) => sideCost.nature === "gpu")),
  );
  const cpuSideCostMs = roundToMicroseconds(
    sumTargetMs(modeASideCosts.filter((sideCost) => sideCost.nature === "cpu")),
  );
  const declaredWithSideCostsMs = roundToMicroseconds(declaredModeATotalMs + gpuSideCostMs + cpuSideCostMs);
  const measurement = readMeasurement(source.measuredMsById);

  const withinTierBudget = policy.budgetMs >= declaredModeATotalMs;
  const measuredWithinTierBudget = measurement.measurementTaken
    ? policy.budgetMs >= measurement.measuredTotalMs
    : false;
  const verdict = !measurement.measurementTaken
    ? MSM_BUDGET_VERDICT.PENDING
    : measuredWithinTierBudget
      ? MSM_BUDGET_VERDICT.PASS
      : MSM_BUDGET_VERDICT.REFUSED;

  return Object.freeze({
    known: true,
    ownerPhase: MSM_SCREEN_COMPOSITE_OWNER_PHASE,
    tier: policy.tier,
    tierBudgetMs: policy.budgetMs,
    passTargets: Object.freeze(passTargets),
    declaredPassMs,
    compositeTargetMs: MSM_SCREEN_COMPOSITE_TARGET_MS,
    compositeTargetFromPlan: MSM_SCREEN_COMPOSITE_TARGET_MS_FROM_PLAN,
    declaredModeATotalMs,
    gpuSideCostMs,
    cpuSideCostMs,
    declaredWithSideCostsMs,
    withinTierBudget,
    headroomMs: roundToMicroseconds(policy.budgetMs - declaredModeATotalMs),
    planOverSubscribed: declaredWithSideCostsMs > policy.budgetMs,
    planOverSubscriptionMs: roundToMicroseconds(
      Math.max(0, declaredWithSideCostsMs - policy.budgetMs),
    ),
    measurementTaken: measurement.measurementTaken,
    measuredTotalMs: measurement.measuredTotalMs,
    missingCostIds: measurement.missingCostIds,
    measuredWithinTierBudget,
    verdict,
    reason: tierAnswer.reason,
  });
}
