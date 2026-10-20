export const SHARPEN_STRENGTH_MAX = 0.6;
export const SHARPEN_STRENGTH_DEFAULT = 0.4;


export const SHARPEN_PEAK_MAX = 0.2;

export const SHARPEN_SCALE_FULL = 0.999;

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}


export function sanitizeSharpenStrength(raw) {
  return clamp(num(raw, SHARPEN_STRENGTH_DEFAULT), 0, SHARPEN_STRENGTH_MAX);
}


export function casPeak(strength) {
  const p = (sanitizeSharpenStrength(strength) / SHARPEN_STRENGTH_MAX) * SHARPEN_PEAK_MAX;
  return p === 0 ? 0 : -p;
}


export function upscaleSharpenPlan(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const scale = clamp(num(src.scale, 1), 0.05, 1);
  const flag = src.flag === true ? true : src.flag === false ? false : null;
  const strength = sanitizeSharpenStrength(src.strength);
  const peak = casPeak(strength);
  const upscaled = scale < SHARPEN_SCALE_FULL;
  const wanted = flag === false ? false : flag === true ? true : src.weakGpu === true;
  const active = wanted && upscaled && peak < 0;
  return Object.freeze({
    active,
    scale,
    strength,
    peak: active ? peak : 0,
    auto: flag === null,
    flag,
  });
}


const ZERO3 = Object.freeze([0, 0, 0]);

function tap3(v) {
  return Array.isArray(v) ? v : ZERO3;
}


export function casLumaJs(rgb) {
  const v = tap3(rgb);
  return 0.299 * num(v[0], 0) + 0.587 * num(v[1], 0) + 0.114 * num(v[2], 0);
}


export function casAmpJs(lC, lN, lS, lE, lW) {
  const c = num(lC, 0);
  const n = num(lN, 0);
  const s = num(lS, 0);
  const e = num(lE, 0);
  const w = num(lW, 0);
  const mn = Math.min(c, Math.min(Math.min(n, s), Math.min(e, w)));
  const mx = Math.max(c, Math.max(Math.max(n, s), Math.max(e, w)));
  const r = Math.min(mn, 2 - mx) / Math.max(mx, 1e-4);
  return Math.sqrt(clamp(r, 0, 1));
}


export function casSharpenJs(center, n, s, e, w, peak) {
  const C = tap3(center);
  const N = tap3(n);
  const S = tap3(s);
  const E = tap3(e);
  const W = tap3(w);
  const amp = casAmpJs(casLumaJs(C), casLumaJs(N), casLumaJs(S), casLumaJs(E), casLumaJs(W));
  const wgt = amp * num(peak, 0);
  const den = 1 + 4 * wgt;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const cc = num(C[i], 0);
    const nn = num(N[i], 0);
    const ss = num(S[i], 0);
    const ee = num(E[i], 0);
    const ww = num(W[i], 0);
    const sharp = (cc + (nn + ss + ee + ww) * wgt) / den;
    const lo = Math.min(cc, Math.min(Math.min(nn, ss), Math.min(ee, ww)));
    const hi = Math.max(cc, Math.max(Math.max(nn, ss), Math.max(ee, ww)));
    out[i] = clamp(sharp, lo, hi);
  }
  return out;
}


export function buildCasGlsl() {
  return [
    "uniform sampler2D tDiffuse;",
    "uniform vec2 uTexel;",
    "uniform float uPeak;",
    "varying vec2 vUv;",
    "float rswLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }",
    "void main() {",
    "  vec4 t = texture2D(tDiffuse, vUv);",
    "  vec3 c = t.rgb;",
    "  vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;",
    "  vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;",
    "  vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;",
    "  vec3 w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;",
    "  float lC = rswLuma(c);",
    "  float lN = rswLuma(n);",
    "  float lS = rswLuma(s);",
    "  float lE = rswLuma(e);",
    "  float lW = rswLuma(w);",
    "  float mn = min(lC, min(min(lN, lS), min(lE, lW)));",
    "  float mx = max(lC, max(max(lN, lS), max(lE, lW)));",
    "  float amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0));",
    "  float wgt = amp * uPeak;",
    "  vec3 sharp = (c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt);",
    "  vec3 lo = min(c, min(min(n, s), min(e, w)));",
    "  vec3 hi = max(c, max(max(n, s), max(e, w)));",
    "  gl_FragColor = vec4(clamp(sharp, lo, hi), t.a);",
    "}",
  ].join("\n");
}
