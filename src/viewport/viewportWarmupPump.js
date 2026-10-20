export const DEFAULT_WARMUP_FRAMES = 4;


export const DEFAULT_WARMUP_DEADLINE_MS = 12000;


export const MAX_WARMUP_FRAMES = 24;


export const WARMUP_END_REASON = Object.freeze({
  WARM: "warm",
  DEADLINE_REACHED: "deadline-reached",
  FRAME_BUDGET_REACHED: "frame-budget-reached",
  ABORTED: "aborted",
  FRAME_REQUEST_FAILED: "frame-request-failed",
  MISSING_FRAME_REQUEST: "missing-frame-request",
});

function defaultNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}


function waitForNextPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 16);
      return;
    }
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}


function readBooleanProbe(probe, fallback) {
  if (typeof probe !== "function") return fallback;
  try {
    return probe() === true;
  } catch (_error) {
    return fallback;
  }
}

function clampFrameCount(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_WARMUP_FRAMES);
}

function clampDeadlineMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WARMUP_DEADLINE_MS;
  return Math.max(0, parsed);
}


export async function runViewportWarmup({
  requestFrame,
  isEngineWarmingUp,
  isAborted,
  waitForFrame = waitForNextPaint,
  frames = DEFAULT_WARMUP_FRAMES,
  maxFrames = MAX_WARMUP_FRAMES,
  deadlineMs = DEFAULT_WARMUP_DEADLINE_MS,
  now = defaultNow,
} = {}) {
  const startedAt = now();
  const report = (reason, framesDrawn) => ({
    reason,
    framesDrawn,
    warm: reason === WARMUP_END_REASON.WARM,
    elapsedMs: Math.max(0, now() - startedAt),
  });

  if (typeof requestFrame !== "function") {
    return report(WARMUP_END_REASON.MISSING_FRAME_REQUEST, 0);
  }

  const minFrames = clampFrameCount(frames, DEFAULT_WARMUP_FRAMES);
  const frameCeiling = Math.max(minFrames, clampFrameCount(maxFrames, MAX_WARMUP_FRAMES));
  const timeBudgetMs = clampDeadlineMs(deadlineMs);
  let framesDrawn = 0;

  for (;;) {
    if (readBooleanProbe(isAborted, false)) {
      return report(WARMUP_END_REASON.ABORTED, framesDrawn);
    }
    if (now() - startedAt >= timeBudgetMs) {
      return report(WARMUP_END_REASON.DEADLINE_REACHED, framesDrawn);
    }


    if (framesDrawn >= minFrames && !readBooleanProbe(isEngineWarmingUp, false)) {
      return report(WARMUP_END_REASON.WARM, framesDrawn);
    }
    if (framesDrawn >= frameCeiling) {
      return report(WARMUP_END_REASON.FRAME_BUDGET_REACHED, framesDrawn);
    }

    try {
      requestFrame();
      await waitForFrame();
    } catch (_error) {
      return report(WARMUP_END_REASON.FRAME_REQUEST_FAILED, framesDrawn);
    }
    framesDrawn += 1;
  }
}
