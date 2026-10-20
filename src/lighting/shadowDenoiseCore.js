function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}


export const FRAME_CYCLE = 64;
export const MAX_HISTORY_FRAMES = 12;

export const SUN_RESET_COS = 0.999985;

export function advanceFrame(frame) {
  const f = Math.floor(num(frame, 0));
  const wrapped = ((f % FRAME_CYCLE) + FRAME_CYCLE) % FRAME_CYCLE;
  return (wrapped + 1) % FRAME_CYCLE;
}

export function blendAlpha(framesAccumulated) {
  const n = Math.max(0, Math.floor(num(framesAccumulated, 0)));
  return 1 / Math.min(n + 1, MAX_HISTORY_FRAMES);
}


export function motionAlpha(alpha, velTexels) {
  const a = Math.min(Math.max(num(alpha, 1), 0), 1);
  const v = Math.max(0, num(velTexels, 0));
  return Math.max(a, Math.min(0.6, v * 0.3));
}

export function clampNeighborhood(value, lo, hi) {
  const l = num(lo, 0);
  const h = Math.max(num(hi, 1), l);
  const v = num(value, l);
  return v < l ? l : v > h ? h : v;
}


export function disocclusionValid(depth, prevDepth, tolerance) {
  const d = Number(depth);
  const p = Number(prevDepth);
  const tol = Math.max(num(tolerance, 0.02), 1e-6);
  if (!Number.isFinite(d) || !Number.isFinite(p)) return false;
  return Math.abs(d - p) <= tol * Math.max(Math.abs(d), 1e-4);
}

export function sunResetNeeded(dotPrevNew) {
  const d = Number(dotPrevNew);
  if (!Number.isFinite(d)) return true;
  return d < SUN_RESET_COS;
}


export function simulateAccumulation(samples, maxHistory) {
  const list = Array.isArray(samples) ? samples : [];
  const cap = Math.max(1, Math.floor(num(maxHistory, MAX_HISTORY_FRAMES)));
  const out = [];
  let est = 0;
  for (let i = 0; i < list.length; i++) {
    const s = num(list[i], 0);
    const a = 1 / Math.min(i + 1, cap);
    est = i === 0 ? s : est + (s - est) * a;
    out.push(est);
  }
  return out;
}


export const BYTE_HISTORY_RANGE = 4;

export function byteHistoryEncode(x) {
  const r = BYTE_HISTORY_RANGE;
  const v = Math.min(Math.max(num(x, 0), 0), r);
  return Math.sqrt(v / r);
}

export function byteHistoryDecode(y) {
  const v = Math.min(Math.max(num(y, 0), 0), 1);
  return v * v * BYTE_HISTORY_RANGE;
}


export function buildTemporalGlsl() {
  return [
    "uniform sampler2D tCurrent;",
    "uniform sampler2D tHistory;",
    "uniform sampler2D tDepth;",
    "uniform mat4 uInvViewProj;",
    "uniform mat4 uPrevViewProj;",
    "uniform vec2 uTexel;",
    "uniform float uAlpha;",
    "uniform float uHistoryValid;",


    "uniform float uByteEnc;",
    "uniform float uByteRange;",


    "uniform float uTemporalAlpha;",
    "varying vec2 vUv;",
    "float rswDnUnpackDepth(const in vec4 v) {",
    "  const vec4 f = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);",
    "  return dot(v, f);",
    "}",

    "vec3 rswDnDecode(const in vec3 h) {",
    "  return mix(h, h * h * uByteRange, uByteEnc);",
    "}",


    "vec4 rswDnOut(const in vec4 c) {",
    "  vec3 e = sqrt(clamp(c.rgb, vec3(0.0), vec3(uByteRange)) / uByteRange);",
    "  return vec4(mix(c.rgb, e, uByteEnc), c.a);",
    "}",
    "void main() {",
    "  vec4 cur = texture2D(tCurrent, vUv);",
    "  if (uHistoryValid < 0.5 || uAlpha >= 0.999) {",
    "    gl_FragColor = rswDnOut(cur);",
    "    return;",
    "  }",
    "  float d = rswDnUnpackDepth(texture2D(tDepth, vUv));",
    "  vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);",
    "  vec4 wp = uInvViewProj * ndc;",
    "  if (abs(wp.w) < 1e-8) {",
    "    gl_FragColor = rswDnOut(cur);",
    "    return;",
    "  }",
    "  vec4 pc = uPrevViewProj * vec4(wp.xyz / wp.w, 1.0);",
    "  if (pc.w <= 1e-6) {",
    "    gl_FragColor = rswDnOut(cur);",
    "    return;",
    "  }",
    "  vec2 prevUv = (pc.xy / pc.w) * 0.5 + 0.5;",
    "  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {",
    "    gl_FragColor = rswDnOut(cur);",
    "    return;",
    "  }",


    "  float rswVel = length((prevUv - vUv) / uTexel);",
    "  float rswA = max(uAlpha, min(0.6, rswVel * 0.3));",
    "  vec3 nMin = cur.rgb;",
    "  vec3 nMax = cur.rgb;",
    "  float aMin = cur.a;",
    "  float aMax = cur.a;",
    "  for (int dy = -1; dy <= 1; dy++) {",
    "    for (int dx = -1; dx <= 1; dx++) {",
    "      if (dx == 0 && dy == 0) continue;",
    "      vec4 s4 = texture2D(tCurrent, vUv + vec2(float(dx), float(dy)) * uTexel);",
    "      vec3 s = s4.rgb;",
    "      nMin = min(nMin, s);",
    "      nMax = max(nMax, s);",
    "      aMin = min(aMin, s4.a);",
    "      aMax = max(aMax, s4.a);",
    "    }",
    "  }",
    "  vec3 hist = clamp(rswDnDecode(texture2D(tHistory, prevUv).rgb), nMin, nMax);",


    "  float histA = clamp(texture2D(tHistory, prevUv).a, aMin, aMax);",
    "  float outA = mix(cur.a, mix(histA, cur.a, rswA), uTemporalAlpha);",
    "  gl_FragColor = rswDnOut(vec4(mix(hist, cur.rgb, rswA), outA));",
    "}",
  ].join("\n");
}
