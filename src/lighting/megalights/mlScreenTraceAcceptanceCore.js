import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import { traceScreenSpaceRay } from "./mlScreenTraceCore.js";
import { traceScreenSpaceRayLinearly, LITE_FIXED_STEP_COUNT } from "./mlLinearScreenTraceCore.js";

export const SCREEN_TRACE_ACCEPTANCE_GATES = Object.freeze({
  minimumHitMissAgreementRatio: 0.99,
  minimumStepReductionRatio: 0.4,
  maximumSelfIntersectionCount: 0,
  maximumOffScreenVisibleCount: 0,
});

const MAXIMUM_DISAGREEMENTS_KEPT = 12;

function isHit(outcome) {
  return outcome.result === MGL_TRACE_RESULT.occluded;
}

function buildGate(id, measured, required, pass, note) {
  return { id, measured, required, pass, note: note || "" };
}


function describeOutcome(outcome) {
  return {
    result: outcome.result,
    exitReason: outcome.exitReason,
    stepCount: outcome.stepCount,
    hitTexelX: outcome.hitTexelX,
    hitTexelY: outcome.hitTexelY,
    hitViewDepth: outcome.hitViewDepth,
  };
}

function describeSegment(ray) {
  return {
    startX: ray.startX,
    startY: ray.startY,
    startViewDepth: ray.startViewDepth,
    endX: ray.endX,
    endY: ray.endY,
    endViewDepth: ray.endViewDepth,
  };
}


export function compareScreenTraceAgainstLinearReference(request) {
  const pyramidLevels = request.pyramidLevels;
  const rays = request.rays || [];
  const settings = request.settings;

  const disagreements = [];
  const resultCounts = { visible: 0, occluded: 0, unknown: 0 };
  let comparedRayCount = 0;
  let hitMissAgreementCount = 0;
  let resultAgreementCount = 0;
  let hierarchicalStepTotal = 0;
  let linearStepTotal = 0;
  let liteStepTotal = 0;
  let liteHitMissAgreementCount = 0;

  for (let rayIndex = 0; rayIndex !== rays.length; rayIndex++) {
    const ray = rays[rayIndex];
    const hierarchical = traceScreenSpaceRay({ pyramidLevels, ray, settings });
    const reference = traceScreenSpaceRayLinearly({ pyramidLevels, ray, settings });
    const lite = traceScreenSpaceRayLinearly({
      pyramidLevels,
      ray,
      settings,
      fixedSampleCount: LITE_FIXED_STEP_COUNT,
    });

    comparedRayCount++;
    resultCounts[hierarchical.result] = (resultCounts[hierarchical.result] || 0) + 1;
    hierarchicalStepTotal += hierarchical.stepCount;
    linearStepTotal += reference.stepCount;
    liteStepTotal += lite.stepCount;

    if (isHit(hierarchical) === isHit(reference)) hitMissAgreementCount++;
    else if (disagreements.length < MAXIMUM_DISAGREEMENTS_KEPT) {
      disagreements.push({
        rayIndex,
        segment: describeSegment(ray),
        hierarchical: describeOutcome(hierarchical),
        reference: describeOutcome(reference),
      });
    }
    if (hierarchical.result === reference.result) resultAgreementCount++;
    if (isHit(lite) === isHit(reference)) liteHitMissAgreementCount++;
  }

  const safeRayCount = Math.max(1, comparedRayCount);
  const averageHierarchicalStepCount = hierarchicalStepTotal / safeRayCount;
  const averageLinearStepCount = linearStepTotal / safeRayCount;
  const stepReductionRatio = averageLinearStepCount > 0
    ? 1 - averageHierarchicalStepCount / averageLinearStepCount
    : 0;

  return {
    comparedRayCount,
    hitMissAgreementRatio: hitMissAgreementCount / safeRayCount,
    resultAgreementRatio: resultAgreementCount / safeRayCount,
    averageHierarchicalStepCount,
    averageLinearStepCount,
    stepReductionRatio,
    resultCounts,
    disagreements,

    liteReference: {
      fixedStepCount: LITE_FIXED_STEP_COUNT,
      averageStepCount: liteStepTotal / safeRayCount,
      hitMissAgreementRatio: liteHitMissAgreementCount / safeRayCount,
    },
  };
}


export function evaluateSelfIntersectionAcne(request) {
  const pyramidLevels = request.pyramidLevels;
  const rays = request.rays || [];
  const settings = request.settings;

  let falseOccludedCount = 0;
  const examples = [];
  for (let rayIndex = 0; rayIndex !== rays.length; rayIndex++) {
    const outcome = traceScreenSpaceRay({ pyramidLevels, ray: rays[rayIndex], settings });
    if (outcome.result !== MGL_TRACE_RESULT.occluded) continue;
    falseOccludedCount++;
    if (examples.length < MAXIMUM_DISAGREEMENTS_KEPT) {
      examples.push({ rayIndex, hitTexelX: outcome.hitTexelX, hitTexelY: outcome.hitTexelY, stepCount: outcome.stepCount });
    }
  }

  return {
    rayCount: rays.length,
    falseOccludedCount,
    falseOccludedRatio: rays.length > 0 ? falseOccludedCount / rays.length : 0,
    examples,
  };
}


export function evaluateOffScreenHonesty(request) {
  const pyramidLevels = request.pyramidLevels;
  const rays = request.rays || [];
  const settings = request.settings;

  const counts = { visible: 0, occluded: 0, unknown: 0 };
  for (let rayIndex = 0; rayIndex !== rays.length; rayIndex++) {
    const outcome = traceScreenSpaceRay({ pyramidLevels, ray: rays[rayIndex], settings });
    counts[outcome.result] = (counts[outcome.result] || 0) + 1;
  }

  return {
    rayCount: rays.length,
    visibleCount: counts.visible,


    occludedCount: counts.occluded,
    unknownCount: counts.unknown,
  };
}


export function summarizeScreenTraceAcceptance(measurements) {
  const parity = measurements.parity;
  const acne = measurements.acne;
  const offScreen = measurements.offScreen;
  const gates = [];

  if (parity) {
    gates.push(buildGate(
      "hitMissParityAgainstLinearReference",
      parity.hitMissAgreementRatio,
      SCREEN_TRACE_ACCEPTANCE_GATES.minimumHitMissAgreementRatio,
      parity.hitMissAgreementRatio >= SCREEN_TRACE_ACCEPTANCE_GATES.minimumHitMissAgreementRatio,
      "same visibility as the dense linear march",
    ));
    gates.push(buildGate(
      "averageStepReduction",
      parity.stepReductionRatio,
      SCREEN_TRACE_ACCEPTANCE_GATES.minimumStepReductionRatio,
      parity.stepReductionRatio >= SCREEN_TRACE_ACCEPTANCE_GATES.minimumStepReductionRatio,
      "pyramid steps against dense linear steps",
    ));
  }
  if (acne) {
    gates.push(buildGate(
      "zeroSelfIntersectionAcne",
      acne.falseOccludedCount,
      SCREEN_TRACE_ACCEPTANCE_GATES.maximumSelfIntersectionCount,
      acne.falseOccludedCount <= SCREEN_TRACE_ACCEPTANCE_GATES.maximumSelfIntersectionCount,
      "grazing rays on the workshop floor",
    ));
  }
  if (offScreen) {
    gates.push(buildGate(
      "offScreenIsNeverVisible",
      offScreen.visibleCount,
      SCREEN_TRACE_ACCEPTANCE_GATES.maximumOffScreenVisibleCount,
      offScreen.visibleCount <= SCREEN_TRACE_ACCEPTANCE_GATES.maximumOffScreenVisibleCount,
      "leaving the screen answers unknown",
    ));
  }

  return {
    gates,
    pass: gates.length > 0 && gates.every((gate) => gate.pass),
  };
}
