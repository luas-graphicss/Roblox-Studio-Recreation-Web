import { MGL_DISOCCLUSION_FRAME_COUNT } from "./mlPipelineContract.js";

export const DISOCCLUSION_STATE = Object.freeze({

  disoccluded: "disoccluded",

  converging: "converging",

  converged: "converged",
});

export const DISOCCLUSION_POLICY_DEFAULTS = Object.freeze({

  baseSpatialSampleCount: 0,

  disoccludedSpatialSampleCount: 8,


  heldRelativeVariance: 1,
});

function clampToUnitRange(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function wholeCountOrDefault(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}


export function resolveDisocclusionPolicy(request) {
  const settings = request || {};
  const overrides = settings.policy || {};
  const baseSpatialSampleCount = wholeCountOrDefault(
    overrides.baseSpatialSampleCount,
    DISOCCLUSION_POLICY_DEFAULTS.baseSpatialSampleCount,
  );
  const disoccludedSpatialSampleCount = wholeCountOrDefault(
    overrides.disoccludedSpatialSampleCount,
    DISOCCLUSION_POLICY_DEFAULTS.disoccludedSpatialSampleCount,
  );

  const rawFrames = Number(settings.framesOfHistory);
  const framesOfHistory =
    settings.historyRejected === true || !Number.isFinite(rawFrames)
      ? 0
      : Math.max(0, Math.floor(rawFrames));

  const handlingStrength = clampToUnitRange(1 - framesOfHistory / MGL_DISOCCLUSION_FRAME_COUNT);
  const windowIsFull = framesOfHistory >= MGL_DISOCCLUSION_FRAME_COUNT;

  let state = DISOCCLUSION_STATE.converged;
  if (framesOfHistory === 0) state = DISOCCLUSION_STATE.disoccluded;
  else if (!windowIsFull) state = DISOCCLUSION_STATE.converging;

  const extraSpatialSamples = Math.round(
    (disoccludedSpatialSampleCount - baseSpatialSampleCount) * handlingStrength,
  );

  return Object.freeze({
    state,
    framesOfHistory,
    disocclusionFrameCount: MGL_DISOCCLUSION_FRAME_COUNT,
    handlingStrength,
    spatialSampleCount: Math.max(baseSpatialSampleCount, baseSpatialSampleCount + extraSpatialSamples),

    accumulatesInTonemappedSpace: !windowIsFull,
    holdsVarianceConstant: !windowIsFull,
  });
}
