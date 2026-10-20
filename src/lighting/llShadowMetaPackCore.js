export const SHADOW_META_MARKER = 65536;
export const SHADOW_META_SLOPE_STRIDE = 4096;
export const SHADOW_META_SLOPE_STEPS = 16;
export const SHADOW_META_SLOPE_QUANTUM = 0.5;
export const SHADOW_META_MAX_SLOPE_BIAS = (SHADOW_META_SLOPE_STEPS - 1) * SHADOW_META_SLOPE_QUANTUM;
export const SHADOW_META_SCALE_QUANTUM = 1 / 64;
export const SHADOW_META_MAX_SCALE = SHADOW_META_SLOPE_STRIDE - 1;


export const LEGACY_SHADOW_RADIUS = 1;

const EMPTY_META = Object.freeze({
  hasMeta: false,
  sourceTexelScale: 0,
  slopeBias: 0,
  slopeStep: 0,
});

function isFiniteNumber(value) {
  return typeof value === "number" && isFinite(value);
}


export function slopeBiasStepFor(slopeBias) {
  const value = Number(slopeBias);
  if (!isFiniteNumber(value) || value <= 0) return 0;
  const step = Math.round(value / SHADOW_META_SLOPE_QUANTUM);
  return Math.min(Math.max(step, 0), SHADOW_META_SLOPE_STEPS - 1);
}


export function quantizedSlopeBias(slopeBias) {
  return slopeBiasStepFor(slopeBias) * SHADOW_META_SLOPE_QUANTUM;
}


export function quantizedSourceTexelScale(sourceTexelScale) {
  const value = Number(sourceTexelScale);
  if (!isFiniteNumber(value) || value <= 0) return 0;
  const quantized = Math.round(value / SHADOW_META_SCALE_QUANTUM) * SHADOW_META_SCALE_QUANTUM;
  return Math.min(quantized, SHADOW_META_MAX_SCALE);
}


export function packLocalShadowMeta(meta) {
  const input = meta || {};
  const sourceTexelScale = quantizedSourceTexelScale(input.sourceTexelScale);
  if (!(sourceTexelScale > 0)) return LEGACY_SHADOW_RADIUS;
  const slopeStep = slopeBiasStepFor(input.slopeBias);
  return SHADOW_META_MARKER + slopeStep * SHADOW_META_SLOPE_STRIDE + sourceTexelScale;
}


export function unpackLocalShadowMeta(packed) {
  const value = Number(packed);
  if (!isFiniteNumber(value) || value < SHADOW_META_MARKER) return EMPTY_META;
  const rest = value - SHADOW_META_MARKER;
  const slopeStep = Math.floor(rest / SHADOW_META_SLOPE_STRIDE);
  const sourceTexelScale = rest - slopeStep * SHADOW_META_SLOPE_STRIDE;
  return Object.freeze({
    hasMeta: sourceTexelScale > 0,
    sourceTexelScale: sourceTexelScale,
    slopeBias: slopeStep * SHADOW_META_SLOPE_QUANTUM,
    slopeStep: slopeStep,
  });
}


export function hasLocalShadowMeta(packed) {
  return unpackLocalShadowMeta(packed).hasMeta;
}
