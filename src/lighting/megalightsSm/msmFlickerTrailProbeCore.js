import { MSM_FLICKER_MINIMUM_HISTORY_FRAMES, MSM_FLICKER_PHASE_ID } from "./msmFlickerPolicyCore.js";

export const MSM_FLICKER_TRAIL_PHASE_ID = MSM_FLICKER_PHASE_ID;


export const MSM_FLICKER_SCENE_4_HERTZ = 4;


export const MSM_FLICKER_PROBE_FRAME_RATES = Object.freeze([25, 30, 35]);


export const MSM_FLICKER_WORST_CASE_DARK_FRAMES = 3;


export const MSM_FLICKER_TRAIL_ENVELOPE = 0.125;


export const MSM_FLICKER_PROBE_WARMUP_PERIODS = 1;

export const MSM_FLICKER_TRAIL_VERDICT = Object.freeze({
  PASS: "pass",
  REFUSED: "refused",
});

export const MSM_FLICKER_TRAIL_REFUSAL = Object.freeze({
  INVALID_SCHEDULE: "invalid-schedule",
  INVALID_HISTORY_LENGTH: "invalid-history-length",
  NOT_ENOUGH_DARK_FRAMES: "not-enough-dark-frames",
  NO_MEASURABLE_DARK_RUN: "no-measurable-dark-run",
  TRAIL_ABOVE_ENVELOPE: "trail-above-envelope",
});

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumberOr(value, fallback) {
  const parsed = numberOr(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function positiveIntegerOr(value, fallback) {
  const parsed = Math.floor(numberOr(value, fallback));
  return parsed >= 1 ? parsed : fallback;
}

function nonNegativeIntegerOr(value, fallback) {
  const parsed = Math.floor(numberOr(value, fallback));
  return parsed >= 0 ? parsed : fallback;
}


export function msmHistoryAlphaForFrames(historyFrames) {
  const frames = Math.floor(numberOr(historyFrames, 0));
  return frames >= 1 ? 1 / frames : null;
}


export function buildMsmSquareWaveLuminance(options) {
  const settings = options || {};
  const hertz = positiveNumberOr(settings.hertz, MSM_FLICKER_SCENE_4_HERTZ);
  const framesPerSecond = positiveNumberOr(settings.framesPerSecond, 30);
  const peakLuminance = positiveNumberOr(settings.peakLuminance, 1);
  const seconds = positiveNumberOr(settings.seconds, 3);
  const frameCount = positiveIntegerOr(settings.frameCount, Math.round(framesPerSecond * seconds));
  const framesPerPeriod = framesPerSecond / hertz;
  const framesPerHalfPeriod = framesPerPeriod / 2;

  const luminanceByFrame = [];
  const litByFrame = [];
  for (let frameIndex = 0; frameCount > frameIndex; frameIndex++) {
    const isLit = Math.floor(frameIndex / framesPerHalfPeriod) % 2 === 0;
    litByFrame.push(isLit);
    luminanceByFrame.push(isLit ? peakLuminance : 0);
  }

  return Object.freeze({
    hertz,
    framesPerSecond,
    peakLuminance,
    frameCount,
    framesPerPeriod,
    framesPerHalfPeriod,
    luminanceByFrame: Object.freeze(luminanceByFrame),
    litByFrame: Object.freeze(litByFrame),
  });
}


export function buildMsmConstantLuminance(options) {
  const settings = options || {};
  const framesPerSecond = positiveNumberOr(settings.framesPerSecond, 30);
  const luminance = positiveNumberOr(settings.luminance, 1);
  const seconds = positiveNumberOr(settings.seconds, 3);
  const frameCount = positiveIntegerOr(settings.frameCount, Math.round(framesPerSecond * seconds));

  const luminanceByFrame = [];
  const litByFrame = [];
  for (let frameIndex = 0; frameCount > frameIndex; frameIndex++) {
    luminanceByFrame.push(luminance);
    litByFrame.push(true);
  }

  return Object.freeze({
    hertz: 0,
    framesPerSecond,
    peakLuminance: luminance,
    frameCount,
    framesPerPeriod: frameCount,
    framesPerHalfPeriod: frameCount,
    luminanceByFrame: Object.freeze(luminanceByFrame),
    litByFrame: Object.freeze(litByFrame),
  });
}


export function simulateMsmHistory(options) {
  const settings = options || {};
  const luminanceByFrame = Array.isArray(settings.luminanceByFrame) ? settings.luminanceByFrame : [];
  const historyFrames = Math.floor(numberOr(settings.historyFrames, 0));
  const alpha = msmHistoryAlphaForFrames(historyFrames);
  const historyByFrame = [];

  if (alpha === null) {
    return Object.freeze({ historyFrames, alpha: null, historyByFrame: Object.freeze(historyByFrame) });
  }

  let history = numberOr(settings.initialHistory, 0);
  for (let frameIndex = 0; luminanceByFrame.length > frameIndex; frameIndex++) {
    const sample = numberOr(luminanceByFrame[frameIndex], 0);
    history = history + alpha * (sample - history);
    historyByFrame.push(history);
  }

  return Object.freeze({ historyFrames, alpha, historyByFrame: Object.freeze(historyByFrame) });
}

function isUsableSchedule(schedule) {
  if (!schedule || typeof schedule !== "object") return false;
  if (!Array.isArray(schedule.luminanceByFrame) || !Array.isArray(schedule.litByFrame)) return false;
  if (schedule.luminanceByFrame.length !== schedule.litByFrame.length) return false;
  if (!(schedule.luminanceByFrame.length >= 1)) return false;
  return schedule.peakLuminance > 0;
}


function readClosedDarkRuns(litByFrame) {
  const darkRuns = [];
  let runStartFrame = -1;
  for (let frameIndex = 0; litByFrame.length > frameIndex; frameIndex++) {
    const isDark = litByFrame[frameIndex] !== true;
    if (isDark && runStartFrame < 0) runStartFrame = frameIndex;
    if (!isDark && runStartFrame >= 0) {
      darkRuns.push({ startFrame: runStartFrame, endFrame: frameIndex - 1 });
      runStartFrame = -1;
    }
  }
  return darkRuns;
}

function readPeakLitRatio(schedule, historyByFrame, warmupFrames) {
  let peakLitRatio = 0;
  for (let frameIndex = warmupFrames; schedule.litByFrame.length > frameIndex; frameIndex++) {
    if (schedule.litByFrame[frameIndex] !== true) continue;
    const litRatio = historyByFrame[frameIndex] / schedule.peakLuminance;
    if (litRatio > peakLitRatio) peakLitRatio = litRatio;
  }
  return peakLitRatio;
}

function measurementResult(fields) {
  return Object.freeze(
    Object.assign(
      {
        phase: MSM_FLICKER_TRAIL_PHASE_ID,
        historyFrames: 0,
        alpha: null,
        envelope: MSM_FLICKER_TRAIL_ENVELOPE,
        frameCount: 0,
        framesPerHalfPeriod: 0,
        warmupFrames: 0,
        measuredDarkRunCount: 0,
        minimumDarkRunFrames: 0,
        worstDarkTailRatio: null,
        worstDarkTailFrame: -1,
        peakLitRatio: null,
        meetsEnvelope: false,
        verdict: MSM_FLICKER_TRAIL_VERDICT.REFUSED,
        refusal: null,
        reason: "",
        historyByFrame: Object.freeze([]),
      },
      fields,
    ),
  );
}


export function measureMsmFlickerTrail(options) {
  const settings = options || {};
  const schedule = settings.schedule;
  const envelope = positiveNumberOr(settings.envelope, MSM_FLICKER_TRAIL_ENVELOPE);
  const historyFrames = Math.floor(numberOr(settings.historyFrames, 0));

  if (!isUsableSchedule(schedule)) {
    return measurementResult({
      historyFrames,
      envelope,
      refusal: MSM_FLICKER_TRAIL_REFUSAL.INVALID_SCHEDULE,
      reason: "the schedule needs luminanceByFrame and litByFrame with the same length and a peak above zero",
    });
  }

  if (MSM_FLICKER_MINIMUM_HISTORY_FRAMES > historyFrames) {
    return measurementResult({
      historyFrames,
      envelope,
      frameCount: schedule.frameCount,
      framesPerHalfPeriod: schedule.framesPerHalfPeriod,
      refusal: MSM_FLICKER_TRAIL_REFUSAL.INVALID_HISTORY_LENGTH,
      reason:
        "a history of " +
        historyFrames +
        " frame(s) is not a temporal filter - the policy floor is " +
        MSM_FLICKER_MINIMUM_HISTORY_FRAMES +
        " frames, and a trail of zero bought with zero filtering is sample noise on screen",
    });
  }

  const simulation = simulateMsmHistory({ luminanceByFrame: schedule.luminanceByFrame, historyFrames });
  const warmupPeriods = nonNegativeIntegerOr(settings.warmupPeriods, MSM_FLICKER_PROBE_WARMUP_PERIODS);
  const warmupFrames = Math.ceil(warmupPeriods * schedule.framesPerPeriod);
  const darkRuns = readClosedDarkRuns(schedule.litByFrame).filter((darkRun) => darkRun.startFrame >= warmupFrames);

  const sharedFields = {
    historyFrames,
    alpha: simulation.alpha,
    envelope,
    frameCount: schedule.frameCount,
    framesPerHalfPeriod: schedule.framesPerHalfPeriod,
    warmupFrames,
    peakLitRatio: readPeakLitRatio(schedule, simulation.historyByFrame, warmupFrames),
    historyByFrame: simulation.historyByFrame,
  };

  if (darkRuns.length === 0) {
    return measurementResult(
      Object.assign({}, sharedFields, {
        refusal: MSM_FLICKER_TRAIL_REFUSAL.NO_MEASURABLE_DARK_RUN,
        reason: "the schedule has no dark half period that both starts after the warm up and closes before the end",
      }),
    );
  }

  let worstDarkTailRatio = 0;
  let worstDarkTailFrame = -1;
  let minimumDarkRunFrames = Number.POSITIVE_INFINITY;

  darkRuns.forEach((darkRun) => {
    const darkRunFrames = darkRun.endFrame - darkRun.startFrame + 1;
    if (minimumDarkRunFrames > darkRunFrames) minimumDarkRunFrames = darkRunFrames;
    const tailRatio = simulation.historyByFrame[darkRun.endFrame] / schedule.peakLuminance;
    if (tailRatio > worstDarkTailRatio) {
      worstDarkTailRatio = tailRatio;
      worstDarkTailFrame = darkRun.endFrame;
    }
  });

  const measuredFields = Object.assign({}, sharedFields, {
    measuredDarkRunCount: darkRuns.length,
    minimumDarkRunFrames,
    worstDarkTailRatio,
    worstDarkTailFrame,
  });

  if (MSM_FLICKER_WORST_CASE_DARK_FRAMES > minimumDarkRunFrames) {
    return measurementResult(
      Object.assign({}, measuredFields, {
        refusal: MSM_FLICKER_TRAIL_REFUSAL.NOT_ENOUGH_DARK_FRAMES,
        reason:
          "the dark half period is only " +
          minimumDarkRunFrames +
          " frame(s) long at " +
          schedule.framesPerSecond +
          " fps - below the " +
          MSM_FLICKER_WORST_CASE_DARK_FRAMES +
          " frames of the worst supported case no history length can hold the envelope",
      }),
    );
  }

  const meetsEnvelope = envelope >= worstDarkTailRatio;
  return measurementResult(
    Object.assign({}, measuredFields, {
      meetsEnvelope,
      verdict: meetsEnvelope ? MSM_FLICKER_TRAIL_VERDICT.PASS : MSM_FLICKER_TRAIL_VERDICT.REFUSED,
      refusal: meetsEnvelope ? null : MSM_FLICKER_TRAIL_REFUSAL.TRAIL_ABOVE_ENVELOPE,
      reason:
        "at the end of the dark half period " +
        (worstDarkTailRatio * 100).toFixed(2) +
        "% of the light is still on screen, against an envelope of " +
        (envelope * 100).toFixed(2) +
        "%",
    }),
  );
}




export function runMsmFlickerTrailProbe(options) {
  const settings = options || {};
  const schedule = buildMsmSquareWaveLuminance(settings);
  const measurement = measureMsmFlickerTrail({
    schedule,
    historyFrames: settings.historyFrames,
    envelope: settings.envelope,
    warmupPeriods: settings.warmupPeriods,
  });
  return Object.freeze(
    Object.assign({ hertz: schedule.hertz, framesPerSecond: schedule.framesPerSecond }, measurement),
  );
}
