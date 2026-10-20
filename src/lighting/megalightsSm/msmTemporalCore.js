import {
  MSM_DIRTY_TARGET,
  MSM_FAST_ALPHA_FRAMES,
  MSM_HISTORY_ACTION,
  msmDirtyActionFor,
} from "./msmGridDirtyCore.js";
import { createConvergenceClock } from "./msmConvergenceClockCore.js";

export const MSM_TEMPORAL_PHASE_ID = "MSM-F27";


export const MSM_TEMPORAL_ALPHA_RESET = 1;
export const MSM_TEMPORAL_ALPHA_BOOST = 0.5;
export const MSM_TEMPORAL_ALPHA_STEADY = 0.1;
export const MSM_TEMPORAL_ALPHA_FROZEN = 0;


export const MSM_TEMPORAL_BOOST_FRAMES = Math.floor(MSM_FAST_ALPHA_FRAMES / 2);


export const MSM_TEMPORAL_BLEND_ARGUMENT_ORDER = Object.freeze(["historyValue", "sampleValue", "alpha"]);

export const MSM_TEMPORAL_ALPHA_REASON = Object.freeze({
  HISTORY_RESET: "history-reset",
  BOOST_WINDOW: "boost-window",
  STEADY: "steady",
  IDLE_BRAKE: "idle-brake",
  REPROJECTION_WHILE_FROZEN: "reprojection-while-frozen",
});

export const MSM_TEMPORAL_REFUSAL = Object.freeze({
  UNKNOWN_HISTORY_ACTION: "unknown-history-action",
});

const HISTORY_ACTION_VALUES = Object.freeze(Object.keys(MSM_HISTORY_ACTION).map((key) => MSM_HISTORY_ACTION[key]));

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

function clampedUnitInterval(value) {
  const parsed = numberOr(value, 0);
  if (parsed >= 1) return 1;
  if (parsed >= 0) return parsed;
  return 0;
}

function isKnownHistoryAction(historyAction) {
  return HISTORY_ACTION_VALUES.indexOf(historyAction) >= 0;
}


export function msmTemporalHistoryActionForEvent(eventType) {
  return msmDirtyActionFor(eventType, MSM_DIRTY_TARGET.TEMPORAL_HISTORY);
}

function temporalDecision(fields) {
  const alpha = fields.alpha;
  const passScheduled = fields.passScheduled === true;
  return Object.freeze({
    phase: MSM_TEMPORAL_PHASE_ID,
    alpha: alpha,
    alphaReason: fields.alphaReason,
    historyAction: fields.historyAction,
    historyActionAccepted: fields.historyActionAccepted !== false,
    passScheduled: passScheduled,


    requestsNewFrame: passScheduled && alpha > 0,
    historyDiscarded: fields.historyDiscarded === true,
    idleBrakeEngaged: fields.idleBrakeEngaged === true,
    inBoostWindow: fields.inBoostWindow === true,
    framesSinceDirtyPulse: fields.framesSinceDirtyPulse,
    refusal: fields.refusal === undefined ? null : fields.refusal,
  });
}


export function msmTemporalDecisionFor(request) {
  const source = request && typeof request === "object" ? request : {};
  const rawHistoryAction =
    source.historyAction === undefined || source.historyAction === null
      ? MSM_HISTORY_ACTION.NONE
      : String(source.historyAction);
  const historyActionAccepted = isKnownHistoryAction(rawHistoryAction);
  const historyAction = historyActionAccepted ? rawHistoryAction : MSM_HISTORY_ACTION.NONE;
  const framesSinceDirtyPulse = nonNegativeIntegerOr(source.framesSinceDirtyPulse, 0);
  const boostFrames = positiveIntegerOr(source.boostFrames, MSM_TEMPORAL_BOOST_FRAMES);
  const frozen = source.frozen === true;
  const inBoostWindow = boostFrames > framesSinceDirtyPulse;
  const shared = {
    historyAction: historyAction,
    historyActionAccepted: historyActionAccepted,
    framesSinceDirtyPulse: framesSinceDirtyPulse,
    inBoostWindow: inBoostWindow,
    refusal: historyActionAccepted ? null : MSM_TEMPORAL_REFUSAL.UNKNOWN_HISTORY_ACTION,
  };

  if (historyAction === MSM_HISTORY_ACTION.RESET) {
    return temporalDecision(
      Object.assign({}, shared, {
        alpha: MSM_TEMPORAL_ALPHA_RESET,
        alphaReason: MSM_TEMPORAL_ALPHA_REASON.HISTORY_RESET,
        passScheduled: true,
        historyDiscarded: true,
      }),
    );
  }
  if (historyAction === MSM_HISTORY_ACTION.FAST_ALPHA) {
    return temporalDecision(
      Object.assign({}, shared, {
        alpha: MSM_TEMPORAL_ALPHA_BOOST,
        alphaReason: MSM_TEMPORAL_ALPHA_REASON.BOOST_WINDOW,
        passScheduled: true,
        inBoostWindow: true,
      }),
    );
  }
  if (frozen && historyAction === MSM_HISTORY_ACTION.REPROJECT) {
    return temporalDecision(
      Object.assign({}, shared, {
        alpha: MSM_TEMPORAL_ALPHA_STEADY,
        alphaReason: MSM_TEMPORAL_ALPHA_REASON.REPROJECTION_WHILE_FROZEN,
        passScheduled: true,
      }),
    );
  }
  if (frozen) {
    return temporalDecision(
      Object.assign({}, shared, {
        alpha: MSM_TEMPORAL_ALPHA_FROZEN,
        alphaReason: MSM_TEMPORAL_ALPHA_REASON.IDLE_BRAKE,
        passScheduled: false,
        idleBrakeEngaged: true,
      }),
    );
  }
  if (inBoostWindow) {
    return temporalDecision(
      Object.assign({}, shared, {
        alpha: MSM_TEMPORAL_ALPHA_BOOST,
        alphaReason: MSM_TEMPORAL_ALPHA_REASON.BOOST_WINDOW,
        passScheduled: true,
      }),
    );
  }
  return temporalDecision(
    Object.assign({}, shared, {
      alpha: MSM_TEMPORAL_ALPHA_STEADY,
      alphaReason: MSM_TEMPORAL_ALPHA_REASON.STEADY,
      passScheduled: true,
    }),
  );
}


export function msmTemporalAlphaFor(request) {
  return msmTemporalDecisionFor(request).alpha;
}


export function msmBlendedHistoryValue(historyValue, sampleValue, alpha) {
  const history = numberOr(historyValue, 0);
  const sample = numberOr(sampleValue, 0);
  const weight = clampedUnitInterval(alpha);
  if (weight === MSM_TEMPORAL_ALPHA_FROZEN) return history;
  if (weight === MSM_TEMPORAL_ALPHA_RESET) return sample;
  return history + (sample - history) * weight;
}


export function createTemporalAccumulator(options) {
  const settings = options || {};
  const clock = settings.clock || createConvergenceClock(settings.clockOptions);
  const boostFrames = positiveIntegerOr(settings.boostFrames, MSM_TEMPORAL_BOOST_FRAMES);

  const totals = {
    observedFrames: 0,
    accumulatedFrames: 0,
    skippedFrames: 0,
    dirtyPulses: 0,
    historyResets: 0,
    boostAlphaFrames: 0,
    steadyAlphaFrames: 0,
    idleBrakeFrames: 0,
    reprojectionWhileFrozenFrames: 0,
    refusedFrames: 0,
    worstReignitionLatencyFrames: 0,
  };

  let pendingPulseObservedFrame = null;
  let lastReport = null;

  function historySectionOf(plan) {
    return plan.temporalHistory && typeof plan.temporalHistory === "object" ? plan.temporalHistory : {};
  }

  function pulseReasonOf(plan) {
    return Array.isArray(plan.eventTypes) && plan.eventTypes.length >= 1 ? plan.eventTypes.join("+") : undefined;
  }

  function countAlphaReason(decision) {
    if (decision.alphaReason === MSM_TEMPORAL_ALPHA_REASON.HISTORY_RESET) totals.historyResets++;
    if (decision.alphaReason === MSM_TEMPORAL_ALPHA_REASON.BOOST_WINDOW) totals.boostAlphaFrames++;
    if (decision.alphaReason === MSM_TEMPORAL_ALPHA_REASON.STEADY) totals.steadyAlphaFrames++;
    if (decision.alphaReason === MSM_TEMPORAL_ALPHA_REASON.IDLE_BRAKE) totals.idleBrakeFrames++;
    if (decision.alphaReason === MSM_TEMPORAL_ALPHA_REASON.REPROJECTION_WHILE_FROZEN) {
      totals.reprojectionWhileFrozenFrames++;
    }
    if (!decision.historyActionAccepted) totals.refusedFrames++;
  }

  function planFrame(framePlan) {
    const plan = framePlan && typeof framePlan === "object" ? framePlan : {};
    const historySection = historySectionOf(plan);
    totals.observedFrames++;

    if (plan.dirtyPulse === true) {
      clock.registerDirtyPulse({ reason: pulseReasonOf(plan), fastAlphaFrames: historySection.fastAlphaFrames });
      totals.dirtyPulses++;
      pendingPulseObservedFrame = totals.observedFrames;
    }

    const clockState = clock.state();
    const decision = msmTemporalDecisionFor({
      historyAction: historySection.action,
      framesSinceDirtyPulse: clockState.framesSinceDirtyPulse,
      frozen: clockState.frozen,
      boostFrames: boostFrames,
    });
    countAlphaReason(decision);

    let reignitionLatencyFrames = null;
    if (decision.passScheduled) {
      totals.accumulatedFrames++;
      if (pendingPulseObservedFrame !== null) {
        reignitionLatencyFrames = totals.observedFrames - pendingPulseObservedFrame;
        if (reignitionLatencyFrames > totals.worstReignitionLatencyFrames) {
          totals.worstReignitionLatencyFrames = reignitionLatencyFrames;
        }
        pendingPulseObservedFrame = null;
      }
      clock.tick();
    } else {
      totals.skippedFrames++;
    }

    lastReport = Object.freeze({
      phase: MSM_TEMPORAL_PHASE_ID,
      frame: totals.observedFrames,
      accumulatedFrame: totals.accumulatedFrames,
      alpha: decision.alpha,
      alphaReason: decision.alphaReason,
      historyAction: decision.historyAction,
      historyActionAccepted: decision.historyActionAccepted,
      passScheduled: decision.passScheduled,
      requestsNewFrame: decision.requestsNewFrame,
      historyDiscarded: decision.historyDiscarded,
      idleBrakeEngaged: decision.idleBrakeEngaged,
      inBoostWindow: decision.inBoostWindow,
      framesSinceDirtyPulse: decision.framesSinceDirtyPulse,
      convergenceRatio: clockState.convergenceRatio,
      converged: clockState.converged,
      reignitionLatencyFrames: reignitionLatencyFrames,
      refusal: decision.refusal,
    });
    return lastReport;
  }

  function stats() {
    return {
      phase: MSM_TEMPORAL_PHASE_ID,
      observedFrames: totals.observedFrames,
      accumulatedFrames: totals.accumulatedFrames,
      skippedFrames: totals.skippedFrames,
      dirtyPulses: totals.dirtyPulses,
      historyResets: totals.historyResets,
      boostAlphaFrames: totals.boostAlphaFrames,
      steadyAlphaFrames: totals.steadyAlphaFrames,
      idleBrakeFrames: totals.idleBrakeFrames,
      reprojectionWhileFrozenFrames: totals.reprojectionWhileFrozenFrames,
      refusedFrames: totals.refusedFrames,
      worstReignitionLatencyFrames: totals.worstReignitionLatencyFrames,
      configuredBoostFrames: boostFrames,
      lastAlpha: lastReport ? lastReport.alpha : null,
    };
  }

  function reset() {
    Object.keys(totals).forEach((field) => {
      totals[field] = 0;
    });
    pendingPulseObservedFrame = null;
    lastReport = null;
    clock.reset();
    return true;
  }

  return {
    planFrame: planFrame,
    lastFrame: () => lastReport,
    clockState: () => clock.state(),
    stats: stats,
    reset: reset,
  };
}
