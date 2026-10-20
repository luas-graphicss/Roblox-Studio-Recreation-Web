import {
  FRAME_CYCLE,
  MAX_HISTORY_FRAMES,
  blendAlpha,
  motionAlpha,
  clampNeighborhood,
  disocclusionValid,
} from "./shadowDenoiseCore.js";

export {
  FRAME_CYCLE,
  MAX_HISTORY_FRAMES,
  blendAlpha,
  motionAlpha,
  clampNeighborhood,
  disocclusionValid,
};

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const DEFAULT_DEPTH_TOL = 0.02;
export const CONF_STEP = 1 / MAX_HISTORY_FRAMES;
export const UPSAMPLE_SCALES = [1, 2, 4];


export const RECONSTRUCT_PASS_FETCHES = 12;                                         
export const DEPTH_COPY_FETCHES = 1;
export const UPSAMPLE_FETCHES = 9;                       

export function validateScale(scale) {
  const s = Math.floor(num(scale, 2));
  return UPSAMPLE_SCALES.indexOf(s) !== -1 ? s : 2;
}


export function mat4MulVec4(m, v) {
  const e = m && m.elements ? m.elements : m;
  if (!e || e.length !== 16 || !v || v.length !== 4) return null;
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    out[r] = e[r] * v[0] + e[4 + r] * v[1] + e[8 + r] * v[2] + e[12 + r] * v[3];
    if (!Number.isFinite(out[r])) return null;
  }
  return out;
}


export function reprojectUvJs({ uv, depth, invViewProj, prevViewProj }) {
  if (!uv || uv.length !== 2) return { valid: false, uv: null };
  const d = num(depth, NaN);
  if (!Number.isFinite(d)) return { valid: false, uv: null };
  const ndc = [uv[0] * 2 - 1, uv[1] * 2 - 1, d * 2 - 1, 1];
  const wp = mat4MulVec4(invViewProj, ndc);
  if (!wp || Math.abs(wp[3]) < 1e-8) return { valid: false, uv: null };
  const pc = mat4MulVec4(prevViewProj, [wp[0] / wp[3], wp[1] / wp[3], wp[2] / wp[3], 1]);
  if (!pc || pc[3] <= 1e-6) return { valid: false, uv: null };
  const px = (pc[0] / pc[3]) * 0.5 + 0.5;
  const py = (pc[1] / pc[3]) * 0.5 + 0.5;


  const pz = Math.min(Math.max((pc[2] / pc[3]) * 0.5 + 0.5, 0), 1);
  if (px < 0 || px > 1 || py < 0 || py > 1) {
    return { valid: false, uv: [px, py], offscreen: true, prevDepth: pz };
  }
  return { valid: true, uv: [px, py], prevDepth: pz };
}


export function confidenceAdvance(confidence) {
  const c = Math.min(Math.max(num(confidence, 0), 0), 1);
  return Math.min(1, c + CONF_STEP);
}


export function confidenceAlpha(confidence) {
  const c = Math.min(Math.max(num(confidence, 0), 0), 1);
  return 1 / (1 + c * (MAX_HISTORY_FRAMES - 1));
}


export function disocclusionDecay({ confidence, valid }) {
  return valid ? confidenceAdvance(confidence) : 0;
}


export function pixelAlpha({ confidence, velTexels, alphaFloor }) {
  const base = confidenceAlpha(confidence);
  const withMotion = motionAlpha(base, velTexels);
  const floor = Math.min(Math.max(num(alphaFloor, 0), 0), 1);
  return Math.max(withMotion, floor);
}


export function neighborhoodEnvelope(values) {
  const list = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
  if (!list.length) return { lo: 0, hi: 1 };
  let lo = list[0];
  let hi = list[0];
  for (const v of list) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
}


export function bilateralDepthWeight(depthCenter, depthSample, tolerance) {
  const dC = Number(depthCenter);
  const dS = Number(depthSample);
  if (!Number.isFinite(dC) || !Number.isFinite(dS)) return 0;
  const tol = Math.max(num(tolerance, DEFAULT_DEPTH_TOL), 1e-6);
  const scale = Math.max(tol * Math.max(Math.abs(dC), 1e-4), 1e-6);
  return Math.exp(-Math.abs(dC - dS) / scale);
}


export function bilateralNormalWeight(nCenter, nSample, power) {
  if (!nCenter || !nSample || nCenter.length !== 3 || nSample.length !== 3) return 0;
  let dot = 0;
  for (let i = 0; i < 3; i++) {
    const a = Number(nCenter[i]);
    const b = Number(nSample[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
  }
  const p = Math.max(num(power, 8), 0);
  return Math.pow(Math.max(dot, 0), p);
}


export function bilinearWeights(fx, fy) {
  const x = Math.min(Math.max(num(fx, 0), 0), 1);
  const y = Math.min(Math.max(num(fy, 0), 0), 1);
  return [(1 - x) * (1 - y), x * (1 - y), (1 - x) * y, x * y];
}


export function upsampleBilateralJs({ u, v, lowW, lowH, maskAt, depthAt, depthCenter, tolerance }) {
  const w = Math.max(1, Math.floor(num(lowW, 1)));
  const h = Math.max(1, Math.floor(num(lowH, 1)));
  if (typeof maskAt !== "function" || typeof depthAt !== "function") return 0;
  const px = num(u, 0) * w - 0.5;
  const py = num(v, 0) * h - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const wb = bilinearWeights(px - x0, py - y0);
  const dC = num(depthCenter, NaN);
  const offs = [[0, 0], [1, 0], [0, 1], [1, 1]];
  let acc = 0;
  let wSum = 0;
  let best = 0;
  let bestW = -1;
  for (let k = 0; k < 4; k++) {
    const xi = Math.min(Math.max(x0 + offs[k][0], 0), w - 1);
    const yi = Math.min(Math.max(y0 + offs[k][1], 0), h - 1);
    const wd = Number.isFinite(dC) ? bilateralDepthWeight(dC, depthAt(xi, yi), tolerance) : 1;
    const wgt = wb[k] * wd;
    const m = num(maskAt(xi, yi), 0);
    acc += m * wgt;
    wSum += wgt;
    if (wgt > bestW) {
      bestW = wgt;
      best = m;
    }
  }
  return wSum > 1e-5 ? acc / wSum : best;
}


export function buildReconstructGlsl() {
  const confStep = CONF_STEP.toFixed(8);
  const histScale = (MAX_HISTORY_FRAMES - 1).toFixed(1);
  return [
    "uniform sampler2D tCurrent;",
    "uniform sampler2D tHistory;",
    "uniform sampler2D tDepth;",
    "uniform sampler2D tPrevDepth;",
    "uniform mat4 uInvViewProj;",
    "uniform mat4 uPrevViewProj;",
    "uniform vec2 uTexel;",
    "uniform float uAlpha;",
    "uniform float uHistoryValid;",
    "uniform float uDepthTol;",
    "varying vec2 vUv;",
    "float rswRcUnpackDepth(const in vec4 v) {",
    "  const vec4 f = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);",
    "  return dot(v, f);",
    "}",
    "void main() {",
    "  vec4 cur = texture2D(tCurrent, vUv);",
    "  if (uHistoryValid < 0.5 || uAlpha >= 0.999) {",
    "    gl_FragColor = vec4(cur.rgb, " + confStep + ");",
    "    return;",
    "  }",
    "  float d = rswRcUnpackDepth(texture2D(tDepth, vUv));",
    "  vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);",
    "  vec4 wp = uInvViewProj * ndc;",
    "  if (abs(wp.w) < 1e-8) {",
    "    gl_FragColor = vec4(cur.rgb, " + confStep + ");",
    "    return;",
    "  }",
    "  vec4 pc = uPrevViewProj * vec4(wp.xyz / wp.w, 1.0);",
    "  if (pc.w <= 1e-6) {",
    "    gl_FragColor = vec4(cur.rgb, " + confStep + ");",
    "    return;",
    "  }",
    "  vec2 prevUv = (pc.xy / pc.w) * 0.5 + 0.5;",
    "  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {",
    "    gl_FragColor = vec4(cur.rgb, " + confStep + ");",
    "    return;",
    "  }",


    "  float prevZ = clamp((pc.z / pc.w) * 0.5 + 0.5, 0.0, 1.0);",
    "  float pd = rswRcUnpackDepth(texture2D(tPrevDepth, prevUv));",
    "  float rswOcc = step(uDepthTol * max(abs(prevZ), 1e-4), abs(prevZ - pd));",
    "  vec4 hist4 = texture2D(tHistory, prevUv);",
    "  float conf = hist4.a * (1.0 - rswOcc);",
    "  float aConf = 1.0 / (1.0 + conf * " + histScale + ");",

    "  float rswVel = length((prevUv - vUv) / uTexel);",
    "  float rswA = max(max(aConf, min(0.6, rswVel * 0.3)), uAlpha);",
    "  vec3 nMin = cur.rgb;",
    "  vec3 nMax = cur.rgb;",
    "  for (int dy = -1; dy <= 1; dy++) {",
    "    for (int dx = -1; dx <= 1; dx++) {",
    "      if (dx == 0 && dy == 0) continue;",
    "      vec3 s = texture2D(tCurrent, vUv + vec2(float(dx), float(dy)) * uTexel).rgb;",
    "      nMin = min(nMin, s);",
    "      nMax = max(nMax, s);",
    "    }",
    "  }",
    "  vec3 hist = clamp(hist4.rgb, nMin, nMax);",
    "  float confOut = clamp(conf + " + confStep + ", " + confStep + ", 1.0);",
    "  gl_FragColor = vec4(mix(hist, cur.rgb, rswA), confOut);",
    "}",
  ].join("\n");
}


export function buildUpsampleGlsl() {
  return [
    "uniform sampler2D tMask;",
    "uniform sampler2D tDepth;",
    "uniform vec2 uTexelLow;",
    "uniform float uDepthTol;",
    "varying vec2 vUv;",
    "float rswRcUnpackDepth(const in vec4 v) {",
    "  const vec4 f = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);",
    "  return dot(v, f);",
    "}",
    "void main() {",
    "  float dC = rswRcUnpackDepth(texture2D(tDepth, vUv));",
    "  vec2 pos = vUv / uTexelLow - 0.5;",
    "  vec2 base = floor(pos);",
    "  vec2 f = clamp(pos - base, 0.0, 1.0);",
    "  vec4 acc = vec4(0.0);",
    "  float wSum = 0.0;",
    "  vec4 best = vec4(0.0);",
    "  float bestW = -1.0;",
    "  for (int j = 0; j <= 1; j++) {",
    "    for (int i = 0; i <= 1; i++) {",
    "      vec2 tuv = (base + vec2(float(i), float(j)) + 0.5) * uTexelLow;",
    "      tuv = clamp(tuv, uTexelLow * 0.5, vec2(1.0) - uTexelLow * 0.5);",
    "      float wb = (i == 1 ? f.x : 1.0 - f.x) * (j == 1 ? f.y : 1.0 - f.y);",
    "      float dS = rswRcUnpackDepth(texture2D(tDepth, tuv));",
    "      float wd = exp(-abs(dC - dS) / max(uDepthTol * max(abs(dC), 1e-4), 1e-6));",
    "      float w = wb * wd;",
    "      vec4 m = texture2D(tMask, tuv);",
    "      acc += m * w;",
    "      wSum += w;",
    "      if (w > bestW) { bestW = w; best = m; }",
    "    }",
    "  }",
    "  gl_FragColor = wSum > 1e-5 ? acc / wSum : best;",
    "}",
  ].join("\n");
}
