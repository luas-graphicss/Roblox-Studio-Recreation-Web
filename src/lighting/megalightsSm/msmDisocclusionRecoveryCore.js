import { MSM_FAST_ALPHA_FRAMES, MSM_HISTORY_ACTION } from "./msmGridDirtyCore.js";

export const MSM_DISOCCLUSION_RECOVERY_OWNER = "MSM-F29";


export const MSM_DISOCCLUSION_RECOVERY_FRAMES = MSM_FAST_ALPHA_FRAMES;


export const MSM_DISOCCLUSION_ALPHA = 0.5;


export const MSM_DISOCCLUSION_RECOVERY_TARGET_RATIO = 0.9;


export const MSM_NO_ALPHA_OVERRIDE = -1;


export const MSM_RECOVERY_FRAME_SEARCH_CEILING = 64;

export const MSM_DISOCCLUSION_STATE = Object.freeze({
  NONE: "none",
  FULL_RESET: "full-reset",
  FAST_RECOVERY: "fast-recovery",
  FROZEN: "frozen",
  REFUSED: "refused",
});


export const MSM_REFUSED_RECOVERY_SCHEDULES = Object.freeze([
  Object.freeze({
    id: "pulse-schedule-of-msm-f27",
    alphas: Object.freeze([0.5, 0.5, 0.1, 0.1]),
    whyRefused:
      "it drops to the slow alpha at frame 3, so 20.25% of the guess is still in the pixel at frame 4 and full recovery takes 11 frames - the acceptance of this phase asks for 4",
  }),
  Object.freeze({
    id: "alpha-1-on-the-first-frame",
    alphas: Object.freeze([1]),
    whyRefused:
      "throwing the prior away on the first frame brings back the single noisy sample the prior exists to hide, which is the firefly gate G7 forbids",
  }),
]);

function positiveIntegerOr(value, fallback) {
  const parsed = Math.floor(Number(value));
  return parsed >= 1 ? parsed : fallback;
}

function alphaOr(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed > 1) return 1;
  if (0 > parsed) return 0;
  return parsed;
}


export function msmDisocclusionAlphaSchedule() {
  const schedule = [];
  for (let frame = 0; MSM_DISOCCLUSION_RECOVERY_FRAMES > frame; frame += 1) {
    schedule.push(MSM_DISOCCLUSION_ALPHA);
  }
  return schedule;
}


export function msmDisocclusionAlphaAt(framesSinceDisocclusion) {
  const frame = Math.floor(Number(framesSinceDisocclusion));
  if (!Number.isFinite(frame) || 1 > frame) return MSM_NO_ALPHA_OVERRIDE;
  if (frame > MSM_DISOCCLUSION_RECOVERY_FRAMES) return MSM_NO_ALPHA_OVERRIDE;
  return MSM_DISOCCLUSION_ALPHA;
}


export function msmRemainingGuessWeight(alphas, frames) {
  const schedule = Array.isArray(alphas) && alphas.length >= 1 ? alphas : msmDisocclusionAlphaSchedule();
  const frameCount = Math.floor(Number(frames));
  if (!Number.isFinite(frameCount) || 1 > frameCount) return 1;
  let remaining = 1;
  for (let frame = 0; frameCount > frame; frame += 1) {
    const index = schedule.length > frame ? frame : schedule.length - 1;
    remaining *= 1 - alphaOr(schedule[index], MSM_DISOCCLUSION_ALPHA);
  }
  return remaining;
}


export function msmRecoveredRatio(alphas, frames) {
  return 1 - msmRemainingGuessWeight(alphas, frames);
}


export function msmFramesToRecover(alphas, targetRatio, frameCeiling) {
  const target = alphaOr(targetRatio, MSM_DISOCCLUSION_RECOVERY_TARGET_RATIO);
  const ceiling = positiveIntegerOr(frameCeiling, MSM_RECOVERY_FRAME_SEARCH_CEILING);
  for (let frame = 1; ceiling >= frame; frame += 1) {
    if (msmRecoveredRatio(alphas, frame) >= target) return frame;
  }
  return 0;
}


export function msmDisocclusionFromHistoryAction(historyAction) {
  if (historyAction === MSM_HISTORY_ACTION.RESET) {
    return Object.freeze({
      state: MSM_DISOCCLUSION_STATE.FULL_RESET,
      historyConfidence: 0,
      recoveryFrames: MSM_DISOCCLUSION_RECOVERY_FRAMES,
      alphaOverride: MSM_DISOCCLUSION_ALPHA,
      reason: "the history was thrown away, so every pixel starts from the coarse prior of this phase",
    });
  }

  if (historyAction === MSM_HISTORY_ACTION.FAST_ALPHA) {
    return Object.freeze({
      state: MSM_DISOCCLUSION_STATE.FAST_RECOVERY,
      historyConfidence: 1,
      recoveryFrames: MSM_DISOCCLUSION_RECOVERY_FRAMES,
      alphaOverride: MSM_DISOCCLUSION_ALPHA,
      reason: "the history is still valid but stale, so it is kept and drained fast instead of being replaced",
    });
  }

  if (historyAction === MSM_HISTORY_ACTION.FREEZE) {
    return Object.freeze({
      state: MSM_DISOCCLUSION_STATE.FROZEN,
      historyConfidence: 1,
      recoveryFrames: 0,
      alphaOverride: MSM_NO_ALPHA_OVERRIDE,
      reason: "the idle brake of gate G8 is closed: no frame is produced, so there is nothing to recover",
    });
  }

  if (historyAction === MSM_HISTORY_ACTION.REPROJECT || historyAction === MSM_HISTORY_ACTION.NONE) {
    return Object.freeze({
      state: MSM_DISOCCLUSION_STATE.NONE,
      historyConfidence: 1,
      recoveryFrames: 0,
      alphaOverride: MSM_NO_ALPHA_OVERRIDE,
      reason: "the history survives this event, so the per pixel confidence of MSM-F26 decides alone",
    });
  }

  return Object.freeze({
    state: MSM_DISOCCLUSION_STATE.REFUSED,
    historyConfidence: 1,
    recoveryFrames: 0,
    alphaOverride: MSM_NO_ALPHA_OVERRIDE,
    reason: `unknown history action "${String(historyAction)}" - this phase refuses to guess an invalidation it does not own`,
  });
}
