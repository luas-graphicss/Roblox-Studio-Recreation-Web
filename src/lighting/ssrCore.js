export const SSR_VERSION = "ssr-il-f21";

export const SSR_SCALE = 0.5;
export const SSR_MIN_STEPS = 8;
export const SSR_MAX_STEPS = 24;
export const SSR_DEFAULT_STEPS = 20;

export const SSR_REFINE_STEPS = 4;

export const SSR_MIP_MAX = 4;

export const SSR_F0 = 0.04;

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function ssrAutoOn(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : null;
  return c !== null && c.weak !== true;
}

export function resolveSsrFlag(value, ctx) {
  if (value === true) return true;
  if (value === false) return false;
  return ssrAutoOn(ctx);
}


export function ssrDims(viewW, viewH, out) {
  const w = Math.max(1, Math.round(num(viewW, 1) * SSR_SCALE));
  const h = Math.max(1, Math.round(num(viewH, 1) * SSR_SCALE));
  const o = out || { w: 0, h: 0 };
  o.w = w;
  o.h = h;
  return o;
}


export function sanitizeSsrSettings(s, out) {
  const src = s || {};
  const o = out || {};
  o.steps = Math.round(clampNum(num(src.steps, SSR_DEFAULT_STEPS), SSR_MIN_STEPS, SSR_MAX_STEPS));
  o.thickness = clampNum(num(src.thickness, 1.8), 0.05, 50);
  o.maxDist = clampNum(num(src.maxDist, 260), 20, 2000);
  o.intensity = clampNum(num(src.intensity, 0.85), 0, 1);
  o.rough = clampNum(num(src.rough, 0.12), 0, 1);
  o.maxRough = clampNum(num(src.maxRough, 0.6), 0.05, 1);
  o.edgeMargin = clampNum(num(src.edgeMargin, 0.08), 0.01, 0.25);
  o.backSoft = clampNum(num(src.backSoft, 0.35), 0.05, 1);
  return o;
}


export function smoothstepJs(e0, e1, x) {
  const den = e1 - e0;
  const t = clampNum(den !== 0 ? (num(x, 0) - e0) / den : 0, 0, 1);
  return t * t * (3 - 2 * t);
}


export function viewZFromDepthJs(d01, p22, p32) {
  const ndc = num(d01, 1) * 2 - 1;
  let den = ndc + num(p22, -1);
  if (Math.abs(den) < 1e-8) den = 1e-8;
  return -num(p32, -0.2) / den;
}


export function projectToUvJs(p, pe) {
  const x = num(p && p[0], 0);
  const y = num(p && p[1], 0);
  const z = num(p && p[2], 0);
  const cx = pe[0] * x + pe[4] * y + pe[8] * z + pe[12];
  const cy = pe[1] * x + pe[5] * y + pe[9] * z + pe[13];
  const cw = pe[3] * x + pe[7] * y + pe[11] * z + pe[15];
  const w = Math.max(cw, 1e-6);
  return { u: (cx / w) * 0.5 + 0.5, v: (cy / w) * 0.5 + 0.5, w: cw };
}


export function edgeFadeJs(u, v, margin) {
  const m = Math.max(num(margin, 0.08), 1e-4);
  const b = Math.min(Math.min(num(u, 0), 1 - num(u, 0)), Math.min(num(v, 0), 1 - num(v, 0)));
  const s = clampNum(b / m, 0, 1);
  return s * s * (3 - 2 * s);
}


export function backfaceFadeJs(rz, soft) {
  return 1 - smoothstepJs(0, Math.max(num(soft, 0.35), 1e-4), num(rz, 0));
}


export function distFadeJs(t, maxDist) {
  const md = Math.max(num(maxDist, 260), 1e-4);
  return clampNum(1 - num(t, 0) / md, 0, 1);
}


export function fresnelJs(cosT, f0) {
  const c = clampNum(num(cosT, 0), 0, 1);
  const f = clampNum(num(f0, SSR_F0), 0, 1);
  return f + (1 - f) * Math.pow(1 - c, 5);
}


export function roughToMipJs(rough, mipMax) {
  return clampNum(num(rough, 0), 0, 1) * clampNum(num(mipMax, SSR_MIP_MAX), 0, 8);
}


export function roughWindowJs(rough, maxRough) {
  const mr = Math.max(num(maxRough, 0.6), 1e-3);
  return clampNum(1 - clampNum(num(rough, 0), 0, 1) / mr, 0, 1);
}


export function roughPixelJs(roughUniform, sceneAlpha, perPixelOn) {
  const a = clampNum(num(sceneAlpha, 1), 0, 1);
  const valid = a <= 0.999 ? 1 : 0;
  const t = clampNum(num(perPixelOn, 0), 0, 1) * valid;
  const base = clampNum(num(roughUniform, 0), 0, 1);
  return base * (1 - t) + a * t;
}


export function ssrMarchJs(opts) {
  const o = opts || {};
  const ro = o.origin || [0, 0, 0];
  const rd = o.dir || [0, 0, -1];
  const pe = o.proj;
  const dp = o.depthP || {};
  const sample = typeof o.sampleDepth01 === "function" ? o.sampleDepth01 : function () { return 1; };
  const steps = Math.round(clampNum(num(o.steps, SSR_DEFAULT_STEPS), SSR_MIN_STEPS, SSR_MAX_STEPS));
  const refine = Math.max(0, Math.floor(num(o.refineSteps, SSR_REFINE_STEPS)));
  const thickness = Math.max(num(o.thickness, 1.8), 1e-4);
  const maxDist = Math.max(num(o.maxDist, 260), 1e-3);
  const jitter = clampNum(num(o.jitter, 0), 0, 0.999999);
  const dt = maxDist / steps;
  let t = dt * jitter + 0.05;
  let prevT = 0;
  let used = 0;
  const res = { hit: false, t: -1, u: 0, v: 0, steps: 0 };
  for (let i = 0; i < SSR_MAX_STEPS; i++) {
    if (i >= steps) break;
    used = i + 1;
    const spx = ro[0] + rd[0] * t;
    const spy = ro[1] + rd[1] * t;
    const spz = ro[2] + rd[2] * t;
    if (spz > -0.05) break;                                  
    const pr = projectToUvJs([spx, spy, spz], pe);
    if (pr.u < 0 || pr.u > 1 || pr.v < 0 || pr.v > 1) break;
    const sd = sample(pr.u, pr.v);
    const sceneZ = viewZFromDepthJs(sd, dp.p22, dp.p32);
    const dz = sceneZ - spz;                                            
    if (dz > 0 && sd < 0.9999) {


      let lo = prevT;
      let hi = t;
      for (let j = 0; j < refine; j++) {
        const mid = (lo + hi) * 0.5;
        const mx = ro[0] + rd[0] * mid;
        const my = ro[1] + rd[1] * mid;
        const mz = ro[2] + rd[2] * mid;
        const mp = projectToUvJs([mx, my, mz], pe);
        const msd = sample(mp.u, mp.v);
        if (viewZFromDepthJs(msd, dp.p22, dp.p32) - mz > 0) hi = mid;
        else lo = mid;
      }
      const hx = ro[0] + rd[0] * hi;
      const hy = ro[1] + rd[1] * hi;
      const hz = ro[2] + rd[2] * hi;
      const hp = projectToUvJs([hx, hy, hz], pe);
      const hd = sample(hp.u, hp.v);
      const hdz = viewZFromDepthJs(hd, dp.p22, dp.p32) - hz;
      if (hdz >= 0 && hdz < thickness && hd < 0.9999) {
        res.hit = true;
        res.t = hi;
        res.u = hp.u;
        res.v = hp.v;
        res.steps = used;
        return res;
      }
    }
    prevT = t;
    t += dt;
  }
  res.steps = used;
  return res;
}


export const SSR_PASS_VERT = [
  "varying vec2 vUv;",
  "void main() {",
  "  vUv = uv;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");


export function buildSsrMarchGlsl() {
  return [
    "uniform sampler2D tDepth;",
    "uniform sampler2D tScene;",
    "uniform mat4 uProj;",
    "uniform mat4 uInvProj;",
    "uniform vec2 uDepthP;",                              
    "uniform vec2 uTexel;",                                         
    "uniform float uSteps;",
    "uniform float uThickness;",
    "uniform float uMaxDist;",
    "uniform float uJitter;",
    "uniform float uRough;",
    "uniform float uRoughPx;",                                                         
    "uniform float uMaxRough;",
    "uniform float uMipMax;",
    "uniform float uEdgeMargin;",
    "uniform float uBackSoft;",
    "uniform float uF0;",
    "varying vec2 vUv;",


    "float rswSsrUnpack(const in vec4 v) {",
    "  const vec4 f = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);",
    "  return dot(v, f);",
    "}",

    "float rswSsrIgn(const in vec2 p) {",
    "  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));",
    "}",

    "float rswSsrViewZ(const in float d01) {",
    "  float ndc = d01 * 2.0 - 1.0;",
    "  float den = ndc + uDepthP.x;",
    "  if (abs(den) < 1e-8) { den = 1e-8; }",
    "  return -uDepthP.y / den;",
    "}",

    "vec3 rswSsrPos(const in vec2 uv, const in float d01) {",
    "  vec4 ndc = vec4(uv * 2.0 - 1.0, d01 * 2.0 - 1.0, 1.0);",
    "  vec4 vp = uInvProj * ndc;",
    "  float w = vp.w;",
    "  if (abs(w) < 1e-8) { w = 1e-8; }",
    "  return vp.xyz / w;",
    "}",

    "vec3 rswSsrNormal(const in vec2 uv, const in vec3 pC) {",
    "  vec2 uvR = uv + vec2(uTexel.x, 0.0);",
    "  vec2 uvD = uv + vec2(0.0, uTexel.y);",
    "  vec3 pR = rswSsrPos(uvR, rswSsrUnpack(texture2D(tDepth, uvR)));",
    "  vec3 pD = rswSsrPos(uvD, rswSsrUnpack(texture2D(tDepth, uvD)));",
    "  vec3 n = cross(pR - pC, pD - pC);",
    "  float len = max(length(n), 1e-8);",
    "  n /= len;",
    "  if (dot(n, pC) > 0.0) { n = -n; }",                          
    "  return n;",
    "}",

    "float rswSsrEdge(const in vec2 uv) {",
    "  float m = max(uEdgeMargin, 1e-4);",
    "  float b = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));",
    "  float s = clamp(b / m, 0.0, 1.0);",
    "  return s * s * (3.0 - 2.0 * s);",
    "}",
    "void main() {",
    "  float d = rswSsrUnpack(texture2D(tDepth, vUv));",
    "  if (d >= 0.9999) { gl_FragColor = vec4(0.0); return; }",       
    "  vec3 pC = rswSsrPos(vUv, d);",
    "  vec3 V = normalize(pC);",
    "  vec3 n = rswSsrNormal(vUv, pC);",
    "  vec3 rd = normalize(reflect(V, n));",
    "  float back = 1.0 - smoothstep(0.0, uBackSoft, rd.z);",


    "  float rswSceneA = clamp(texture2D(tScene, vUv).a, 0.0, 1.0);",
    "  float rswRoughPix = mix(clamp(uRough, 0.0, 1.0), rswSceneA, clamp(uRoughPx, 0.0, 1.0) * step(rswSceneA, 0.999));",
    "  float roughW = clamp(1.0 - rswRoughPix / max(uMaxRough, 1e-3), 0.0, 1.0);",
    "  if (back * roughW <= 0.001) { gl_FragColor = vec4(0.0); return; }",
    "  float stepsF = clamp(uSteps, 8.0, 24.0);",
    "  float dt = uMaxDist / stepsF;",
    "  float jit = fract(rswSsrIgn(gl_FragCoord.xy) + uJitter);",
    "  float t = dt * jit + 0.05;",
    "  float prevT = 0.0;",
    "  float hitT = -1.0;",
    "  for (int i = 0; i < 24; i++) {",
    "    if (float(i) >= stepsF) { break; }",
    "    vec3 sp = pC + rd * t;",
    "    if (sp.z > -0.05) { break; }",
    "    vec4 clipP = uProj * vec4(sp, 1.0);",
    "    float w = max(clipP.w, 1e-6);",
    "    vec2 uv = clipP.xy / w * 0.5 + 0.5;",
    "    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }",
    "    float sd = rswSsrUnpack(texture2D(tDepth, uv));",
    "    float sceneZ = rswSsrViewZ(sd);",
    "    float dz = sceneZ - sp.z;",
    "    if (dz > 0.0 && sd < 0.9999) {",


    "      float lo = prevT;",
    "      float hi = t;",
    "      for (int j = 0; j < 4; j++) {",
    "        float mid = (lo + hi) * 0.5;",
    "        vec3 mp = pC + rd * mid;",
    "        vec4 mclip = uProj * vec4(mp, 1.0);",
    "        float mw = max(mclip.w, 1e-6);",
    "        vec2 muv = mclip.xy / mw * 0.5 + 0.5;",
    "        float msd = rswSsrUnpack(texture2D(tDepth, muv));",
    "        if (rswSsrViewZ(msd) - mp.z > 0.0) { hi = mid; } else { lo = mid; }",
    "      }",
    "      vec3 hp0 = pC + rd * hi;",
    "      vec4 hclip0 = uProj * vec4(hp0, 1.0);",
    "      float hw0 = max(hclip0.w, 1e-6);",
    "      vec2 huv0 = hclip0.xy / hw0 * 0.5 + 0.5;",
    "      float hd0 = rswSsrUnpack(texture2D(tDepth, huv0));",
    "      float hdz = rswSsrViewZ(hd0) - hp0.z;",
    "      if (hdz >= 0.0 && hdz < uThickness && hd0 < 0.9999) {",
    "        hitT = hi;",
    "        break;",
    "      }",
    "    }",
    "    prevT = t;",
    "    t += dt;",
    "  }",
    "  if (hitT < 0.0) { gl_FragColor = vec4(0.0); return; }",
    "  vec3 hp = pC + rd * hitT;",
    "  vec4 hclip = uProj * vec4(hp, 1.0);",
    "  float hw = max(hclip.w, 1e-6);",
    "  vec2 hitUv = hclip.xy / hw * 0.5 + 0.5;",

    "  vec3 col = texture2D(tScene, hitUv, rswRoughPix * uMipMax).rgb;",
    "  float edge = rswSsrEdge(hitUv);",
    "  float df = clamp(1.0 - hitT / uMaxDist, 0.0, 1.0);",
    "  float cosT = clamp(dot(-V, n), 0.0, 1.0);",
    "  float fr = uF0 + (1.0 - uF0) * pow(1.0 - cosT, 5.0);",
    "  float conf = edge * back * df * fr * roughW;",

    "  if (!(conf >= 0.0)) { conf = 0.0; }",
    "  if (!(col.x >= 0.0)) { col.x = 0.0; }",
    "  if (!(col.y >= 0.0)) { col.y = 0.0; }",
    "  if (!(col.z >= 0.0)) { col.z = 0.0; }",
    "  gl_FragColor = vec4(col, clamp(conf, 0.0, 1.0));",
    "}",
  ].join("\n");
}



export function buildSsrCompositeGlsl() {
  return [
    "uniform sampler2D tDiffuse;",
    "uniform sampler2D tSsr;",
    "uniform float uIntensity;",
    "varying vec2 vUv;",
    "void main() {",
    "  vec4 scene = texture2D(tDiffuse, vUv);",
    "  vec4 s = texture2D(tSsr, vUv);",
    "  float w = clamp(s.a, 0.0, 1.0) * clamp(uIntensity, 0.0, 1.0);",
    "  if (!(w >= 0.0 && w <= 1.0)) { w = 0.0; }",
    "  if (!(s.x >= 0.0)) { s.x = 0.0; }",
    "  if (!(s.y >= 0.0)) { s.y = 0.0; }",
    "  if (!(s.z >= 0.0)) { s.z = 0.0; }",
    "  gl_FragColor = vec4(scene.rgb * (1.0 - w) + s.rgb * w, scene.a);",
    "}",
  ].join("\n");
}


export function buildSsrTemporalGlsl() {
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
    "varying vec2 vUv;",
    "float rswSsrTUnpackDepth(const in vec4 v) {",
    "  const vec4 f = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);",
    "  return dot(v, f);",
    "}",
    "vec3 rswSsrTDecode(const in vec3 h) {",
    "  return mix(h, h * h * uByteRange, uByteEnc);",
    "}",
    "vec4 rswSsrTOut(const in vec4 c) {",
    "  vec3 e = sqrt(clamp(c.rgb, vec3(0.0), vec3(uByteRange)) / uByteRange);",
    "  return vec4(mix(c.rgb, e, uByteEnc), c.a);",
    "}",
    "void main() {",
    "  vec4 cur = texture2D(tCurrent, vUv);",
    "  if (uHistoryValid < 0.5 || uAlpha >= 0.999) {",
    "    gl_FragColor = rswSsrTOut(cur);",
    "    return;",
    "  }",
    "  float d = rswSsrTUnpackDepth(texture2D(tDepth, vUv));",
    "  vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);",
    "  vec4 wp = uInvViewProj * ndc;",
    "  if (abs(wp.w) < 1e-8) {",
    "    gl_FragColor = rswSsrTOut(cur);",
    "    return;",
    "  }",
    "  vec4 pc = uPrevViewProj * vec4(wp.xyz / wp.w, 1.0);",
    "  if (pc.w <= 1e-6) {",
    "    gl_FragColor = rswSsrTOut(cur);",
    "    return;",
    "  }",
    "  vec2 prevUv = (pc.xy / pc.w) * 0.5 + 0.5;",
    "  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {",
    "    gl_FragColor = rswSsrTOut(cur);",
    "    return;",
    "  }",


    "  float rswVel = length((prevUv - vUv) / uTexel);",
    "  float rswA = max(uAlpha, min(0.6, rswVel * 0.3));",
    "  vec4 nMin = cur;",
    "  vec4 nMax = cur;",
    "  for (int dy = -1; dy <= 1; dy++) {",
    "    for (int dx = -1; dx <= 1; dx++) {",
    "      if (dx == 0 && dy == 0) continue;",
    "      vec4 s = texture2D(tCurrent, vUv + vec2(float(dx), float(dy)) * uTexel);",
    "      nMin = min(nMin, s);",
    "      nMax = max(nMax, s);",
    "    }",
    "  }",
    "  vec4 histT = texture2D(tHistory, prevUv);",
    "  vec3 hist = clamp(rswSsrTDecode(histT.rgb), nMin.rgb, nMax.rgb);",
    "  float ha = clamp(histT.a, nMin.a, nMax.a);",
    "  gl_FragColor = rswSsrTOut(vec4(mix(hist, cur.rgb, rswA), mix(ha, cur.a, rswA)));",
    "}",
  ].join("\n");
}
