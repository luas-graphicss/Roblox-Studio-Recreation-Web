import { buildMegaLightsDepthGlsl } from "./megaLightsDepthGlsl.js";

export const ML_MAX_LIGHTS = 128;
export const ML_TEX_WIDTH = ML_MAX_LIGHTS * 2;                               
export const ML_GOLDEN = 0.61803398875;
export const ML_WEIGHT_MIN = 1e-4;
export const ML_DEFAULTS = Object.freeze({
  strength: 0.85,                                                           
  steps: 10,                                                               
  distance: 3.0,                                                        
  thickness: 0.6,                                 
});

export function sanitizeMegaSettings(opts) {
  const o = opts || {};
  const d = ML_DEFAULTS;
  const num = (v, lo, hi, dv) =>
    Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : dv;
  return {
    strength: num(o.strength, 0, 1, d.strength),
    steps: Math.round(num(o.steps, 4, 16, d.steps)),
    distance: num(o.distance, 0.5, 8, d.distance),
    thickness: num(o.thickness, 0.05, 4, d.thickness),
  };
}


export function packMegaLights(lights, viewElements, out) {
  const e = viewElements;
  let n = 0;
  out.fill(0);
  if (!Array.isArray(lights) || !e) return 0;
  for (const l of lights) {
    if (n >= ML_MAX_LIGHTS) break;
    if (!l) continue;
    const range = Number(l.range) || 0;
    const inten = Number(l.intensity) || 0;
    if (range <= 0 || inten <= 0) continue;
    const x = Number(l.x) || 0;
    const y = Number(l.y) || 0;
    const z = Number(l.z) || 0;
    const o = n * 8;
    out[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    out[o + 3] = range;
    out[o + 4] = (Number(l.r) || 0) * inten;
    out[o + 5] = (Number(l.g) || 0) * inten;
    out[o + 6] = (Number(l.b) || 0) * inten;
    out[o + 7] = 0;
    n++;
  }
  return n;
}


export function mlWeightAt(light, px, py, pz) {
  const dx = (Number(light.x) || 0) - px;
  const dy = (Number(light.y) || 0) - py;
  const dz = (Number(light.z) || 0) - pz;
  const d2 = dx * dx + dy * dy + dz * dz;
  const r = Number(light.range) || 0;
  if (r <= 0 || d2 >= r * r) return 0;
  const lum =
    Math.max(Number(light.r) || 0, Number(light.g) || 0, Number(light.b) || 0) *
    (Number(light.intensity) || 0);
  const dr = Math.sqrt(d2) / r;
  const win = Math.max(0, 1 - dr * dr * dr * dr);
  return (lum * win * win) / Math.max(d2, 0.01);
}


export function reservoirPick(weights, rnds) {
  let wsum = 0;
  let pick = -1;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (!(w > 0)) continue;
    wsum += w;
    const r = rnds ? rnds[i] : Math.random();
    if (r * wsum <= w) pick = i;
  }
  return { pick, wsum };
}


export function mlShadowFactor(blocked, wsum, base, strength) {
  const st = strength === undefined || strength === null ? 1 : Number(strength) || 0;
  const s = Math.min(1, Math.max(0, (Number(blocked) || 0) * st));
  const ws = Math.max(0, Number(wsum) || 0);
  const b = Math.max(0.001, Number(base) || 0);
  if (ws <= 0) return 1;
  return 1 - s * (ws / (ws + b));
}


export function buildMegaLightsFrag() {
  return [
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform sampler2D tDiffuse;",
    "uniform sampler2D tDepth;",
    "uniform sampler2D tLights;",
    "uniform int uCount;",
    "uniform float uBase;",
    "uniform float uStrength;",
    "uniform float uSteps;",
    "uniform float uDistance;",
    "uniform float uThickness;",
    "uniform float uFrame;",
    "uniform mat4 uProj;",
    "uniform mat4 uInvProj;",
    "uniform float uNear;",
    "uniform float uFar;",
    "const float RSW_ML_W = " + ML_TEX_WIDTH.toFixed(1) + ";",
    buildMegaLightsDepthGlsl(),
    "vec3 rswViewPos(const in vec2 uv, const in float depthRaw) {",
    "  vec2 ndc = uv * 2.0 - 1.0;",
    "  vec4 t = uInvProj * vec4(ndc, -1.0, 1.0);",
    "  vec3 ray = t.xyz / t.w;",
    "  float vz = (uNear*uFar)/((uFar-uNear)*depthRaw - uFar);",
    "  return ray * (vz / ray.z);",
    "}",
    "vec4 rswLight(const in float texel) {",
    "  return texture2D(tLights, vec2((texel + 0.5) / RSW_ML_W, 0.5));",
    "}",
    "void main() {",
    "  vec4 base = texture2D(tDiffuse, vUv);",
    "  gl_FragColor = base;",
    "  if (uCount <= 0) return;",
    "  float dRaw = rswUnpack(texture2D(tDepth, vUv));",
    "  if (dRaw >= 0.9999) return;",
    "  vec2 depthGradient = rswDepthGradient(vUv, dRaw);",
    "  dRaw = rswAlignDepth(dRaw, vUv, depthGradient);",
    "  vec3 P = rswViewPos(vUv, dRaw);",
    "  float rnd0 = fract(52.9829189 * fract(dot(gl_FragCoord.xy + vec2(uFrame * 5.588238), vec2(0.06711056, 0.00583715))));",
    "  float wsum = 0.0;",
    "  vec3 lPos = vec3(0.0);",
    "  bool has = false;",
    "  for (int i = 0; i < " + String(ML_MAX_LIGHTS) + "; i++) {",
    "    if (i >= uCount) break;",
    "    vec4 t0 = rswLight(float(i * 2));",
    "    float r = t0.w;",
    "    vec3 dv = t0.xyz - P;",
    "    float d2 = dot(dv, dv);",
    "    if (r <= 0.0 || d2 >= r * r) continue;",
    "    vec4 t1 = rswLight(float(i * 2 + 1));",
    "    float lum = max(t1.x, max(t1.y, t1.z));",
    "    float dr = sqrt(d2) / r;",
    "    float win = clamp(1.0 - dr * dr * dr * dr, 0.0, 1.0);",
    "    float w = lum * win * win / max(d2, 0.01);",
    "    if (w < " + ML_WEIGHT_MIN.toFixed(6) + ") continue;",
    "    wsum += w;",
    "    float ri = fract(rnd0 + float(i) * " + ML_GOLDEN.toFixed(11) + ");",
    "    if (ri * wsum <= w) { has = true; lPos = t0.xyz; }",
    "  }",
    "  if (!has || wsum <= 0.0) return;",
    "  vec3 toL = lPos - P;",
    "  float dist = length(toL);",
    "  vec3 dir = toL / max(dist, 1e-4);",
    "  float maxT = min(dist - 0.05, uDistance);",
    "  if (maxT <= 0.02) return;",
    "  float blocked = 0.0;",
    "  for (int s = 0; s < 16; s++) {",
    "    if (float(s) >= uSteps) break;",
    "    float ft = pow((float(s) + rnd0) / uSteps, 1.35) * maxT;",               
    "    vec3 sp = P + dir * max(ft, 0.02);",
    "    vec4 q = uProj * vec4(sp, 1.0);",
    "    vec2 suv = q.xy / q.w * 0.5 + 0.5;",
    "    if (suv.x <= 0.0 || suv.x >= 1.0 || suv.y <= 0.0 || suv.y >= 1.0) break;",
    "    float dz = -rswTraceViewZ(suv, depthGradient);",
    "    float dd = -sp.z - dz;",
    "    if (dd > uThickness * 0.08 && dd < uThickness * 4.0) { blocked = 1.0; break; }",
    "  }",
    "  if (blocked <= 0.0) return;",
    "  vec2 eb = min(vUv, 1.0 - vUv);",
    "  float edge = clamp(min(eb.x, eb.y) / 0.08, 0.0, 1.0);",
    "  float f = 1.0 - clamp(blocked * uStrength * edge, 0.0, 1.0) * (wsum / (wsum + max(uBase, 0.001)));",
    "  gl_FragColor = vec4(base.rgb * f, base.a);",
    "}",
  ].join("\n");
}
