export const VOL_FOG_VERSION = "vol-fog-il-f18";

export const VOL_FOG_SCALE = 0.5;
export const VOL_FOG_MAX_LIGHTS = 4;
export const VOL_FOG_MIN_STEPS = 8;
export const VOL_FOG_MAX_STEPS = 24;
export const VOL_FOG_DEFAULT_STEPS = 20;
export const VOL_FOG_MAX_DIST = 900;


export const VOL_FOG_ALBEDO = 0.9;
export const VOL_FOG_ISO_PHASE = 0.0796;

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function volFogAutoOn(ctx) {
  return !!ctx && !ctx.weak;
}

export function resolveVolFogFlag(value, ctx) {
  if (value === true) return true;
  if (value === false) return false;
  return volFogAutoOn(ctx);
}


export function volFogDims(viewW, viewH, out) {
  const w = Math.max(1, Math.round(num(viewW, 1) * VOL_FOG_SCALE));
  const h = Math.max(1, Math.round(num(viewH, 1) * VOL_FOG_SCALE));
  const o = out || { w: 0, h: 0 };
  o.w = w;
  o.h = h;
  return o;
}


export function sanitizeVolFogSettings(s, out) {
  const src = s || {};
  const o = out || {};
  o.steps = Math.round(clampNum(num(src.steps, VOL_FOG_DEFAULT_STEPS), VOL_FOG_MIN_STEPS, VOL_FOG_MAX_STEPS));
  o.density = clampNum(num(src.density, 0.008), 0, 0.03);
  o.aniso = clampNum(num(src.aniso, 0.62), -0.9, 0.9);
  o.heightFalloff = clampNum(num(src.heightFalloff, 0.02), 0, 1);
  o.heightRef = clampNum(num(src.heightRef, 0), -1e6, 1e6);
  o.maxDist = clampNum(num(src.maxDist, VOL_FOG_MAX_DIST), 50, 4000);
  return o;
}


export const VF_BIAS_DEFAULT = 0.002;
export const VF_BIAS_MIN = 0.0002;
export const VF_BIAS_MAX = 0.02;
export function sanitizeVfCascadeBiases(raw, out) {
  const o = Array.isArray(out) ? out : [0, 0, 0, 0];
  const arr = Array.isArray(raw) ? raw : null;
  const one = !arr && raw !== null && raw !== undefined ? Number(raw) : NaN;
  for (let i = 0; i < 4; i++) {
    const v = arr ? Number(arr[i]) : one;
    o[i] = Number.isFinite(v) ? clampNum(v, VF_BIAS_MIN, VF_BIAS_MAX) : VF_BIAS_DEFAULT;
  }
  return o;
}


export function hgPhaseJs(g, cosT) {
  const gg = clampNum(num(g, 0), -0.99, 0.99);
  const c = clampNum(num(cosT, 0), -1, 1);
  const g2 = gg * gg;
  const den = Math.max(1 + g2 - 2 * gg * c, 1e-4);
  return (1 - g2) / (12.56637 * Math.pow(den, 1.5));
}


export function stepTransmittanceJs(sigmaT, dt) {
  return Math.exp(-Math.max(num(sigmaT, 0), 0) * Math.max(num(dt, 0), 0));
}


export function densityFromAtmosphereJs(density, haze) {
  const d = num(density, 0.395);
  const h = num(haze, 0);
  return clampNum(d * 0.012 + h * 0.0008, 0, 0.03);
}


export function integrateScatterJs(opts) {
  const o = opts || {};
  const steps = Math.max(1, Math.floor(num(o.steps, 1)));
  const dtRaw = num(o.dt, 1);
  const dt = dtRaw > 0 ? dtRaw : 1;
  const sigmaT = Math.max(num(o.sigmaT, 0), 0);
  const sigmaS = Math.max(num(o.sigmaS, sigmaT * VOL_FOG_ALBEDO), 0);
  const phase = Math.max(num(o.phase, VOL_FOG_ISO_PHASE), 0);
  const ambient = Math.max(num(o.ambient, 0), 0);
  const vis = typeof o.vis === "function" ? o.vis : function () { return 1; };
  let T = 1;
  let L = 0;
  for (let i = 0; i < steps; i++) {
    L += T * (Math.max(num(vis(i), 1), 0) * phase + ambient) * sigmaS * dt;
    T *= Math.exp(-sigmaT * dt);
  }
  return { inscatter: L, transmittance: T };
}


export function localInscatterJs(a, b, dist) {
  const bb = Math.max(num(b, 0), 1e-3);
  const aa = num(a, 0);
  const dd = Math.max(num(dist, 0), 0);
  return Math.max((Math.atan((dd - aa) / bb) - Math.atan(-aa / bb)) / bb, 0);
}


export function pickVolLightsJs(cands, cam, maxN, out) {
  const list = Array.isArray(cands) ? cands : [];
  const n = Math.max(0, Math.min(Math.floor(num(maxN, VOL_FOG_MAX_LIGHTS)), VOL_FOG_MAX_LIGHTS));
  const res = out || [];
  res.length = 0;
  const cx = num(cam && cam.x, 0);
  const cy = num(cam && cam.y, 0);
  const cz = num(cam && cam.z, 0);
  for (let k = 0; k < n; k++) {
    let best = null;
    let bestW = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || res.indexOf(c) !== -1) continue;
      const dx = num(c.x, 0) - cx;
      const dy = num(c.y, 0) - cy;
      const dz = num(c.z, 0) - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const range = num(c.range, 0) > 0 ? num(c.range, 0) : 60;
      const w = Math.max(num(c.intensity, 0), 0) * range / (1 + dist);
      if (w > bestW) {
        bestW = w;
        best = c;
      }
    }
    if (!best) break;
    res.push(best);
  }
  return res;
}


export const VOL_FOG_PASS_VERT = [
  "varying vec2 vUv;",
  "void main() {",
  "  vUv = uv;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");


export function buildVolFogMarchGlsl() {
  return [
    "uniform sampler2D tDepth;",
    "uniform mat4 uInvViewProj;",
    "uniform vec3 uCamPos;",
    "uniform vec3 uSunDir;",
    "uniform vec3 uSunColor;",
    "uniform vec3 uAmbColor;",
    "uniform float uDensity;",
    "uniform float uAniso;",
    "uniform float uHeightFalloff;",
    "uniform float uHeightRef;",
    "uniform float uSteps;",
    "uniform float uJitter;",
    "uniform float uMaxDist;",
    "uniform float uShadowOn;",
    "uniform sampler2D uMaskMap0;",
    "uniform sampler2D uMaskMap1;",
    "uniform sampler2D uMaskMap2;",
    "uniform sampler2D uMaskMap3;",
    "uniform mat4 uMaskMtx0;",
    "uniform mat4 uMaskMtx1;",
    "uniform mat4 uMaskMtx2;",
    "uniform mat4 uMaskMtx3;",
    "uniform vec4 uMaskBias;",
    "uniform float uMaskCount;",
    "uniform vec4 uVolLightPosR[4];",
    "uniform vec4 uVolLightColI[4];",
    "uniform float uVolLightCount;",
    "varying vec2 vUv;",


    "float rswVfUnpack(const in vec4 v) {",
    "  const vec4 f = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);",
    "  return dot(v, f);",
    "}",


    "float rswVfIgn(const in vec2 p) {",
    "  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));",
    "}",

    "float rswVfPhase(const in float g, const in float cosT) {",
    "  float g2 = g * g;",
    "  float den = 1.0 + g2 - 2.0 * g * cosT;",
    "  return (1.0 - g2) / (12.56637 * pow(max(den, 1e-4), 1.5));",
    "}",


    "float rswVfTap(sampler2D map, const in mat4 mtx, const in float bias, const in vec3 wp) {",
    "  float r = -1.0;",
    "  vec4 sc = mtx * vec4(wp, 1.0);",
    "  vec3 pp = sc.xyz / max(abs(sc.w), 1e-8);",
    "  if (pp.x > 0.02 && pp.x < 0.98 && pp.y > 0.02 && pp.y < 0.98 && pp.z > 0.0 && pp.z < 1.0) {",
    "    float d = rswVfUnpack(texture2D(map, pp.xy));",
    "    r = (pp.z - bias) > d ? 0.0 : 1.0;",
    "  }",
    "  return r;",
    "}",


    "float rswVfSunVis(const in vec3 wp) {",
    "  float vis = 1.0;",
    "  if (uShadowOn > 0.5) {",
    "    float r = -1.0;",
    "    if (uMaskCount > 0.5) { r = rswVfTap(uMaskMap0, uMaskMtx0, uMaskBias.x, wp); }",
    "    if (r < -0.5 && uMaskCount > 1.5) { r = rswVfTap(uMaskMap1, uMaskMtx1, uMaskBias.y, wp); }",
    "    if (r < -0.5 && uMaskCount > 2.5) { r = rswVfTap(uMaskMap2, uMaskMtx2, uMaskBias.z, wp); }",
    "    if (r < -0.5 && uMaskCount > 3.5) { r = rswVfTap(uMaskMap3, uMaskMtx3, uMaskBias.w, wp); }",
    "    if (r > -0.5) { vis = r; }",
    "  }",
    "  return vis;",
    "}",
    "void main() {",
    "  float d = rswVfUnpack(texture2D(tDepth, vUv));",
    "  vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);",
    "  vec4 wp4 = uInvViewProj * ndc;",
    "  float wpw = wp4.w;",
    "  if (abs(wpw) < 1e-8) { wpw = 1e-8; }",
    "  vec3 wp = wp4.xyz / wpw;",
    "  vec3 rv = wp - uCamPos;",
    "  float distRaw = max(length(rv), 1e-4);",
    "  float dist = min(distRaw, uMaxDist);",
    "  if (d >= 0.9999) { dist = uMaxDist; }",
    "  vec3 dir = rv / distRaw;",
    "  float stepsF = clamp(uSteps, 8.0, 24.0);",
    "  float dt = dist / stepsF;",
    "  float jit = fract(rswVfIgn(gl_FragCoord.xy) + uJitter);",
    "  float ph = rswVfPhase(uAniso, dot(dir, uSunDir));",
    "  vec3 acc = vec3(0.0);",
    "  float T = 1.0;",
    "  float t = dt * jit;",
    "  for (int i = 0; i < 24; i++) {",
    "    if (float(i) >= stepsF) { break; }",
    "    vec3 sp = uCamPos + dir * t;",
    "    float hf = exp(-max(sp.y - uHeightRef, 0.0) * uHeightFalloff);",
    "    float sigmaT = uDensity * hf;",
    "    float vis = rswVfSunVis(sp);",


    "    acc += (uSunColor * (vis * ph) + uAmbColor) * (T * sigmaT * 0.9 * dt);",
    "    T *= exp(-sigmaT * dt);",
    "    t += dt;",
    "    if (T < 0.004) { break; }",
    "  }",


    "  vec3 accL = vec3(0.0);",
    "  for (int j = 0; j < 4; j++) {",
    "    if (float(j) >= uVolLightCount) { break; }",
    "    vec4 pr = uVolLightPosR[j];",
    "    vec4 ci = uVolLightColI[j];",
    "    vec3 lp = pr.xyz - uCamPos;",
    "    float a = dot(lp, dir);",
    "    float b2 = max(dot(lp, lp) - a * a, 1e-3);",
    "    float b = sqrt(b2);",
    "    float integ = max((atan((dist - a) / b) - atan(-a / b)) / b, 0.0);",
    "    float win = clamp(1.0 - b / max(pr.w, 1e-3), 0.0, 1.0);",
    "    accL += ci.rgb * (ci.a * uDensity * 0.9 * 0.0796 * integ * win);",
    "  }",
    "  float tAvg = (1.0 + T) * 0.5;",
    "  gl_FragColor = vec4(acc + accL * tAvg, T);",
    "}",
  ].join("\n");
}






export function buildVolFogCompositeGlsl() {
  return [
    "uniform sampler2D tDiffuse;",
    "uniform sampler2D tFog;",
    "uniform sampler2D tFogRaw;",
    "varying vec2 vUv;",
    "void main() {",
    "  vec4 scene = texture2D(tDiffuse, vUv);",
    "  vec3 fog = texture2D(tFog, vUv).rgb;",
    "  float T = texture2D(tFogRaw, vUv).a;",
    "  if (!(T >= 0.0 && T <= 1.0)) { T = 1.0; }",
    "  if (!(fog.x >= 0.0)) { fog.x = 0.0; }",
    "  if (!(fog.y >= 0.0)) { fog.y = 0.0; }",
    "  if (!(fog.z >= 0.0)) { fog.z = 0.0; }",


    "  fog = min(fog, vec3(60000.0));",
    "  gl_FragColor = vec4(scene.rgb * T + fog, scene.a);",
    "}",
  ].join("\n");
}
