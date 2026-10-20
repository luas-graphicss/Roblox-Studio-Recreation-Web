import { PCSS_PLANE_BIAS_CAP } from "./pcssCore.js";


export const BIAS_NORMAL_FLOOR = 0.02;                              
export const BIAS_NORMAL_TEXELS_CLASSIC = 0.35;                   
export const BIAS_NORMAL_CAP_CLASSIC = 0.6;         


export const PLANE_BIAS_CAP_MAX = 0.008;

export const PLANE_BIAS_REF_MAP = 2048;

export const PLANE_BIAS_RES_RATIO_MAX = 4;


export const SHADOW_BIAS_TIERS = Object.freeze({
  micro: Object.freeze({ tier: "micro", normalTexels: 0.45, normalCap: 0.9, slopeCapK: 1.5 }),
  lite: Object.freeze({ tier: "lite", normalTexels: 0.42, normalCap: 0.8, slopeCapK: 1.3 }),
  low: Object.freeze({ tier: "low", normalTexels: 0.4, normalCap: 0.7, slopeCapK: 1.15 }),
  medium: Object.freeze({ tier: "medium", normalTexels: 0.35, normalCap: 0.6, slopeCapK: 1 }),
  high: Object.freeze({ tier: "high", normalTexels: 0.35, normalCap: 0.6, slopeCapK: 1 }),
  ultra: Object.freeze({ tier: "ultra", normalTexels: 0.35, normalCap: 0.6, slopeCapK: 1 }),
});


export const BIAS_PROFILE_NEUTRAL = Object.freeze({
  tier: "neutral",
  normalTexels: BIAS_NORMAL_TEXELS_CLASSIC,
  normalCap: BIAS_NORMAL_CAP_CLASSIC,
  slopeCapK: 1,
});

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}


export function biasProfileFor(tier) {
  const p = typeof tier === "string" ? SHADOW_BIAS_TIERS[tier] : null;
  return p || BIAS_PROFILE_NEUTRAL;
}


export function cascadeNormalBias(texel, profile) {
  const p = profile || BIAS_PROFILE_NEUTRAL;
  const t = Math.max(0, num(texel, 0));
  const scale = Math.min(1, Math.max(0.1, num(p.normalTexels, BIAS_NORMAL_TEXELS_CLASSIC)));
  const cap = Math.min(2, Math.max(BIAS_NORMAL_FLOOR, num(p.normalCap, BIAS_NORMAL_CAP_CLASSIC)));
  return Math.max(BIAS_NORMAL_FLOOR, Math.min(cap, t * scale));
}


export function planeBiasCapFor({ mapSize, tier } = {}) {
  const p = typeof tier === "string" ? SHADOW_BIAS_TIERS[tier] : null;
  if (!p) return PCSS_PLANE_BIAS_CAP;
  const px = num(mapSize, PLANE_BIAS_REF_MAP);
  const ratio = px >= 64 ? Math.min(PLANE_BIAS_RES_RATIO_MAX, Math.max(1, PLANE_BIAS_REF_MAP / px)) : 1;
  const k = Math.min(4, Math.max(0.5, num(p.slopeCapK, 1)));
  return Math.min(PLANE_BIAS_CAP_MAX, PCSS_PLANE_BIAS_CAP * k * ratio);
}
