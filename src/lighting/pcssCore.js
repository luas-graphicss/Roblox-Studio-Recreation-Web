import {
  RECEIVER_PLANE_TRUST_DEFAULT_MAP_PIXELS,
  buildReceiverPlaneTrustGlsl,
  trustedReceiverPlaneGradient,
} from "./shadowReceiverPlaneTrust.js";

export const PCSS_MIN_SAMPLES = 4;
export const PCSS_MAX_SAMPLES = 32;                                    
export const PCSS_MAX_SEARCH_UV = 0.05;                                   
export const PCSS_MAX_FILTER_UV = 0.033;                                      


export const PCSS_TEMPORAL_TAPS = 9;
export const PCSS_TEMPORAL_BLOCKERS = 8;


export const PCSS_MIN_FILTER_TEXELS = 1.0;
export const PCSS_PLANE_BIAS_CAP = 0.002;
export const PCSS_PLANE_BIAS_CAP_MAX = 0.008;

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}


export function clampPcssOptions(opts) {
  const o = opts || {};
  const samples = Math.round(clamp(num(o.samples, 17), PCSS_MIN_SAMPLES, PCSS_MAX_SAMPLES));
  const blockerSamples = Math.round(clamp(num(o.blockerSamples, 16), PCSS_MIN_SAMPLES, samples));
  const rings = Math.round(clamp(num(o.rings, 11), 2, 29));
  return { samples, blockerSamples, rings };
}


export function sunTanFromSoftness(softness, boost) {
  const s = clamp(num(softness, 0.2), 0, 1);
  const b = clamp(num(boost, 1), 0.25, 4);
  return clamp(0.002 + s * 0.028 * b, 0.001, 0.08);
}


export function depthUvScale(near, far, frustumSize) {
  const n = num(near, 1);
  const f = num(far, 1500);
  const w = num(frustumSize, 360);
  if (!(f > n) || !(w > 0)) return 1;
  return clamp((f - n) / w, 0.01, 50);
}


export function searchRadiusUv(tan, scale, zReceiver) {
  const t = num(tan, 0);
  const s = num(scale, 0);
  const z = num(zReceiver, 0);
  if (t <= 0 || s <= 0 || z <= 0) return 0;
  return Math.min(t * s * z, PCSS_MAX_SEARCH_UV);
}


export function filterRadiusUv(tan, scale, zReceiver, zBlocker) {
  const t = num(tan, 0);
  const s = num(scale, 0);
  const zr = num(zReceiver, NaN);
  const zb = num(zBlocker, NaN);
  if (t <= 0 || s <= 0 || !Number.isFinite(zr) || !Number.isFinite(zb)) return 0;
  if (zb <= 0 || zr <= zb) return 0;
  return Math.min(t * s * (zr - zb), PCSS_MAX_FILTER_UV);
}


function randJs(x, y) {
  const dt = x * 12.9898 + y * 78.233;
  const sn = dt % Math.PI;
  const v = Math.sin(sn) * 43758.5453;
  return v - Math.floor(v);
}

export function poissonDiskJs(samples, rings, seedX, seedY) {
  const o = clampPcssOptions({ samples, rings });
  const out = [];
  const angleStep = (Math.PI * 2 * o.rings) / o.samples;
  const invSamples = 1 / o.samples;
  let angle = randJs(num(seedX, 0), num(seedY, 0)) * Math.PI * 2;
  let radius = invSamples;
  const radiusStep = radius;
  for (let i = 0; i < o.samples; i++) {
    const r = Math.pow(radius, 0.75);
    out.push([Math.cos(angle) * r, Math.sin(angle) * r]);
    radius += radiusStep;
    angle += angleStep;
  }
  return out;
}


export function ignJs(x, y) {
  const inner = 0.06711056 * num(x, 0) + 0.00583715 * num(y, 0);
  const f = inner - Math.floor(inner);
  const v = 52.9829189 * f;
  return v - Math.floor(v);
}


export function clampRuntimeTaps(taps, blockers) {
  const t = Math.round(clamp(num(taps, 17), PCSS_MIN_SAMPLES, PCSS_MAX_SAMPLES));
  const b = Math.round(clamp(num(blockers, 16), PCSS_MIN_SAMPLES, t));
  return { taps: t, blockers: b };
}


export function receiverPlaneDzDuv(dx, dy, options) {
  const ax = dx || [];
  const ay = dy || [];
  const x0 = num(ax[0], 0), x1 = num(ax[1], 0), x2 = num(ax[2], 0);
  const y0 = num(ay[0], 0), y1 = num(ay[1], 0), y2 = num(ay[2], 0);
  const det = x0 * y1 - x1 * y0;
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-10) return [0, 0];
  const du = (y1 * x2 - x1 * y2) / det;
  const dv = (x0 * y2 - y0 * x2) / det;
  if (!Number.isFinite(du) || !Number.isFinite(dv)) return [0, 0];
  const opts = options || {};
  const capAsked = num(opts.planeBiasCap, 0);
  const texelAsked = num(opts.texelUv, 0);
  return trustedReceiverPlaneGradient({
    dzduv: [du, dv],
    planeBiasCap: capAsked > 0 ? capAsked : PCSS_PLANE_BIAS_CAP,
    texelUv: texelAsked > 0 ? texelAsked : 1 / RECEIVER_PLANE_TRUST_DEFAULT_MAP_PIXELS,
  });
}


export function planeBiasJs(dzduv, off, cap) {
  const d = dzduv || [];
  const o = off || [];
  const v = num(d[0], 0) * num(o[0], 0) + num(d[1], 0) * num(o[1], 0);
  const c = num(cap, 0);
  const teto = c > 0 ? Math.min(PCSS_PLANE_BIAS_CAP_MAX, Math.max(PCSS_PLANE_BIAS_CAP, c)) : PCSS_PLANE_BIAS_CAP;
  return clamp(Number.isFinite(v) ? v : 0, -teto, teto);
}


export function buildPcssGlsl(opts) {
  const o = clampPcssOptions(opts);
  return (
    "\n" +
    "// Parte 88: PCSS — penumbra real por busca de oclusores.\n" +
    "// Fase 3 (Parte 160): ruído IGN animado por frame + taps por uniform.\n" +
    "// Fase 7: teto do receiver-plane bias por resolução/tier (0 = clássico).\n" +
    "uniform float uRswPcssPlaneCap;\n" +
    "uniform float uRswPcssOn;\n" +
    "uniform float uRswPcssTan;\n" +
    "uniform float uRswPcssScale;\n" +
    "uniform float uRswPcssFrame;\n" +
    "uniform float uRswPcssTemporal;\n" +
    "uniform float uRswPcssTaps;\n" +
    "uniform float uRswPcssBlockerTaps;\n" +
    "#define RSW_PCSS_SAMPLES " + o.samples + "\n" +
    "#define RSW_PCSS_BLOCKERS " + o.blockerSamples + "\n" +
    "#define RSW_PCSS_RINGS " + o.rings + "\n" +
    "vec2 rswPcssDisk[RSW_PCSS_SAMPLES];\n" +
    "float rswUnpackDepth(const in vec4 v) {\n" +
    "  const vec4 rswUnpackFactors = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);\n" +
    "  return dot(v, rswUnpackFactors);\n" +
    "}\n" +


    "float rswPlaneBiasCap() {\n" +
    "  return max(uRswPcssPlaneCap, " + PCSS_PLANE_BIAS_CAP + ");\n" +
    "}\n" +
    "float rswPlaneBias(const in vec2 dzduv, const in vec2 off) {\n" +
    "  float rswPlCap = rswPlaneBiasCap();\n" +
    "  return clamp(dot(dzduv, off), -rswPlCap, rswPlCap);\n" +
    "}\n" +
    buildReceiverPlaneTrustGlsl() +


    "float rswCmpBilin(sampler2D shadowMap, const in vec2 uv, const in float z, const in float texelUv) {\n" +
    "  vec2 rswG = uv / texelUv - 0.5;\n" +
    "  vec2 rswF = fract(rswG);\n" +
    "  vec2 rswB = (floor(rswG) + 0.5) * texelUv;\n" +
    "  float rswS00 = z <= rswUnpackDepth(texture2D(shadowMap, rswB)) ? 1.0 : 0.0;\n" +
    "  float rswS10 = z <= rswUnpackDepth(texture2D(shadowMap, rswB + vec2(texelUv, 0.0))) ? 1.0 : 0.0;\n" +
    "  float rswS01 = z <= rswUnpackDepth(texture2D(shadowMap, rswB + vec2(0.0, texelUv))) ? 1.0 : 0.0;\n" +
    "  float rswS11 = z <= rswUnpackDepth(texture2D(shadowMap, rswB + vec2(texelUv, texelUv))) ? 1.0 : 0.0;\n" +
    "  return mix(mix(rswS00, rswS10, rswF.x), mix(rswS01, rswS11, rswF.x), rswF.y);\n" +
    "}\n" +
    "float rswPcssRand(const in vec2 uv) {\n" +
    "  float dt = dot(uv.xy, vec2(12.9898, 78.233));\n" +
    "  float sn = mod(dt, PI);\n" +
    "  return fract(sin(sn) * 43758.5453);\n" +
    "}\n" +
    "float rswIgn(const in vec2 px) {\n" +
    "  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));\n" +
    "}\n" +
    "float rswPcssTapCount() {\n" +
    "  return clamp(uRswPcssTaps, 4.0, float(RSW_PCSS_SAMPLES));\n" +
    "}\n" +
    "void rswPcssInitDisk(const in vec2 seed) {\n" +


    "  float rswN = rswPcssTapCount();\n" +
    "  float angleStep = PI2 * float(RSW_PCSS_RINGS) / rswN;\n" +
    "  float invSamples = 1.0 / rswN;\n" +
    "  float angle = (uRswPcssTemporal > 0.5 ? rswIgn(gl_FragCoord.xy + uRswPcssFrame * vec2(5.588238, 2.719052)) : rswPcssRand(seed)) * PI2;\n" +
    "  float radius = invSamples;\n" +
    "  float radiusStep = radius;\n" +


    "  for (int i = 0; i < RSW_PCSS_SAMPLES; i++) {\n" +
    "    if (float(i) >= uRswPcssTaps) { rswPcssDisk[i] = vec2(0.0); continue; }\n" +
    "    rswPcssDisk[i] = vec2(cos(angle), sin(angle)) * pow(radius, 0.75);\n" +
    "    radius += radiusStep;\n" +
    "    angle += angleStep;\n" +
    "  }\n" +
    "}\n" +
    "float rswPcssFindBlocker(sampler2D shadowMap, const in vec2 uv, const in float zReceiver, const in float rswScale, const in float rswCapK, const in vec2 rswDzDuv) {\n" +
    "  float searchRadius = min(uRswPcssTan * rswScale * zReceiver, " + PCSS_MAX_SEARCH_UV + " * rswCapK);\n" +
    "  float blockerDepthSum = 0.0;\n" +
    "  int numBlockers = 0;\n" +
    "  for (int i = 0; i < RSW_PCSS_BLOCKERS; i++) {\n" +
    "    if (float(i) >= uRswPcssBlockerTaps) break;\n" +


    "    vec2 rswOff = rswPcssDisk[i] * searchRadius;\n" +
    "    float depth = rswUnpackDepth(texture2D(shadowMap, uv + rswOff));\n" +
    "    if (depth < zReceiver + rswPlaneBias(rswDzDuv, rswOff)) {\n" +
    "      blockerDepthSum += depth;\n" +
    "      numBlockers++;\n" +
    "    }\n" +
    "  }\n" +
    "  if (numBlockers == 0) return -1.0;\n" +
    "  return blockerDepthSum / float(numBlockers);\n" +
    "}\n" +
    "float rswPcssFilter(sampler2D shadowMap, const in vec2 uv, const in float zReceiver, const in float filterRadius, const in vec2 rswDzDuv, const in float rswTexelUv) {\n" +
    "  float sum = 0.0;\n" +




    "  bool rswFine = filterRadius <= rswTexelUv * 3.0;\n" +
    "  for (int i = 0; i < RSW_PCSS_SAMPLES; i++) {\n" +
    "    if (float(i) >= uRswPcssTaps) break;\n" +
    "    vec2 rswOff = rswPcssDisk[i] * filterRadius;\n" +
    "    float rswZ = zReceiver + rswPlaneBias(rswDzDuv, rswOff);\n" +
    "    if (rswFine) { sum += rswCmpBilin(shadowMap, uv + rswOff, rswZ, rswTexelUv); }\n" +
    "    else if (rswZ <= rswUnpackDepth(texture2D(shadowMap, uv + rswOff))) sum += 1.0;\n" +
    "  }\n" +
    "  for (int i = 0; i < RSW_PCSS_SAMPLES; i++) {\n" +
    "    if (float(i) >= uRswPcssTaps) break;\n" +
    "    vec2 rswOff = -rswPcssDisk[i].yx * filterRadius;\n" +
    "    float rswZ = zReceiver + rswPlaneBias(rswDzDuv, rswOff);\n" +
    "    if (rswFine) { sum += rswCmpBilin(shadowMap, uv + rswOff, rswZ, rswTexelUv); }\n" +
    "    else if (rswZ <= rswUnpackDepth(texture2D(shadowMap, uv + rswOff))) sum += 1.0;\n" +
    "  }\n" +
    "  return sum / (2.0 * rswPcssTapCount());\n" +
    "}\n" +


    "float rswPcssScaled(sampler2D shadowMap, float shadowBias, vec4 sc, const in float rswScale, const in float rswCapK) {\n" +
    "  vec3 rswC = sc.xyz / sc.w;\n" +
    "  rswC.z += shadowBias;\n" +


    "  float rswTexelUv = 1.0 / max(float(textureSize(shadowMap, 0).x), 1.0);\n" +
    "  vec3 rswDx = dFdx(rswC);\n" +
    "  vec3 rswDy = dFdy(rswC);\n" +
    "  float rswDet = rswDx.x * rswDy.y - rswDx.y * rswDy.x;\n" +
    "  vec2 rswDzDuv = vec2(0.0);\n" +
    "  if (abs(rswDet) > 1e-10) {\n" +
    "    rswDzDuv = vec2(rswDy.y * rswDx.z - rswDx.y * rswDy.z, rswDx.x * rswDy.z - rswDy.x * rswDx.z) / rswDet;\n" +
    "    rswDzDuv = rswTrustedReceiverPlane(rswDzDuv, rswTexelUv, rswPlaneBiasCap());\n" +
    "  }\n" +
    "  bvec4 rswInFrustum = bvec4(rswC.x >= 0.0, rswC.x <= 1.0, rswC.y >= 0.0, rswC.y <= 1.0);\n" +
    "  if (!all(rswInFrustum) || rswC.z > 1.0 || rswC.z < 0.0) return 1.0;\n" +
    "  vec2 uv = rswC.xy;\n" +
    "  float zReceiver = rswC.z;\n" +
    "  rswPcssInitDisk(uv);\n" +
    "  float avgBlockerDepth = rswPcssFindBlocker(shadowMap, uv, zReceiver, rswScale, rswCapK, rswDzDuv);\n" +
    "  if (avgBlockerDepth == -1.0) return 1.0;\n" +


    "  float rswMinFilterUv = " + PCSS_MIN_FILTER_TEXELS.toFixed(1) + " * rswTexelUv;\n" +
    "  float filterRadius = clamp(uRswPcssTan * rswScale * (zReceiver - avgBlockerDepth), rswMinFilterUv, " + PCSS_MAX_FILTER_UV + " * rswCapK);\n" +
    "  return rswPcssFilter(shadowMap, uv, zReceiver, filterRadius, rswDzDuv, rswTexelUv);\n" +
    "}\n" +





    "float rswPcss(sampler2D shadowMap, float shadowBias, float shadowRadius, vec4 sc) {\n" +
    "  float rswAreaK = shadowRadius > 999.5 ? 1.0 : clamp(shadowRadius, 1.0, 6.0);\n" +
    "  return rswPcssScaled(shadowMap, shadowBias, sc, uRswPcssScale * rswAreaK, 1.0);\n" +
    "}\n"
  );
}








export function parseGetShadowSignature(chunk) {
  if (typeof chunk !== "string") return { ok: false };
  const idx = chunk.indexOf("float getShadow(");
  if (idx === -1) return { ok: false };
  const open = chunk.indexOf("(", idx);
  const close = chunk.indexOf(")", open);
  if (open === -1 || close === -1) return { ok: false };
  const params = chunk.slice(open + 1, close);
  const samplerType =
    params.indexOf("sampler2DShadow") !== -1
      ? "sampler2DShadow"
      : params.indexOf("sampler2D") !== -1
        ? "sampler2D"
        : null;
  if (!samplerType) return { ok: false };
  for (const nome of ["shadowMap", "shadowBias", "shadowRadius", "shadowCoord"]) {
    if (params.indexOf(nome) === -1) return { ok: false };
  }


  return {
    ok: true,
    samplerType,
    hasIntensity: params.indexOf("shadowIntensity") !== -1,
    hasRadius: params.indexOf("shadowRadius") !== -1,
  };
}


export function buildPcssGlslCompare(opts) {
  const o = clampPcssOptions(opts);
  return (
    "\n" +
    "// Parte 90.2: PCSS sobre depth texture com comparação por hardware.\n" +
    "// Fase 3 (Parte 160): ruído IGN animado por frame + taps por uniform.\n" +
    "uniform float uRswPcssOn;\n" +
    "uniform float uRswPcssTan;\n" +
    "uniform float uRswPcssScale;\n" +
    "uniform float uRswPcssFrame;\n" +
    "uniform float uRswPcssTemporal;\n" +
    "uniform float uRswPcssTaps;\n" +
    "uniform float uRswPcssBlockerTaps;\n" +
    "#define RSW_PCSS_SAMPLES " + o.samples + "\n" +


    "#define RSW_PCSS_BLOCKERS " + Math.min(o.blockerSamples, 8) + "\n" +
    "#define RSW_PCSS_RINGS " + o.rings + "\n" +
    "#define RSW_PCSS_ZSLICES 4\n" +
    "vec2 rswPcssDisk[RSW_PCSS_SAMPLES];\n" +
    "float rswPcssRand(const in vec2 uv) {\n" +
    "  float dt = dot(uv.xy, vec2(12.9898, 78.233));\n" +
    "  float sn = mod(dt, PI);\n" +
    "  return fract(sin(sn) * 43758.5453);\n" +
    "}\n" +
    "float rswIgn(const in vec2 px) {\n" +
    "  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));\n" +
    "}\n" +
    "float rswPcssTapCount() {\n" +
    "  return clamp(uRswPcssTaps, 4.0, float(RSW_PCSS_SAMPLES));\n" +
    "}\n" +
    "void rswPcssInitDisk(const in vec2 seed) {\n" +



    "  float rswN = rswPcssTapCount();\n" +
    "  float angleStep = PI2 * float(RSW_PCSS_RINGS) / rswN;\n" +
    "  float invSamples = 1.0 / rswN;\n" +
    "  float angle = (uRswPcssTemporal > 0.5 ? rswIgn(gl_FragCoord.xy + uRswPcssFrame * vec2(5.588238, 2.719052)) : rswPcssRand(seed)) * PI2;\n" +
    "  float radius = invSamples;\n" +
    "  float radiusStep = radius;\n" +




    "  for (int i = 0; i < RSW_PCSS_SAMPLES; i++) {\n" +
    "    if (float(i) >= uRswPcssTaps) { rswPcssDisk[i] = vec2(0.0); continue; }\n" +
    "    rswPcssDisk[i] = vec2(cos(angle), sin(angle)) * pow(radius, 0.75);\n" +
    "    radius += radiusStep;\n" +
    "    angle += angleStep;\n" +
    "  }\n" +
    "}\n" +


    "float rswPcssSlice(const in int k) {\n" +
    "  return k == 0 ? 0.008 : k == 1 ? 0.05 : k == 2 ? 0.25 : 1.0;\n" +
    "}\n" +
    "float rswPcssOccDist(sampler2DShadow shadowMap, const in vec2 uv, const in float zReceiver, const in float zWindow) {\n" +
    "  float searchRadius = min(uRswPcssTan * uRswPcssScale * zReceiver, " + PCSS_MAX_SEARCH_UV + ");\n" +
    "  float occSum = 0.0;\n" +
    "  float hits = 0.0;\n" +
    "  for (int i = 0; i < RSW_PCSS_BLOCKERS; i++) {\n" +
    "    if (float(i) >= uRswPcssBlockerTaps) break;\n" +
    "    vec2 tapUv = uv + rswPcssDisk[i] * searchRadius;\n" +



    "    float occ = -1.0;\n" +
    "    for (int k = RSW_PCSS_ZSLICES - 1; k >= 0; k--) {\n" +
    "      float zk = zReceiver - zWindow * rswPcssSlice(k);\n" +
    "      if (texture(shadowMap, vec3(tapUv, zk)) < 0.5) {\n" +
    "        occ = zWindow * (k == RSW_PCSS_ZSLICES - 1 ? 1.0 : (rswPcssSlice(k) + rswPcssSlice(k + 1)) * 0.5);\n" +
    "        break;\n" +
    "      }\n" +
    "    }\n" +
    "    if (occ >= 0.0) {\n" +
    "      occSum += occ;\n" +
    "      hits += 1.0;\n" +
    "    }\n" +
    "  }\n" +
    "  if (hits <= 0.0) return -1.0;\n" +
    "  return occSum / hits;\n" +
    "}\n" +
    "float rswPcssFilterCmp(sampler2DShadow shadowMap, const in vec2 uv, const in float zReceiver, const in float filterRadius) {\n" +
    "  float sum = 0.0;\n" +
    "  for (int i = 0; i < RSW_PCSS_SAMPLES; i++) {\n" +
    "    if (float(i) >= uRswPcssTaps) break;\n" +
    "    sum += texture(shadowMap, vec3(uv + rswPcssDisk[i] * filterRadius, zReceiver));\n" +
    "  }\n" +
    "  return sum / rswPcssTapCount();\n" +
    "}\n" +
    "float rswPcss(sampler2DShadow shadowMap, float shadowBias, float shadowRadius, vec4 sc) {\n" +
    "  vec3 rswC = sc.xyz / sc.w;\n" +
    "  rswC.z += shadowBias;\n" +
    "  bvec4 rswInFrustum = bvec4(rswC.x >= 0.0, rswC.x <= 1.0, rswC.y >= 0.0, rswC.y <= 1.0);\n" +
    "  if (!all(rswInFrustum) || rswC.z > 1.0 || rswC.z < 0.0) return 1.0;\n" +
    "  vec2 uv = rswC.xy;\n" +
    "  float zReceiver = rswC.z;\n" +
    "  rswPcssInitDisk(uv);\n" +


    "  float rswAreaK = shadowRadius > 999.5 ? 1.0 : clamp(shadowRadius, 1.0, 6.0);\n" +
    "  float zWindow = clamp(" + PCSS_MAX_FILTER_UV + " / max(uRswPcssTan * uRswPcssScale, 0.0001), 0.01, 0.15);\n" +
    "  float occDist = rswPcssOccDist(shadowMap, uv, zReceiver, zWindow);\n" +
    "  if (occDist < 0.0) return 1.0;\n" +


    "  float rswMinFilterUv = 1.0 / max(float(textureSize(shadowMap, 0).x), 1.0);\n" +
    "  float filterRadius = clamp(uRswPcssTan * uRswPcssScale * rswAreaK * occDist, rswMinFilterUv, " + PCSS_MAX_FILTER_UV + ");\n" +
    "  return rswPcssFilterCmp(shadowMap, uv, zReceiver, filterRadius);\n" +
    "}\n"
  );
}







export function buildPcssReturn(sig) {

  const call = "rswPcss( shadowMap, shadowBias, shadowRadius, shadowCoord )";
  const expr = sig && sig.hasIntensity ? "mix( 1.0, " + call + ", shadowIntensity )" : call;
  return "\n\tif ( uRswPcssOn > 0.5 ) return " + expr + ";";
}


export const PCSS_PT_MAX_SEARCH = 0.09;                                        
export const PCSS_PT_MAX_FILTER = 0.06;                                     
export const PCSS_PT_MIN_ANG = 0.004;                                    
export const PCSS_PT_MAX_ANG = 0.12;                                    


export function pointAngFromSoftness(softness, boost) {
  const s = clamp(num(softness, 0.2), 0, 1);
  const b = clamp(num(boost, 1), 0.25, 4);
  return clamp(0.006 + s * 0.05 * b, PCSS_PT_MIN_ANG, PCSS_PT_MAX_ANG);
}





export function pointFilterAng(ang, dp, avgBlocker, minAng) {
  const a = clamp(num(ang, 0), 0, PCSS_PT_MAX_ANG);
  const lo = clamp(num(minAng, 0), 0, PCSS_PT_MAX_FILTER);
  const zr = num(dp, NaN);
  const zb = num(avgBlocker, NaN);
  if (a <= 0 || !Number.isFinite(zr) || !Number.isFinite(zb) || zb < 0 || zr <= zb) return lo;
  return clamp((a * (zr - zb)) / (Math.max(zb, 0.02) * Math.max(zr, 0.05)), lo, PCSS_PT_MAX_FILTER);
}


export function pointSearchAng(ang, dp, minAng) {
  const a = clamp(num(ang, 0), 0, PCSS_PT_MAX_ANG);
  const lo = clamp(num(minAng, 0), 0, PCSS_PT_MAX_SEARCH);
  const zr = num(dp, NaN);
  const d = Number.isFinite(zr) ? Math.max(zr, 0.1) : 1;
  return clamp(Math.max((a * 2) / d, lo), 0, PCSS_PT_MAX_SEARCH);
}






export function parseGetPointShadowSignature(chunk) {
  if (typeof chunk !== "string") return { ok: false };
  const idx = chunk.indexOf("float getPointShadow(");
  if (idx === -1) return { ok: false };
  const open = chunk.indexOf("(", idx);
  const close = chunk.indexOf(")", open);
  if (open === -1 || close === -1) return { ok: false };
  const params = chunk.slice(open + 1, close);
  if (params.indexOf("sampler2DShadow") !== -1) return { ok: false };
  if (params.indexOf("sampler2D") === -1) return { ok: false };
  for (const nome of [
    "shadowMap",
    "shadowMapSize",
    "shadowBias",
    "shadowCoord",
    "shadowCameraNear",
    "shadowCameraFar",
  ]) {
    if (params.indexOf(nome) === -1) return { ok: false };
  }
  const cube = chunk.indexOf("vec2 cubeToUV(");
  if (cube === -1 || cube > idx) return { ok: false };
  return { ok: true, samplerType: "sampler2D" };
}


export function buildPointPcssGlsl() {
  return (
    "\n" +
    "// Parte 96: PCSS para PointLights — penumbra real na sombra cúbica.\n" +
    "uniform float uRswPcssPtAng;\n" +
    "void rswPtBasis(const in vec3 d, out vec3 t1, out vec3 t2) {\n" +
    "  vec3 up = abs(d.y) < 0.98 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);\n" +
    "  t1 = normalize(cross(up, d));\n" +
    "  t2 = cross(d, t1);\n" +
    "}\n" +
    "float rswPtBlocker(sampler2D shadowMap, const in vec3 bd3D, const in float dp, const in float texelSizeY, const in vec3 t1, const in vec3 t2) {\n" +


    "  float searchAng = min(max(uRswPcssPtAng * 2.0 / max(dp, 0.1), 4.7 * texelSizeY), " + PCSS_PT_MAX_SEARCH + ");\n" +
    "  float blockerSum = 0.0;\n" +
    "  int numBlockers = 0;\n" +
    "  for (int i = 0; i < RSW_PCSS_BLOCKERS; i++) {\n" +
    "    if (float(i) >= uRswPcssBlockerTaps) break;\n" +
    "    vec3 dir = normalize(bd3D + (t1 * rswPcssDisk[i].x + t2 * rswPcssDisk[i].y) * searchAng);\n" +
    "    float depth = rswUnpackDepth(texture2D(shadowMap, cubeToUV(dir, texelSizeY)));\n" +
    "    if (depth < dp) {\n" +
    "      blockerSum += depth;\n" +
    "      numBlockers++;\n" +
    "    }\n" +
    "  }\n" +
    "  if (numBlockers == 0) return -1.0;\n" +
    "  return blockerSum / float(numBlockers);\n" +
    "}\n" +
    "float rswPtFilter(sampler2D shadowMap, const in vec3 bd3D, const in float dp, const in float ang, const in float texelSizeY, const in vec3 t1, const in vec3 t2) {\n" +
    "  float sum = 0.0;\n" +
    "  for (int i = 0; i < RSW_PCSS_SAMPLES; i++) {\n" +
    "    if (float(i) >= uRswPcssTaps) break;\n" +
    "    vec3 dir = normalize(bd3D + (t1 * rswPcssDisk[i].x + t2 * rswPcssDisk[i].y) * ang);\n" +
    "    if (dp <= rswUnpackDepth(texture2D(shadowMap, cubeToUV(dir, texelSizeY)))) sum += 1.0;\n" +
    "  }\n" +
    "  for (int i = 0; i < RSW_PCSS_SAMPLES; i++) {\n" +
    "    if (float(i) >= uRswPcssTaps) break;\n" +
    "    vec3 dir = normalize(bd3D + (t1 * -rswPcssDisk[i].y + t2 * rswPcssDisk[i].x) * ang);\n" +
    "    if (dp <= rswUnpackDepth(texture2D(shadowMap, cubeToUV(dir, texelSizeY)))) sum += 1.0;\n" +
    "  }\n" +
    "  return sum / (2.0 * rswPcssTapCount());\n" +
    "}\n" +
    "float rswPcssPoint(sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar) {\n" +
    "  vec2 texelSize = vec2(1.0) / (shadowMapSize * vec2(4.0, 2.0));\n" +
    "  vec3 lightToPosition = shadowCoord.xyz;\n" +
    "  float dp = (length(lightToPosition) - shadowCameraNear) / (shadowCameraFar - shadowCameraNear);\n" +
    "  dp += shadowBias;\n" +
    "  if (dp < 0.0 || dp > 1.0) return 1.0;\n" +
    "  vec3 bd3D = normalize(lightToPosition);\n" +



    "  vec3 t1 = vec3(0.0);\n" +
    "  vec3 t2 = vec3(0.0);\n" +
    "  rswPtBasis(bd3D, t1, t2);\n" +
    "  rswPcssInitDisk(bd3D.xy + vec2(bd3D.z * 7.13));\n" +
    "  float avgBlockerDepth = rswPtBlocker(shadowMap, bd3D, dp, texelSize.y, t1, t2);\n" +
    "  if (avgBlockerDepth < 0.0) return 1.0;\n" +


    "  float rswPtMinAng = 4.7 * texelSize.y;\n" +


    "  float ang = clamp(uRswPcssPtAng * (dp - avgBlockerDepth) / (max(avgBlockerDepth, 0.02) * max(dp, 0.05)), rswPtMinAng, " + PCSS_PT_MAX_FILTER + ");\n" +
    "  return rswPtFilter(shadowMap, bd3D, dp, ang, texelSize.y, t1, t2);\n" +
    "}\n"
  );
}



export function buildPointPcssReturn() {
  return "\n\tif ( uRswPcssOn > 0.5 ) return rswPcssPoint( shadowMap, shadowMapSize, shadowBias, shadowCoord, shadowCameraNear, shadowCameraFar );";
}
