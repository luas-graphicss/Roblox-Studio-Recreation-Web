import { MSM_CONVERGENCE_FRAMES_98, MSM_FREEZE_AFTER_CLEAN_FRAMES } from "./msmConvergenceClockCore.js";
import { MSM_TEMPORAL_PASS_ID, findPass } from "./msmPipelineContract.js";
import { evaluateVerdictGate, verdictGateByPlanId } from "./msmVerdictGatesCore.js";
import {
  MSM_TEMPORAL_ALPHA_BOOST,
  MSM_TEMPORAL_ALPHA_REASON,
  MSM_TEMPORAL_ALPHA_STEADY,
  MSM_TEMPORAL_BOOST_FRAMES,
  msmBlendedHistoryValue,
  msmTemporalDecisionFor,
} from "./msmTemporalCore.js";

export const MSM_CONVERGENCE_PROOF_PHASE_ID = "MSM-F27";

export const MSM_CONVERGENCE_GATE_PLAN_ID = "G6";
export const MSM_IDLE_GATE_PLAN_ID = "G8";


export const MSM_CONVERGENCE_MILESTONES = Object.freeze([
  Object.freeze({ metric: "framesToReachNinetyPercentOfTheFinalValue", fraction: 0.9 }),
  Object.freeze({ metric: "framesToReachNinetyEightPercentOfTheFinalValue", fraction: 0.98 }),
]);

export const MSM_IDLE_METRIC = Object.freeze({
  NEW_FRAMES: "newMsmFramesWhileTheSceneIsIdle",
  MILLISECONDS: "msmMillisecondsWhileTheSceneIsIdle",
  ATLAS_PAGE_RERENDERS: "atlasPageRerendersWhileTheSceneIsIdle",
});



export const MSM_CONVERGENCE_HORIZON_FRAMES = MSM_CONVERGENCE_FRAMES_98 * 4;




const TEMPORAL_PASS = findPass(MSM_TEMPORAL_PASS_ID);
export const MSM_TEMPORAL_PASS_BUDGET_MS = TEMPORAL_PASS ? TEMPORAL_PASS.budgetTargetMs : 0;

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegativeIntegerOr(value, fallback) {
  const parsed = Math.floor(numberOr(value, fallback));
  return parsed >= 0 ? parsed : fallback;
}

function positiveIntegerOr(value, fallback) {
  const parsed = Math.floor(numberOr(value, fallback));
  return parsed >= 1 ? parsed : fallback;
}

function requirementFor(planId, metric) {
  const gate = verdictGateByPlanId(planId);
  if (!gate) return null;
  return gate.requirements.find((entry) => entry.metric === metric) || null;
}


export function verifyGateMetricBindings() {
  const problems = [];
  MSM_CONVERGENCE_MILESTONES.forEach((milestone) => {
    if (!requirementFor(MSM_CONVERGENCE_GATE_PLAN_ID, milestone.metric)) {
      problems.push(MSM_CONVERGENCE_GATE_PLAN_ID + ' nao tem a metrica "' + milestone.metric + '"');
    }
  });
  Object.keys(MSM_IDLE_METRIC).forEach((key) => {
    const metric = MSM_IDLE_METRIC[key];
    if (!requirementFor(MSM_IDLE_GATE_PLAN_ID, metric)) {
      problems.push(MSM_IDLE_GATE_PLAN_ID + ' nao tem a metrica "' + metric + '"');
    }
  });
  return { ok: problems.length === 0, problems };
}


export function createAlphaScheduleFromTemporalCore(options) {
  const settings = options || {};
  const boostFrames = positiveIntegerOr(settings.boostFrames, MSM_TEMPORAL_BOOST_FRAMES);
  const freezeAfterFrames = positiveIntegerOr(settings.freezeAfterFrames, MSM_FREEZE_AFTER_CLEAN_FRAMES);
  const steadyAlphaOverride = Number.isFinite(Number(settings.steadyAlpha)) ? Number(settings.steadyAlpha) : null;
  return function alphaForFrame(frameIndexSinceDirtyPulse) {
    const frameIndex = nonNegativeIntegerOr(frameIndexSinceDirtyPulse, 0);
    const decision = msmTemporalDecisionFor({
      framesSinceDirtyPulse: frameIndex,
      frozen: frameIndex >= freezeAfterFrames,
      boostFrames: boostFrames,
    });
    if (steadyAlphaOverride !== null && decision.alphaReason === MSM_TEMPORAL_ALPHA_REASON.STEADY) {
      return steadyAlphaOverride;
    }
    return decision.alpha;
  };
}


export function simulateHistoryStepResponse(request) {
  const source = request && typeof request === "object" ? request : {};
  const alphaForFrame = typeof source.alphaForFrame === "function" ? source.alphaForFrame : null;
  const frameCount = positiveIntegerOr(source.frameCount, MSM_CONVERGENCE_HORIZON_FRAMES);
  const finalValue = numberOr(source.finalValue, 1);
  const frames = [];
  let history = numberOr(source.initialValue, 0);
  for (let frameIndex = 0; frameCount > frameIndex; frameIndex++) {
    const alpha = alphaForFrame ? numberOr(alphaForFrame(frameIndex), 0) : 0;
    history = msmBlendedHistoryValue(history, finalValue, alpha);
    const residual = finalValue === 0 ? 0 : Math.abs(finalValue - history) / Math.abs(finalValue);
    frames.push(
      Object.freeze({
        frame: frameIndex + 1,
        framesSinceDirtyPulse: frameIndex,
        alpha: alpha,
        history: history,
        residual: residual,
        convergedFraction: 1 - residual,
      }),
    );
  }
  return Object.freeze({
    phase: MSM_CONVERGENCE_PROOF_PHASE_ID,
    finalValue: finalValue,
    frameCount: frameCount,
    frames: Object.freeze(frames),
  });
}


export function measureAlphaScheduleConvergence(request) {
  const source = request && typeof request === "object" ? request : {};
  const horizonFrames = positiveIntegerOr(source.horizonFrames, MSM_CONVERGENCE_HORIZON_FRAMES);
  const response = simulateHistoryStepResponse({ alphaForFrame: source.alphaForFrame, frameCount: horizonFrames });
  const milestones = MSM_CONVERGENCE_MILESTONES.map((milestone) => {
    const requirement = requirementFor(MSM_CONVERGENCE_GATE_PLAN_ID, milestone.metric);
    const firstFrame = response.frames.find((entry) => entry.convergedFraction >= milestone.fraction) || null;
    const reached = firstFrame !== null;
    return Object.freeze({
      metric: milestone.metric,
      fraction: milestone.fraction,
      targetFrames: requirement ? requirement.target : null,
      frames: reached ? firstFrame.frame : null,
      reached: reached,
      saturatedAtHorizon: !reached,
      gateMeasurement: reached ? firstFrame.frame : horizonFrames + 1,
    });
  });
  const gateMeasurements = {};
  milestones.forEach((entry) => {
    gateMeasurements[entry.metric] = entry.gateMeasurement;
  });
  const lastFrame = response.frames[response.frames.length - 1] || null;
  return Object.freeze({
    phase: MSM_CONVERGENCE_PROOF_PHASE_ID,
    horizonFrames: horizonFrames,
    frames: response.frames,
    milestones: Object.freeze(milestones),
    finalConvergedFraction: lastFrame ? lastFrame.convergedFraction : 0,
    gateMeasurements: Object.freeze(gateMeasurements),
    g6: evaluateVerdictGate(MSM_CONVERGENCE_GATE_PLAN_ID, gateMeasurements),
  });
}


export function msmConvergedFractionAfterFrames(request) {
  const source = request && typeof request === "object" ? request : {};
  const frameCount = nonNegativeIntegerOr(source.frameCount, 0);
  if (frameCount === 0) return 0;
  const response = simulateHistoryStepResponse({ alphaForFrame: source.alphaForFrame, frameCount: frameCount });
  const lastFrame = response.frames[response.frames.length - 1];
  return lastFrame ? lastFrame.convergedFraction : 0;
}


export function resolveMinimumSteadyAlphaForG6(request) {
  const source = request && typeof request === "object" ? request : {};
  const boostAlpha = numberOr(source.boostAlpha, MSM_TEMPORAL_ALPHA_BOOST);
  const boostFrames = positiveIntegerOr(source.boostFrames, MSM_TEMPORAL_BOOST_FRAMES);
  const boostResidual = Math.pow(1 - boostAlpha, boostFrames);
  const perMilestone = MSM_CONVERGENCE_MILESTONES.map((milestone) => {
    const requirement = requirementFor(MSM_CONVERGENCE_GATE_PLAN_ID, milestone.metric);
    const targetFrames = requirement ? requirement.target : null;
    const steadyFrames = targetFrames === null ? 0 : targetFrames - boostFrames;
    const allowedResidual = 1 - milestone.fraction;
    const requiredSteadyResidual = boostResidual > 0 ? allowedResidual / boostResidual : 0;
    let minimumSteadyAlpha = null;
    if (steadyFrames >= 1) {
      minimumSteadyAlpha = requiredSteadyResidual >= 1 ? 0 : 1 - Math.pow(requiredSteadyResidual, 1 / steadyFrames);
    }
    return Object.freeze({
      metric: milestone.metric,
      fraction: milestone.fraction,
      targetFrames: targetFrames,
      steadyFrames: steadyFrames,
      allowedResidual: allowedResidual,
      minimumSteadyAlpha: minimumSteadyAlpha,
    });
  });
  let binding = null;
  perMilestone.forEach((entry) => {
    if (entry.minimumSteadyAlpha === null) return;
    if (binding === null || entry.minimumSteadyAlpha > binding.minimumSteadyAlpha) binding = entry;
  });
  return Object.freeze({
    phase: MSM_CONVERGENCE_PROOF_PHASE_ID,
    boostAlpha: boostAlpha,
    boostFrames: boostFrames,
    boostResidual: boostResidual,
    perMilestone: Object.freeze(perMilestone),
    minimumSteadyAlpha: binding ? binding.minimumSteadyAlpha : null,
    bindingMetric: binding ? binding.metric : null,
  });
}

function strictestMilestoneFraction() {
  return MSM_CONVERGENCE_MILESTONES.reduce((worst, entry) => (entry.fraction > worst ? entry.fraction : worst), 0);
}


export function resolveMinimumFreezeFramesForSteadyAlpha(request) {
  const source = request && typeof request === "object" ? request : {};
  const steadyAlpha = numberOr(source.steadyAlpha, MSM_TEMPORAL_ALPHA_STEADY);
  const boostAlpha = numberOr(source.boostAlpha, MSM_TEMPORAL_ALPHA_BOOST);
  const boostFrames = positiveIntegerOr(source.boostFrames, MSM_TEMPORAL_BOOST_FRAMES);
  const fraction = numberOr(source.fraction, strictestMilestoneFraction());
  const boostResidual = Math.pow(1 - boostAlpha, boostFrames);
  const allowedResidual = 1 - fraction;
  const base = {
    phase: MSM_CONVERGENCE_PROOF_PHASE_ID,
    steadyAlpha: steadyAlpha,
    boostAlpha: boostAlpha,
    boostFrames: boostFrames,
    fraction: fraction,
    boostResidual: boostResidual,
  };
  if (allowedResidual >= boostResidual) {
    return Object.freeze(Object.assign({}, base, { steadyFrames: 0, frames: boostFrames, reachable: true }));
  }
  if (!(steadyAlpha > 0)) {
    return Object.freeze(Object.assign({}, base, { steadyFrames: null, frames: null, reachable: false }));
  }
  const steadyFrames = Math.ceil(Math.log(allowedResidual / boostResidual) / Math.log(1 - steadyAlpha));
  return Object.freeze(
    Object.assign({}, base, { steadyFrames: steadyFrames, frames: boostFrames + steadyFrames, reachable: true }),
  );
}


export function judgeIdleBrake(request) {
  const source = request && typeof request === "object" ? request : {};
  const scheduledTemporalPasses = nonNegativeIntegerOr(source.scheduledTemporalPasses, 0);
  const newMsmFrames = nonNegativeIntegerOr(source.newMsmFrames, scheduledTemporalPasses);
  const modelledMilliseconds = scheduledTemporalPasses * MSM_TEMPORAL_PASS_BUDGET_MS;
  const atlasPageRerenders = Number(source.atlasPageRerenders);
  const atlasDeclared = Number.isFinite(atlasPageRerenders);
  const gateMeasurements = {};
  gateMeasurements[MSM_IDLE_METRIC.NEW_FRAMES] = newMsmFrames;
  gateMeasurements[MSM_IDLE_METRIC.MILLISECONDS] = modelledMilliseconds;
  if (atlasDeclared) gateMeasurements[MSM_IDLE_METRIC.ATLAS_PAGE_RERENDERS] = atlasPageRerenders;
  return Object.freeze({
    phase: MSM_CONVERGENCE_PROOF_PHASE_ID,
    scheduledTemporalPasses: scheduledTemporalPasses,
    newMsmFrames: newMsmFrames,
    millisecondsPerTemporalPass: MSM_TEMPORAL_PASS_BUDGET_MS,
    modelledMilliseconds: modelledMilliseconds,
    millisecondsAreModelledNotMeasured: true,
    atlasPageRerendersDeclaredByAnotherPhase: atlasDeclared,
    gateMeasurements: Object.freeze(gateMeasurements),
    g8: evaluateVerdictGate(MSM_IDLE_GATE_PLAN_ID, gateMeasurements),
  });
}
