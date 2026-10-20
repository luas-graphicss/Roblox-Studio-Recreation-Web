export const PLAY_QUALITY_MIN = 1;
export const PLAY_QUALITY_MAX = 10;


const DRAW_DISTANCE_LADDER = Object.freeze([
  400, 600, 850, 1150, 1500, 2000, 2700, 3600, 5000, Infinity,
]);


function qNorm(q) {
  const v = Number(q);
  if (!Number.isFinite(v)) return 0;
  return Math.min(PLAY_QUALITY_MAX, Math.max(0, Math.floor(v)));
}


export function resolutionScaleFor(q) {
  const v = qNorm(q);
  if (v < 1) return 1;
  return 0.5 + (v - 1) / 18;
}


export function shadowScaleFor(q) {
  const v = qNorm(q);
  if (v < 1) return 1;
  if (v === 1) return 0;
  return 0.25 + (0.75 * (v - 2)) / 8;
}


export function particleScaleFor(q) {
  const v = qNorm(q);
  if (v < 1) return 1;
  return 0.3 + (0.7 * (v - 1)) / 9;
}


export function drawDistanceFor(q) {
  const v = qNorm(q);
  if (v < 1) return Infinity;
  return DRAW_DISTANCE_LADDER[v - 1];
}


export const AUTO_START_LEVEL = PLAY_QUALITY_MAX;                   
export const AUTO_LOW_MS = 40;                                               
export const AUTO_HIGH_MS = 24;                                               
export const AUTO_DOWN_COOLDOWN_MS = 700;                               
export const AUTO_UP_COOLDOWN_MS = 2500;                                 
export const AUTO_SPIKE_MS = 250;                                          
export const AUTO_EMA_ALPHA = 0.12;
export const AUTO_WARMUP_SAMPLES = 20;                                     

function clampLevel(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(PLAY_QUALITY_MAX, Math.max(PLAY_QUALITY_MIN, Math.floor(n)));
}


export function createAutoQualityController(opts) {
  const initial = clampLevel(opts && opts.initial, AUTO_START_LEVEL);
  let level = initial;
  let ema = 0;
  let samples = 0;
  let lastChangeT = -Infinity;

  function reset(lvl) {
    level = clampLevel(lvl, initial);
    ema = 0;
    samples = 0;
    lastChangeT = -Infinity;
  }

  function sample(frameMs, nowMs) {
    const ms = Number(frameMs);
    const now = Number(nowMs);
    if (!Number.isFinite(ms) || !Number.isFinite(now) || ms <= 0) return 0;
    if (ms > AUTO_SPIKE_MS) return 0;
    ema = samples === 0 ? ms : ema + AUTO_EMA_ALPHA * (ms - ema);
    samples += 1;


    if (samples < AUTO_WARMUP_SAMPLES) return 0;
    const since = now - lastChangeT;
    if (ema > AUTO_LOW_MS && level > PLAY_QUALITY_MIN && since >= AUTO_DOWN_COOLDOWN_MS) {
      level -= 1;
      lastChangeT = now;
      ema = 0;
      samples = 0;
      return level;
    }
    if (ema < AUTO_HIGH_MS && level < PLAY_QUALITY_MAX && since >= AUTO_UP_COOLDOWN_MS) {
      level += 1;
      lastChangeT = now;
      ema = 0;
      samples = 0;
      return level;
    }
    return 0;
  }

  return { sample, reset, level: () => level };
}
