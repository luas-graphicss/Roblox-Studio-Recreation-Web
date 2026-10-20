import {
  MINIMUM_FADE_BAND_RATIO,
  MINIMUM_FADE_BAND_STUDS,
  SHADOW_FADE_IN_THRESHOLD,
  SHADOW_FADE_OUT_THRESHOLD,
} from "./llLightFadeContract.js";

export const FADE_FULLY_LIT = 1;
export const FADE_FULLY_FADED = 0;


export const NO_DISTANCE_CUT = 0;

const MIN_FADE_RANGE = 1e-6;

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveOr(value, fallback) {
  return Math.max(finiteOr(value, fallback === undefined ? 0 : fallback), 0);
}

export function clampFadeFactor(value) {
  return Math.min(Math.max(finiteOr(value, FADE_FULLY_LIT), FADE_FULLY_FADED), FADE_FULLY_LIT);
}


export function minimumFadeBandFor(maxDrawDistance) {
  const cutDistance = positiveOr(maxDrawDistance);
  if (!(cutDistance > 0)) return 0;
  return Math.min(Math.max(cutDistance * MINIMUM_FADE_BAND_RATIO, MINIMUM_FADE_BAND_STUDS), cutDistance);
}


export function resolveFadeBand(input) {
  const request = asObject(input);
  const maxDrawDistance = positiveOr(request.maxDrawDistance);
  if (!(maxDrawDistance > 0)) {
    return Object.freeze({
      cutsByDistance: false,
      maxDrawDistance: NO_DISTANCE_CUT,
      fadeRange: 0,
      minimumFadeBand: 0,
      fadeStartDistance: Infinity,
    });
  }
  const minimumFadeBand = minimumFadeBandFor(maxDrawDistance);
  const fadeRange = Math.min(Math.max(positiveOr(request.fadeRange), minimumFadeBand), maxDrawDistance);
  return Object.freeze({
    cutsByDistance: true,
    maxDrawDistance,
    fadeRange,
    minimumFadeBand,
    fadeStartDistance: maxDrawDistance - fadeRange,
  });
}


export function smoothFadeCurve(remainingBandRatio) {
  const ratio = Math.min(Math.max(finiteOr(remainingBandRatio, 0), 0), 1);
  return ratio * ratio * (3 - 2 * ratio);
}


export function distanceFadeFactor(input) {
  const request = asObject(input);
  const band = resolveFadeBand(request);
  if (!band.cutsByDistance) return FADE_FULLY_LIT;
  const distance = positiveOr(request.distance);
  if (distance >= band.maxDrawDistance) return FADE_FULLY_FADED;
  if (band.fadeStartDistance >= distance) return FADE_FULLY_LIT;
  const remainingBand = (band.maxDrawDistance - distance) / Math.max(band.fadeRange, MIN_FADE_RANGE);
  return smoothFadeCurve(remainingBand);
}


export function fadedIntensity(intensity, fadeFactor) {
  return positiveOr(intensity) * clampFadeFactor(fadeFactor);
}


export function shadowFadeVerdict(input) {
  const request = asObject(input);
  const fadeFactor = clampFadeFactor(request.fadeFactor);
  const wasCastingShadow = request.wasCastingShadow === true;
  const threshold = wasCastingShadow ? SHADOW_FADE_OUT_THRESHOLD : SHADOW_FADE_IN_THRESHOLD;
  return Object.freeze({
    castsShadow: fadeFactor >= threshold,
    threshold,
    fadeFactor,
    wasCastingShadow,
  });
}


export function distanceFadeTable(input) {
  const request = asObject(input);
  const band = resolveFadeBand(request);
  const distances = Array.isArray(request.distances) ? request.distances : [];
  return distances.map((rawDistance) => {
    const distance = positiveOr(rawDistance);
    const fadeFactor = distanceFadeFactor({
      distance,
      maxDrawDistance: request.maxDrawDistance,
      fadeRange: request.fadeRange,
    });
    return Object.freeze({
      distance,
      fadeFactor,
      castsShadow: shadowFadeVerdict({ fadeFactor, wasCastingShadow: true }).castsShadow,
      fadeStartDistance: band.fadeStartDistance,
      maxDrawDistance: band.maxDrawDistance,
      fadeRange: band.fadeRange,
    });
  });
}
