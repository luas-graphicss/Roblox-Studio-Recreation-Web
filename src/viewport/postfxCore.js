import { clampNumber } from "../utils/validate.js";

export const BLOOM_MIP_SLOTS = 6;
export const BLUR_TAP_SLOTS = 16;

export function sanitizeBloomParams(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    intensity: clampNumber(Number(src.intensity), 0, 10, 1),
    size: clampNumber(Number(src.size), 0, 56, 24),
    threshold: clampNumber(Number(src.threshold), 0, 8, 1),
  };
}

export function bloomKnee(threshold) {
  const t = clampNumber(Number(threshold), 0, 8, 1);
  const knee = Math.max(t * 0.5, 1e-4);
  return { threshold: t, curve: [t - knee, knee * 2, 0.25 / knee] };
}

export function bloomMipCount(size, w, h) {
  const s = clampNumber(Number(size), 0, 56, 24);
  const cw = clampNumber(Number(w), 1, 16384, 1);
  const ch = clampNumber(Number(h), 1, 16384, 1);
  const minDim = Math.max(8, Math.min(cw, ch));
  const byRes = Math.floor(Math.log2(minDim / 8)) + 1;
  const bySize = Math.ceil(Math.log2(Math.max(s, 4) / 4)) + 2;
  return Math.max(1, Math.min(BLOOM_MIP_SLOTS, bySize, byRes));
}

export function bloomLevelWeights(size, mips) {
  const s = clampNumber(Number(size), 0, 56, 24);
  const n = Math.max(1, Math.min(BLOOM_MIP_SLOTS, Math.floor(Number(mips)) || 1));
  const target = Math.min(n - 1, Math.max(0, Math.log2(Math.max(s, 1) / 4)));
  const weights = new Array(BLOOM_MIP_SLOTS).fill(0);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = i - target;
    const w = Math.exp(-(d * d) / 1.6);
    weights[i] = w;
    sum += w;
  }
  if (sum > 0) for (let i = 0; i < n; i++) weights[i] /= sum;
  return weights;
}

export function blurPlan(size) {
  const s = clampNumber(Number(size), 0, 56, 0);
  if (s < 0.5) return { enabled: false, scale: 1, sigma: 0, steps: 0 };
  const sigma = Math.max(s / 3, 0.6);
  let scale = 1;
  if (sigma > 16) scale = 0.125;
  else if (sigma > 8) scale = 0.25;
  else if (sigma > 4) scale = 0.5;
  const steps = Math.round(Math.log2(1 / scale));
  return { enabled: true, scale, sigma: Math.max(sigma * scale, 0.6), steps };
}

export function gaussianTaps(sigma, maxPairs = BLUR_TAP_SLOTS - 1) {
  const sg = Math.max(clampNumber(Number(sigma), 0, 64, 0.3), 0.3);
  const cap = Math.max(1, Math.min(BLUR_TAP_SLOTS - 1, Math.floor(Number(maxPairs)) || 1));
  const radius = Math.min(Math.ceil(sg * 3), cap * 2);
  const discrete = [];
  for (let k = 0; k <= radius; k++) discrete.push(Math.exp(-(k * k) / (2 * sg * sg)));
  const offsets = [0];
  const weights = [discrete[0]];
  for (let k = 1; k <= radius; k += 2) {
    const w1 = discrete[k];
    const w2 = k + 1 <= radius ? discrete[k + 1] : 0;
    const w = w1 + w2;
    if (w <= 1e-6) break;
    offsets.push((w1 * k + w2 * (k + 1)) / w);
    weights.push(w);
  }
  let total = weights[0];
  for (let i = 1; i < weights.length; i++) total += weights[i] * 2;
  const inv = total > 0 ? 1 / total : 0;
  return {
    count: offsets.length,
    offsets: padSlots(offsets),
    weights: padSlots(weights.map((w) => w * inv)),
  };
}

function padSlots(list) {
  const out = new Array(BLUR_TAP_SLOTS).fill(0);
  for (let i = 0; i < list.length && i < BLUR_TAP_SLOTS; i++) out[i] = list[i];
  return out;
}


export const DOF_LEVEL_SIGMA = 3;

export function sanitizeDofParams(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    farIntensity: clampNumber(Number(src.farIntensity), 0, 1, 0.75),
    focusDistance: clampNumber(Number(src.focusDistance), 0, 100000, 0.05),
    inFocusRadius: clampNumber(Number(src.inFocusRadius), 0, 100000, 10),
    nearIntensity: clampNumber(Number(src.nearIntensity), 0, 1, 0.75),
  };
}

export function dofBands(params) {
  const p = sanitizeDofParams(params);
  return {
    nearEdge: Math.max(p.focusDistance - p.inFocusRadius, 0),
    farEdge: p.focusDistance + p.inFocusRadius,
    nearIntensity: p.nearIntensity,
    farIntensity: p.farIntensity,
    active: p.nearIntensity > 0.001 || p.farIntensity > 0.001,
  };
}

export function dofCoc(distance, params) {
  const b = dofBands(params);
  const d = Math.max(Number(distance) || 0, 0);
  if (d < b.nearEdge) return -b.nearIntensity * Math.min((b.nearEdge - d) / Math.max(b.nearEdge, 1e-4), 1);
  if (d > b.farEdge) return b.farIntensity * Math.min((d - b.farEdge) / Math.max(d, 1e-4), 1);
  return 0;
}


export const SUNRAYS_TAPS = 48;

export function sanitizeSunRaysParams(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    intensity: clampNumber(Number(src.intensity), 0, 1, 0.25),
    spread: clampNumber(Number(src.spread), 0, 1, 1),
  };
}

export function sunRaysPlan(params) {
  const p = sanitizeSunRaysParams(params);
  return {
    active: p.intensity > 0.001,
    intensity: p.intensity,
    rayLength: 0.28 + 0.62 * p.spread,
    decay: 0.9 + 0.08 * p.spread,
    diskRadius: 0.06 + 0.05 * p.spread,
    diskSoftness: 0.6,
    energyScale: 4.5,
    stageOneScale: 0.35,
  };
}

export function sunRaysTapWeights(decay) {
  const d = clampNumber(Number(decay), 0.5, 0.99, 0.9);
  const weights = [];
  let sum = 0;
  let cur = 1;
  for (let i = 0; i < SUNRAYS_TAPS; i++) {
    weights.push(cur);
    sum += cur;
    cur *= d;
  }
  for (let i = 0; i < SUNRAYS_TAPS; i++) weights[i] /= sum;
  return weights;
}

export function sunRaysMaxTapSpacing(rayLength, dist) {
  const len = clampNumber(Number(rayLength), 0, 2, 0.9);
  const d = clampNumber(Number(dist), 0, 2, 1);
  return (len * d) / SUNRAYS_TAPS;
}

export function sunRaysMinTargetWidth(diskRadius, aspect, litFraction) {
  const r = clampNumber(Number(diskRadius), 0, 1, 0.1);
  const a = Math.max(Number(aspect) || 1, 1);
  const lit = clampNumber(Number(litFraction), 0, 1, 1);
  return (2 * r * lit) / a;
}


export function sunRaysSource(brightness, windowFalloff, core, sky) {
  const b = clampNumber(Number(brightness), 0, 1, 0);
  const w = clampNumber(Number(windowFalloff), 0, 1, 0);
  const c = clampNumber(Number(core), 0, 1, 0);
  const s = clampNumber(Number(sky), 0, 1, 0);
  return Math.max(b * w, c * 0.85) * s;
}


export const BLOOM_MODES = Object.freeze(["Classic", "Energy"]);
export const ENERGY_BLOOM_KNEE = 0.5;
export const ENERGY_BLOOM_SCATTER = 0.05;                                      
export const ENERGY_BLOOM_SCATTER_MAX = 0.2;
export const ENERGY_BLOOM_SIGMA2 = 4.6;                                      


export function resolveBloomMode(value) {
  return value === "Energy" ? 1 : 0;
}


export function energyBloomPlan(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const on = resolveBloomMode(src.mode) === 1;
  const intensity = clampNumber(Number(src.intensity), 0, 10, 1);
  return Object.freeze({
    on,
    knee: ENERGY_BLOOM_KNEE,
    scatter: on ? clampNumber(intensity * ENERGY_BLOOM_SCATTER, 0, ENERGY_BLOOM_SCATTER_MAX, 0) : 0,
    anamorphic: on ? clampNumber(Number(src.anamorphic), 1, 3, 1) : 1,
    dirt: on ? clampNumber(Number(src.dirt), 0, 1, 0) : 0,
  });
}


export function energyKneeWeight(brightness, knee) {
  const br = Math.max(Number(brightness) || 0, 0);
  const k = Math.max(Number(knee) || 0, 1e-4);
  return br / (br + k);
}


export function energyLevelWeights(size, mips) {
  const s = clampNumber(Number(size), 0, 56, 24);
  const n = Math.max(1, Math.min(BLOOM_MIP_SLOTS, Math.floor(Number(mips)) || 1));
  const target = Math.min(n - 1, Math.max(0, Math.log2(Math.max(s, 1) / 4)));
  const weights = new Array(BLOOM_MIP_SLOTS).fill(0);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = i - target;
    const w = Math.exp(-(d * d) / ENERGY_BLOOM_SIGMA2);
    weights[i] = w;
    sum += w;
  }
  if (sum > 0) for (let i = 0; i < n; i++) weights[i] /= sum;
  return weights;
}


export function energyCombine(base, bloomSum, scatter, dirtTerm) {
  const s = clampNumber(Number(scatter), 0, ENERGY_BLOOM_SCATTER_MAX, 0);
  const b = Math.max(Number(bloomSum) || 0, 0);
  const d = Math.max(Number(dirtTerm) || 0, 0);
  return (Number(base) || 0) * (1 - s) + b * (1 + d) * s;
}


export function dirtHash(x, y) {
  const t = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return t - Math.floor(t);
}

export function dirtValueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = dirtHash(ix, iy);
  const b = dirtHash(ix + 1, iy);
  const c = dirtHash(ix, iy + 1);
  const d = dirtHash(ix + 1, iy + 1);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}

export function dirtMask(u, v) {
  const n = 0.65 * dirtValueNoise(u * 11, v * 11) + 0.35 * dirtValueNoise(u * 29 + 17.3, v * 29 + 9.1);
  return clampNumber((n - 0.55) * 2.2, 0, 1, 0);
}
