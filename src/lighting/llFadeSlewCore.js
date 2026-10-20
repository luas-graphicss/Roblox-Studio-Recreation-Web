import { MAX_FADE_STEP_PER_PLAN } from "./llLightFadeContract.js";

export const FADE_DIRECTION = Object.freeze({
  NEW: "new",
  HOLD: "hold",
  UP: "up",
  DOWN: "down",
});

const MIN_STEP = 1e-6;


function hasPreviousFade(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value, fallback) {
  return Math.min(Math.max(finiteOr(value, fallback), 0), 1);
}

export function maxFadeStepOr(value) {
  return Math.min(Math.max(finiteOr(value, MAX_FADE_STEP_PER_PLAN), MIN_STEP), 1);
}



export function stepTowardsFade(input) {
  const request = asObject(input);
  const targetFade = clamp01(request.targetFade, 1);
  const maxStep = maxFadeStepOr(request.maxStep);
  if (!hasPreviousFade(request.previousFade)) {
    return Object.freeze({ fade: targetFade, targetFade, step: 0, direction: FADE_DIRECTION.NEW, reachedTarget: true });
  }
  const previousFade = clamp01(request.previousFade, targetFade);
  const delta = targetFade - previousFade;
  if (delta === 0) {
    return Object.freeze({ fade: previousFade, targetFade, step: 0, direction: FADE_DIRECTION.HOLD, reachedTarget: true });
  }
  const step = Math.min(Math.abs(delta), maxStep);
  const fade = clamp01(previousFade + (delta > 0 ? step : -step), targetFade);
  return Object.freeze({
    fade,
    targetFade,
    step,
    direction: delta > 0 ? FADE_DIRECTION.UP : FADE_DIRECTION.DOWN,
    reachedTarget: fade === targetFade,
  });
}


export function plansToReachFade(fromFade, toFade, maxStep) {
  const from = clamp01(fromFade, 0);
  const to = clamp01(toFade, 0);
  const step = maxFadeStepOr(maxStep);
  return Math.ceil(Math.abs(to - from) / step);
}


export function simulateFadeRamp(input) {
  const request = asObject(input);
  const targets = Array.isArray(request.targets) ? request.targets : [];
  const maxStep = maxFadeStepOr(request.maxStep);
  const published = [];
  const steps = [];
  let previousFade = hasPreviousFade(request.previousFade) ? clamp01(request.previousFade, 0) : null;
  targets.forEach((target) => {
    const slew = stepTowardsFade({ previousFade, targetFade: target, maxStep });
    published.push(slew.fade);
    steps.push(slew.step);
    previousFade = slew.fade;
  });
  return Object.freeze({
    fades: published,
    steps,
    maxStep,
    largestStep: steps.reduce((largest, step) => Math.max(largest, step), 0),
    finalFade: previousFade === null ? null : previousFade,
  });
}
