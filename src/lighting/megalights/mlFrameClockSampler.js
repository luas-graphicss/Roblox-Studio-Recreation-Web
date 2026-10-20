export const CLOCK_SAMPLE_REFUSAL = Object.freeze({
  none: "none",
  deterministicClock:
    "the bench is stepping frames by hand, so nowMs advances by a fixed step and says nothing about real cost",
  noPreviousFrame: "this is the first frame of the window: there is no interval yet",
  notEnoughSamples: "the window does not hold enough frames to report a stable mean yet",
  implausibleGap:
    "the gap between frames is too large to be work: the preview was hidden or throttled, so the window was reset",
  timeWentBackwards: "the timestamp did not advance, so the interval is not usable",
});

export const FRAME_CLOCK_SAMPLER_DEFAULTS = Object.freeze({
  windowFrameCount: 30,
  minimumSamplesBeforeReporting: 8,
  maximumPlausibleFrameMilliseconds: 250,
});

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function meanOf(values) {
  if (values.length === 0) return 0;
  let total = 0;
  for (let index = 0; index !== values.length; index += 1) total += values[index];
  return total / values.length;
}

function worstOf(values) {
  let worst = 0;
  for (let index = 0; index !== values.length; index += 1) {
    if (values[index] > worst) worst = values[index];
  }
  return worst;
}


export function createFrameClockSampler(options) {
  const settings = Object.assign({}, FRAME_CLOCK_SAMPLER_DEFAULTS, options || {});

  let intervals = [];
  let previousNowMs = null;
  let previousTier = null;
  let framesSinceChange = 0;
  let lastReport = null;

  function resetWindow(reason) {
    intervals = [];
    previousNowMs = null;
    framesSinceChange = 0;
    lastReport = null;
    return reason;
  }

  function reportFor(refusal, tier, frameMilliseconds) {
    const sampleCount = intervals.length;
    const hasEnough = sampleCount >= settings.minimumSamplesBeforeReporting;
    const admissible = refusal === CLOCK_SAMPLE_REFUSAL.none && hasEnough;
    const meanFrameMilliseconds = hasEnough ? meanOf(intervals) : null;
    lastReport = {
      tier,
      refusal: admissible ? CLOCK_SAMPLE_REFUSAL.none : refusal === CLOCK_SAMPLE_REFUSAL.none ? CLOCK_SAMPLE_REFUSAL.notEnoughSamples : refusal,
      measurementIsValid: admissible,
      frameMilliseconds: isNumber(frameMilliseconds) ? frameMilliseconds : null,
      meanFrameMilliseconds,
      worstFrameMilliseconds: sampleCount === 0 ? null : worstOf(intervals),
      framesPerSecond: admissible && meanFrameMilliseconds > 0 ? 1000 / meanFrameMilliseconds : null,
      sampleCount,
      framesSinceChange,
    };
    return lastReport;
  }

  return {


    sample(frameContext) {
      const context = frameContext || {};
      const tier = typeof context.tier === "string" ? context.tier : previousTier;


      if (previousTier !== null && tier !== previousTier) resetWindow("tier changed");
      previousTier = tier;
      framesSinceChange += 1;

      if (context.deterministic === true) {
        previousNowMs = isNumber(context.nowMs) ? context.nowMs : previousNowMs;
        return reportFor(CLOCK_SAMPLE_REFUSAL.deterministicClock, tier, null);
      }
      if (!isNumber(context.nowMs)) {
        return reportFor(CLOCK_SAMPLE_REFUSAL.noPreviousFrame, tier, null);
      }
      if (previousNowMs === null) {
        previousNowMs = context.nowMs;
        return reportFor(CLOCK_SAMPLE_REFUSAL.noPreviousFrame, tier, null);
      }

      const frameMilliseconds = context.nowMs - previousNowMs;
      previousNowMs = context.nowMs;

      if (!(frameMilliseconds > 0)) {
        return reportFor(CLOCK_SAMPLE_REFUSAL.timeWentBackwards, tier, frameMilliseconds);
      }
      if (frameMilliseconds > settings.maximumPlausibleFrameMilliseconds) {
        resetWindow("implausible gap");
        previousNowMs = context.nowMs;
        previousTier = tier;
        return reportFor(CLOCK_SAMPLE_REFUSAL.implausibleGap, tier, frameMilliseconds);
      }

      intervals.push(frameMilliseconds);
      if (intervals.length > settings.windowFrameCount) intervals.shift();
      return reportFor(CLOCK_SAMPLE_REFUSAL.none, tier, frameMilliseconds);
    },


    reset(reason) {
      resetWindow(reason || "explicit reset");
      return { reset: true, reason: reason || "explicit reset" };
    },


    read() {
      return lastReport;
    },

    settings,
  };
}
