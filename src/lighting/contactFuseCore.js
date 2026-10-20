import {
  CS_DISTANCE_RANGE,
  CS_MAX_STEPS,
  CS_STEP_POW,
  sanitizeAoSettings,
} from "./aoCore.js";


export const CF_WEAK_STEPS_MIN = 4;
export const CF_WEAK_STEPS_MAX = 6;

export const CF_LOCAL_NEAR_EPS = 0.05;


export const CF_LOCAL_MIN_WEIGHT = 1e-3;


export const CF_CONE_EDGE = 0.05;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}


export function fusedContactSteps(weak, tierSteps) {
  if (weak) {
    const n = Math.round(num(tierSteps, CF_WEAK_STEPS_MAX));
    return clamp(n, CF_WEAK_STEPS_MIN, CF_WEAK_STEPS_MAX);
  }
  return sanitizeAoSettings({ csSteps: tierSteps }).csSteps;
}


export function sanitizeContactFuse(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    steps: clamp(Math.round(num(src.steps, CF_WEAK_STEPS_MAX)), CF_WEAK_STEPS_MIN, CF_WEAK_STEPS_MAX),
    distance: clamp(num(src.distance, 2), CS_DISTANCE_RANGE[0], CS_DISTANCE_RANGE[1]),
    minWeight: Math.max(num(src.minWeight, CF_LOCAL_MIN_WEIGHT), 0),
  };
}


export function contactLightLum(r, g, b, intensity) {
  const i = Math.max(num(intensity, 0), 0);
  if (i <= 0) return 0;
  const lr = Math.max(num(r, 0), 0);
  const lg = Math.max(num(g, 0), 0);
  const lb = Math.max(num(b, 0), 0);
  return i * (0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
}


export function contactLightWeight(dist2, range, lum) {
  const r = num(range, 0);
  if (!(r > CF_LOCAL_NEAR_EPS)) return 0;
  const l = Math.max(num(lum, 0), 0);
  if (l <= 0) return 0;
  const d2 = Math.max(num(dist2, 0), 0.01);
  const q2 = d2 / (r * r);
  const win = 1 - q2 * q2;
  if (win <= 0) return 0;
  return (l * win * win) / d2;
}


export function contactConeFactor(cosTo, cosHalf) {
  const c = num(cosHalf, -1);

  if (!(c > -1)) return 1;
  const x = num(cosTo, -1);

  const t = clamp((x - (c - CF_CONE_EDGE)) / CF_CONE_EDGE, 0, 1);
  return t * t * (3 - 2 * t);              
}


export function localMarchMaxT(distToLight, distance) {
  const d = num(distToLight, 0);
  const cap = clamp(num(distance, 2), CS_DISTANCE_RANGE[0], CS_DISTANCE_RANGE[1]);
  const t = Math.min(d - CF_LOCAL_NEAR_EPS, cap);
  return t > 0 ? t : 0;
}


export function localStepLengths(steps, maxT) {
  const cfg = sanitizeContactFuse({ steps });
  const t = Math.max(num(maxT, 0), 0);
  const out = [];
  for (let i = 0; i < cfg.steps; i++) {
    out.push(t * Math.pow((i + 0.5) / cfg.steps, CS_STEP_POW));
  }
  return out;
}


export function localAreaPenumbra(spread, distToLight) {
  const r = Math.max(num(spread, 0), 0);
  if (r <= 0) return 1;
  const d = Math.max(num(distToLight, 0), 1e-4);
  const q = Math.min(Math.max(r / (r + d), 0), 0.85);
  return 1 - q;
}
