export const SUN_MASK_VERSION = "sun-mask-f5";


export const SUN_MASK_RADIUS_MARKER = 4001;
export const SUN_MASK_SCALE = 0.5;                                   
export const SUN_MASK_MAX_CASCADES = 4;

export const SUN_MASK_TAP_CAP = 8;
export const SUN_MASK_MIN_TAPS = 4;
export const SUN_MASK_DEFAULT_TAPS = 6;                            
export const SUN_MASK_DEFAULT_BLOCKERS = 4;


export const SUN_MASK_MAX_SEARCH_UV = 0.05;
export const SUN_MASK_MAX_FILTER_UV = 0.033;

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}


export function maskDims(viewW, viewH, out, scale) {
  const w = clamp(Math.round(num(viewW, 1)), 1, 16384);
  const h = clamp(Math.round(num(viewH, 1)), 1, 16384);
  const s0 = num(scale, SUN_MASK_SCALE);
  const s = s0 > 0 && s0 <= 1 ? s0 : SUN_MASK_SCALE;
  const o = out && typeof out === "object" ? out : {};
  o.w = clamp(Math.round(w * s), 8, 4096);
  o.h = clamp(Math.round(h * s), 8, 4096);
  return o;
}


export function maskTaps(taps, blockers, out) {
  const t = Math.round(clamp(num(taps, SUN_MASK_DEFAULT_TAPS), SUN_MASK_MIN_TAPS, SUN_MASK_TAP_CAP));
  const b = Math.round(clamp(num(blockers, SUN_MASK_DEFAULT_BLOCKERS), 2, t));
  const o = out && typeof out === "object" ? out : {};
  o.taps = t;
  o.blockers = b;
  return o;
}


export function maskCapK(scales, scaleBase, out) {
  const base = Math.max(num(scaleBase, 1), 1e-4);
  const res = Array.isArray(out) ? out : [1, 1, 1, 1];
  const list = Array.isArray(scales) ? scales : [];
  for (let i = 0; i < 4; i++) {
    const s = num(list[i], base);
    res[i] = clamp((s > 0 ? s : base) / base, 1, 6);
  }
  return res;
}

export function isSunMaskRadius(radius) {
  const r = num(radius, 0);
  return r > 3999.5 && r < 4999.5;
}


export function shouldUseSunMask(args) {
  const a = args || {};
  return (
    a.supported === true &&
    a.pcssOn === true &&
    a.tech === "Future" &&
    a.rtOn !== true &&
    a.flagOn === true
  );
}


export function maskFullResDecision(args) {
  const a = args || {};
  if (a.flag === true) return true;
  if (a.flag === false) return false;
  if (a.photoFull === true) return true;
  if (a.weak !== true) return false;
  const was = a.wasFull === true;
  const now = num(a.nowMs, 0);
  const flip = num(a.lastFlipMs, 0);
  const hold = Math.max(0, num(a.holdMs, 3000));
  if (now - flip < hold) return was;
  const ema = num(a.costEmaMs, 0);
  if (!(ema > 0)) return was;
  const enter = Math.max(1, num(a.enterMs, 30));
  const exit = Math.max(enter, num(a.exitMs, 38));
  return was ? ema <= exit : ema <= enter;
}


export function sunMaskCascadeChoiceJs(args) {
  const a = args || {};
  const list = Array.isArray(a.edges) ? a.edges : [];
  const n = Math.round(clamp(num(a.count, list.length || 1), 1, SUN_MASK_MAX_CASCADES));
  const b = Math.max(num(a.blend, 0.08), 1e-4);
  for (let c = 0; c + 1 < n; c++) {
    const e = num(list[c], -1);
    if (e >= b) return { inner: c, outer: c, innerWeight: 1 };
    if (e >= 0) return { inner: c, outer: c + 1, innerWeight: clamp(e / b, 0, 1) };
  }
  return { inner: n - 1, outer: n - 1, innerWeight: 1 };
}


export function buildSunMaskFetchGlsl() {
  return (
    "\n" +
    "// Fase 5 (plano GPU fraca): máscara do sol meia-res (1 fetch).\n" +
    "uniform float uRswSunMaskOn;\n" +
    "uniform sampler2D uRswSunMaskTex;\n" +
    "uniform vec2 uRswSunMaskInvRes;\n" +
    "float rswSunMaskFetch() {\n" +
    "  return texture2D(uRswSunMaskTex, gl_FragCoord.xy * uRswSunMaskInvRes).r;\n" +
    "}\n"
  );
}


export function buildSunMaskReturn() {
  return (
    "\n\tif ( uRswSunMaskOn > 0.5 && ( ( shadowRadius > 999.5 && shadowRadius < 1999.5 ) || ( shadowRadius > 3999.5 && shadowRadius < 4999.5 ) ) ) return rswSunMaskFetch();"
  );
}


export const SUN_MASK_PASS_VERT = [
  "varying vec2 vUv;",
  "void main() {",
  "  vUv = uv;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");


export function buildSunMaskPassGlsl() {
  return [
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform sampler2D tDepth;",
    "uniform mat4 uInvViewProj;",
    "uniform sampler2D uMaskMap0;",
    "uniform sampler2D uMaskMap1;",
    "uniform sampler2D uMaskMap2;",
    "uniform sampler2D uMaskMap3;",
    "uniform mat4 uMaskMtx0;",
    "uniform mat4 uMaskMtx1;",
    "uniform mat4 uMaskMtx2;",
    "uniform mat4 uMaskMtx3;",
    "uniform float uMaskCount;",
    "uniform float uMaskBlend;",
    "uniform vec4 uMaskScale;",
    "uniform vec4 uMaskCapK;",
    "uniform vec4 uMaskBias;",
    "uniform vec4 uMaskTexel;",
    "uniform float uMaskTan;",
    "uniform float uMaskFrame;",
    "uniform float uMaskTaps;",
    "uniform float uMaskBlockers;",
    "float rswSmUnpack(const in vec4 v) {",
    "  const vec4 f = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);",
    "  return dot(v, f);",
    "}",
    "float rswSmIgn(const in vec2 p) {",
    "  vec2 q = p + uMaskFrame * vec2(5.588238, 2.719052);",
    "  return fract(52.9829189 * fract(dot(q, vec2(0.06711056, 0.00583715))));",
    "}",
    "float rswSmEdge(const in vec4 sc) {",
    "  vec3 p = sc.xyz / max(sc.w, 1e-6);",
    "  if (p.z < 0.0 || p.z > 1.0) return -1.0;",
    "  vec2 d2 = min(p.xy, vec2(1.0) - p.xy);",
    "  return min(d2.x, d2.y);",
    "}",
    "float rswSmPcss(sampler2D map, const in vec4 sc, const in float bias, const in float scale, const in float capK, const in float texel) {",
    "  vec3 p = sc.xyz / max(sc.w, 1e-6);",
    "  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z < 0.0 || p.z > 1.0) return 1.0;",
    "  float zr = p.z + bias;",
    "  float ang = 6.28318530718 * rswSmIgn(gl_FragCoord.xy);",
    "  float ca = cos(ang);",
    "  float sa = sin(ang);",
    "  float search = clamp(uMaskTan * scale * zr, texel * 2.0, 0.05 * capK);",
    "  float avg = 0.0;",
    "  float cnt = 0.0;",
    "  for (int i = 0; i < 8; i++) {",
    "    if (float(i) >= uMaskBlockers) break;",
    "    float fi = float(i) + 0.5;",
    "    float rr = sqrt(fi / max(uMaskBlockers, 1.0));",
    "    float th = fi * 2.39996323;",
    "    vec2 dir = vec2(cos(th), sin(th));",
    "    vec2 off = vec2(dir.x * ca - dir.y * sa, dir.x * sa + dir.y * ca) * (rr * search);",
    "    float sz = rswSmUnpack(texture2D(map, p.xy + off));",
    "    if (sz < zr) { avg += sz; cnt += 1.0; }",
    "  }",
    "  if (cnt < 0.5) return 1.0;",
    "  avg /= cnt;",
    "  float pen = clamp(uMaskTan * scale * (zr - avg), texel, 0.033 * capK);",
    "  float lit = 0.0;",
    "  float n = 0.0;",
    "  for (int i = 0; i < 8; i++) {",
    "    if (float(i) >= uMaskTaps) break;",
    "    float fi = float(i) + 0.5;",
    "    float rr = sqrt(fi / max(uMaskTaps, 1.0));",
    "    float th = fi * 2.39996323 + 1.5707963;",
    "    vec2 dir = vec2(cos(th), sin(th));",
    "    vec2 off = vec2(dir.x * ca - dir.y * sa, dir.x * sa + dir.y * ca) * (rr * pen);",
    "    float sz = rswSmUnpack(texture2D(map, p.xy + off));",
    "    lit += (sz < zr) ? 0.0 : 1.0;",
    "    n += 1.0;",
    "  }",
    "  return n > 0.0 ? lit / n : 1.0;",
    "}",
    "float rswSmSample(const in int c, const in vec3 wp) {",
    "  if (c == 1) return rswSmPcss(uMaskMap1, uMaskMtx1 * vec4(wp, 1.0), uMaskBias.y, uMaskScale.y, uMaskCapK.y, uMaskTexel.y);",
    "  if (c == 2) return rswSmPcss(uMaskMap2, uMaskMtx2 * vec4(wp, 1.0), uMaskBias.z, uMaskScale.z, uMaskCapK.z, uMaskTexel.z);",
    "  if (c == 3) return rswSmPcss(uMaskMap3, uMaskMtx3 * vec4(wp, 1.0), uMaskBias.w, uMaskScale.w, uMaskCapK.w, uMaskTexel.w);",
    "  return rswSmPcss(uMaskMap0, uMaskMtx0 * vec4(wp, 1.0), uMaskBias.x, uMaskScale.x, uMaskCapK.x, uMaskTexel.x);",
    "}",
    "float rswSmShadow(const in vec3 wp) {",
    "  int n = int(clamp(uMaskCount, 1.0, 4.0));",


    "  float e = -1.0;",
    "  if (n > 1) {",
    "    e = rswSmEdge(uMaskMtx0 * vec4(wp, 1.0));",
    "    if (e >= uMaskBlend) return rswSmSample(0, wp);",
    "    if (e >= 0.0) return mix(rswSmSample(1, wp), rswSmSample(0, wp), e / max(uMaskBlend, 1e-4));",
    "  }",
    "  if (n > 2) {",
    "    e = rswSmEdge(uMaskMtx1 * vec4(wp, 1.0));",
    "    if (e >= uMaskBlend) return rswSmSample(1, wp);",
    "    if (e >= 0.0) return mix(rswSmSample(2, wp), rswSmSample(1, wp), e / max(uMaskBlend, 1e-4));",
    "  }",
    "  if (n > 3) {",
    "    e = rswSmEdge(uMaskMtx2 * vec4(wp, 1.0));",
    "    if (e >= uMaskBlend) return rswSmSample(2, wp);",
    "    if (e >= 0.0) return mix(rswSmSample(3, wp), rswSmSample(2, wp), e / max(uMaskBlend, 1e-4));",
    "  }",
    "  return rswSmSample(n - 1, wp);",
    "}",
    "void main() {",
    "  float d = rswSmUnpack(texture2D(tDepth, vUv));",
    "  if (d >= 0.9999) {",
    "    gl_FragColor = vec4(1.0);",
    "    return;",
    "  }",
    "  vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);",
    "  vec4 wp = uInvViewProj * ndc;",
    "  if (abs(wp.w) < 1e-8) {",
    "    gl_FragColor = vec4(1.0);",
    "    return;",
    "  }",
    "  float s = rswSmShadow(wp.xyz / wp.w);",
    "  gl_FragColor = vec4(s, s, s, 1.0);",
    "}",
  ].join("\n");
}
