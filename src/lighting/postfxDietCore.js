export const DIET_BLOOM_START_DIV = 8;                                    
export const DIET_BLOOM_MAX_MIPS = 1;                                    
export const DIET_DITHER_AMP = 1 / 255;                                        


export const FULL_BLOOM_MIPS = 6;

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clamp(v, min, max, def) {
  const n = num(v, def);
  return n < min ? min : n > max ? max : n;
}


export const DIET_SUN_RAYS_RES_DIV = 2;


export function postfxDietPlan(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const weak = src.weakGpu === true;
  const photo = src.photoMode === true;
  const active = weak;
  const full = !active || photo;                                             
  return Object.freeze({
    weakGpu: weak,
    photo,
    active,
    fuseFinal: active,
    bloomStartDiv: full ? 2 : DIET_BLOOM_START_DIV,
    bloomMaxMips: full ? FULL_BLOOM_MIPS : DIET_BLOOM_MAX_MIPS,
    dropDof: active && !photo,


    sunRaysResolutionDivider: full ? 1 : DIET_SUN_RAYS_RES_DIV,
    ditherAmp: full ? 0 : DIET_DITHER_AMP,
  });
}


export function bloomDietMips(mipCount, maxMips) {
  const c = Math.max(1, Math.floor(num(mipCount, 1)));
  const m = Math.max(1, Math.floor(num(maxMips, 1)));
  return Math.min(c, m);
}


export function bloomFirstLevel(w, h, startDiv) {
  const d = Math.max(1, Math.floor(num(startDiv, 2)));
  return {
    w: Math.max(1, Math.floor(Math.max(1, num(w, 1)) / d)),
    h: Math.max(1, Math.floor(Math.max(1, num(h, 1)) / d)),
  };
}


export function fuseTrailingCcIndex(classNames, fuseEnabled) {
  if (fuseEnabled !== true || !Array.isArray(classNames) || classNames.length === 0) return -1;
  const last = classNames.length - 1;
  return classNames[last] === "ColorCorrectionEffect" ? last : -1;
}


export function sanitizeCcParams(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const tint = src.tint && typeof src.tint === "object" ? src.tint : null;
  return {
    brightness: clamp(src.brightness, -1, 1, 0),
    contrast: clamp(src.contrast, -1, 1, 0),
    saturation: clamp(src.saturation, -1, 1, 0),


    tint: {
      r: tint != null ? num(tint.r, 1) : 1,
      g: tint != null ? num(tint.g, 1) : 1,
      b: tint != null ? num(tint.b, 1) : 1,
    },
  };
}


export function ccTransform(rgb, raw, clampMax) {
  const p = sanitizeCcParams(raw);
  const capN = Number(clampMax);
  const cap = Number.isFinite(capN) && capN > 0 ? capN : 4;
  const src = Array.isArray(rgb) ? rgb : [0, 0, 0];
  let r = num(src[0], 0) + p.brightness;
  let g = num(src[1], 0) + p.brightness;
  let b = num(src[2], 0) + p.brightness;
  const k = 1 + p.contrast;
  r = (r - 0.5) * k + 0.5;
  g = (g - 0.5) * k + 0.5;
  b = (b - 0.5) * k + 0.5;
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const s = 1 + p.saturation;
  r = l + (r - l) * s;
  g = l + (g - l) * s;
  b = l + (b - l) * s;
  r *= p.tint.r;
  g *= p.tint.g;
  b *= p.tint.b;
  return [
    r < 0 ? 0 : r > cap ? cap : r,
    g < 0 ? 0 : g > cap ? cap : g,
    b < 0 ? 0 : b > cap ? cap : b,
  ];
}


export function bloomDitherMask(r, g, b) {
  const rr = num(r, 0);
  const gg = num(g, 0);
  const bb = num(b, 0);
  const sum = (rr > 0 ? rr : 0) + (gg > 0 ? gg : 0) + (bb > 0 ? bb : 0);
  const m = sum * 255;
  return m < 0 ? 0 : m > 1 ? 1 : m;
}


export function ditherAmpFor(intensity, base) {
  const b = num(base, 0);
  if (!(b > 0)) return 0;
  return b * clamp(intensity, 1, 4, 1);
}
