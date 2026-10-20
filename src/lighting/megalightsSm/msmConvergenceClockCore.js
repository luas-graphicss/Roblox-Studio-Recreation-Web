import { MSM_FAST_ALPHA_FRAMES } from "./msmGridDirtyCore.js";

export const MSM_CONVERGENCE_PHASE_ID = "MSM-F4";


export const MSM_CONVERGENCE_FRAMES_90 = 6;
export const MSM_CONVERGENCE_FRAMES_98 = 12;

export const MSM_FREEZE_AFTER_CLEAN_FRAMES = MSM_CONVERGENCE_FRAMES_98;


export const MSM_CLEAN_FRAME_CLAMP = 1000000;

export const MSM_PULSE_REASON_BOOT = "boot";
export const MSM_PULSE_REASON_UNKNOWN = "unknown";

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveIntegerOr(value, fallback) {
  const parsed = Math.floor(numberOr(value, fallback));
  return parsed >= 1 ? parsed : fallback;
}

function nonNegativeIntegerOr(value, fallback) {
  const parsed = Math.floor(numberOr(value, fallback));
  return parsed >= 0 ? parsed : fallback;
}


export function msmConvergenceRatioFor(framesSinceDirtyPulse, framesForFullConvergence) {
  const frames = nonNegativeIntegerOr(framesSinceDirtyPulse, 0);
  const target = positiveIntegerOr(framesForFullConvergence, MSM_CONVERGENCE_FRAMES_98);
  const ratio = frames / target;
  return ratio >= 1 ? 1 : ratio;
}

export function msmIsFrozenFor(framesSinceDirtyPulse, freezeAfterCleanFrames) {
  const frames = nonNegativeIntegerOr(framesSinceDirtyPulse, 0);
  const threshold = positiveIntegerOr(freezeAfterCleanFrames, MSM_FREEZE_AFTER_CLEAN_FRAMES);
  return frames >= threshold;
}

export function createConvergenceClock(options) {
  const settings = options || {};
  const convergenceFrames90 = positiveIntegerOr(settings.convergenceFrames90, MSM_CONVERGENCE_FRAMES_90);
  const convergenceFrames98 = positiveIntegerOr(settings.convergenceFrames98, MSM_CONVERGENCE_FRAMES_98);
  const freezeAfterCleanFrames = positiveIntegerOr(settings.freezeAfterCleanFrames, MSM_FREEZE_AFTER_CLEAN_FRAMES);
  const fastAlphaFrames = positiveIntegerOr(settings.fastAlphaFrames, MSM_FAST_ALPHA_FRAMES);

  const totals = {
    frames: 0,
    pulses: 0,
    frozenFrames: 0,
    longestCleanRun: 0,
  };

  let frame = 0;
  let framesSinceDirtyPulse = 0;
  let fastAlphaFramesLeft = fastAlphaFrames;
  let lastPulseFrame = 0;
  let lastPulseReason = MSM_PULSE_REASON_BOOT;

  function state() {
    const frozen = msmIsFrozenFor(framesSinceDirtyPulse, freezeAfterCleanFrames);
    return {
      phase: MSM_CONVERGENCE_PHASE_ID,
      frame: frame,
      framesSinceDirtyPulse: framesSinceDirtyPulse,
      fastAlphaFramesLeft: fastAlphaFramesLeft,
      inFastAlphaWindow: fastAlphaFramesLeft > 0,
      convergenceRatio: msmConvergenceRatioFor(framesSinceDirtyPulse, convergenceFrames98),
      converged90: framesSinceDirtyPulse >= convergenceFrames90,
      converged: framesSinceDirtyPulse >= convergenceFrames98,
      frozen: frozen,
      passInQueue: !frozen,
      lastPulseFrame: lastPulseFrame,
      lastPulseReason: lastPulseReason,
    };
  }


  function registerDirtyPulse(pulse) {
    const source = pulse || {};
    framesSinceDirtyPulse = 0;
    fastAlphaFramesLeft = positiveIntegerOr(source.fastAlphaFrames, fastAlphaFrames);
    lastPulseFrame = frame;
    lastPulseReason = source.reason === undefined || source.reason === null ? MSM_PULSE_REASON_UNKNOWN : String(source.reason);
    totals.pulses++;
    return state();
  }


  function tick() {
    frame++;
    totals.frames++;
    if (MSM_CLEAN_FRAME_CLAMP > framesSinceDirtyPulse) framesSinceDirtyPulse++;
    if (fastAlphaFramesLeft > 0) fastAlphaFramesLeft--;
    if (framesSinceDirtyPulse > totals.longestCleanRun) totals.longestCleanRun = framesSinceDirtyPulse;
    const currentState = state();
    if (currentState.frozen) totals.frozenFrames++;
    return currentState;
  }

  function stats() {
    return {
      phase: MSM_CONVERGENCE_PHASE_ID,
      frames: totals.frames,
      pulses: totals.pulses,
      frozenFrames: totals.frozenFrames,
      longestCleanRun: totals.longestCleanRun,
      convergenceFrames90: convergenceFrames90,
      convergenceFrames98: convergenceFrames98,
      freezeAfterCleanFrames: freezeAfterCleanFrames,
      fastAlphaFrames: fastAlphaFrames,
    };
  }

  function reset() {
    frame = 0;
    framesSinceDirtyPulse = 0;
    fastAlphaFramesLeft = fastAlphaFrames;
    lastPulseFrame = 0;
    lastPulseReason = MSM_PULSE_REASON_BOOT;
    Object.keys(totals).forEach((field) => {
      totals[field] = 0;
    });
    return true;
  }

  return {
    registerDirtyPulse: registerDirtyPulse,
    tick: tick,
    state: state,
    stats: stats,
    reset: reset,
  };
}
