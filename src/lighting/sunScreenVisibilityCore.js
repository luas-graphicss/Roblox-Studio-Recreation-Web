export const SUN_EDGE_FADE_START_NDC = 0.98;
export const SUN_EDGE_FADE_END_NDC = 1.35;


export const SUN_HORIZON_FADE_START_Y = -0.04;
export const SUN_HORIZON_FADE_END_Y = 0.02;


export const SUN_VISIBILITY_EPSILON = 0.001;

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampToUnitRange(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}


export function smoothStepBetween(value, edgeStart, edgeEnd) {
  const start = finiteOr(edgeStart, 0);
  const end = finiteOr(edgeEnd, 0);
  const current = finiteOr(value, start);
  if (!(end > start)) return current >= end ? 1 : 0;
  const t = clampToUnitRange((current - start) / (end - start));
  return t * t * (3 - 2 * t);
}


export function screenEdgeVisibility(ndcX, ndcY) {
  const distanceX = Math.abs(finiteOr(ndcX, SUN_EDGE_FADE_END_NDC));
  const distanceY = Math.abs(finiteOr(ndcY, SUN_EDGE_FADE_END_NDC));
  const distanceFromCenter = Math.max(distanceX, distanceY);
  return 1 - smoothStepBetween(distanceFromCenter, SUN_EDGE_FADE_START_NDC, SUN_EDGE_FADE_END_NDC);
}


export function horizonVisibility(sunDirectionY) {
  const elevation = finiteOr(sunDirectionY, SUN_HORIZON_FADE_START_Y);
  return smoothStepBetween(elevation, SUN_HORIZON_FADE_START_Y, SUN_HORIZON_FADE_END_Y);
}


export function computeSunScreenVisibility(input) {
  const source = input && typeof input === "object" ? input : {};


  if (finiteOr(source.cameraForwardDotSunDirection, -1) <= 0) return 0;
  if (finiteOr(source.ndcZ, 1) >= 1) return 0;
  const edgeFactor = screenEdgeVisibility(source.ndcX, source.ndcY);
  if (edgeFactor <= 0) return 0;
  return clampToUnitRange(edgeFactor * horizonVisibility(source.sunDirectionY));
}


export function isSunVisible(visibility) {
  return finiteOr(visibility, 0) > SUN_VISIBILITY_EPSILON;
}
