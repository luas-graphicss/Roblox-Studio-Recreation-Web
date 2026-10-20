export const FILMFX_VERSION = 1;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}


export const CA_MAX_UV = 0.02;

export const FX_UNIFORM_EPS = 0.0001;


export const GRAIN_BASE = 0.085;
export const GRAIN_FLOOR = 0.25;
export const GRAIN_LUMA_FALLOFF = 2.5;

export const GRAIN_STEP_X = 17;
export const GRAIN_STEP_Y = 29;
export const GRAIN_FRAME_WRAP = 4096;


export const IGN_SCALE = 52.9829189;
export const IGN_X = 0.06711056;
export const IGN_Y = 0.00583715;


export const MB_TAPS = 8;
export const MB_SHUTTER_DEFAULT = 0.5;
export const MB_MAX_UV = 0.04;


export const FILMFX_COST = Object.freeze({
  ca: "2 taps extras no pass final (só com força > 0; força 0 = 1 tap, byte a byte)",
  grain: "~8 ALU no pass final (só com força > 0; 0 = ramo desviado)",
  mb: "1 fullscreen de 8 taps + depth compartilhado (Parte 162) — só em Play/foto ou forçado",
  taa: "2 blits full-res + 2 RTs FP16 de história (opt-in; perfil fraco VETA)",
});


export function sanitizeFilmStrength(raw) {
  const v = num(raw, 0);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}


export function caOffsetJs(u, v, amt, out) {
  const o = out || [0, 0];
  const a = sanitizeFilmStrength(amt);
  const dx = num(u, 0.5) - 0.5;
  const dy = num(v, 0.5) - 0.5;
  const scale = (dx * dx + dy * dy) * a * CA_MAX_UV;
  o[0] = dx * scale;
  o[1] = dy * scale;
  return o;
}


export function ignJs(x, y) {
  const d = IGN_X * num(x, 0) + IGN_Y * num(y, 0);
  const f = d - Math.floor(d);
  const s = IGN_SCALE * f;
  return s - Math.floor(s);
}


export function grainNoiseAt(x, y, frame) {
  const fr = num(frame, 0);
  return ignJs(num(x, 0) + fr * GRAIN_STEP_X, num(y, 0) + fr * GRAIN_STEP_Y);
}


export function grainAmpJs(luma, amt) {
  const a = sanitizeFilmStrength(amt);
  const l = Math.max(num(luma, 0), 0);
  return a * GRAIN_BASE * (GRAIN_FLOOR + (1 - GRAIN_FLOOR) * Math.exp(-GRAIN_LUMA_FALLOFF * l));
}


export function grainApplyJs(rgb, noise, amt) {
  const r = num(rgb && rgb[0], 0);
  const g = num(rgb && rgb[1], 0);
  const b = num(rgb && rgb[2], 0);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const gr = (num(noise, 0.5) - 0.5) * 2 * grainAmpJs(luma, amt);
  return [Math.max(r + gr, 0), Math.max(g + gr, 0), Math.max(b + gr, 0)];
}


export function mbTapT(i) {
  const k = Math.max(0, Math.min(MB_TAPS - 1, Math.floor(num(i, 0))));
  return (k - (MB_TAPS - 1) / 2) / (MB_TAPS - 1);
}


export function mbClampVelJs(vx, vy, maxUv, out) {
  const o = out || [0, 0];
  const mx = Math.max(num(maxUv, MB_MAX_UV), 0);
  let x = num(vx, 0);
  let y = num(vy, 0);
  const len = Math.sqrt(x * x + y * y);
  if (len > mx && len > 0) {
    x *= mx / len;
    y *= mx / len;
  }
  o[0] = x;
  o[1] = y;
  return o;
}









export function resolveMotionBlur(flag, env, out) {
  const o = out || { on: false, reason: "" };
  const weak = !!(env && env.weak);
  const micro = !!(env && env.tier === "micro");
  if (flag === false) {
    o.on = false;
    o.reason = "veto";
    return o;
  }
  if (flag === true) {
    if (weak && micro) {
      o.on = false;
      o.reason = "weak-micro";
      return o;
    }
    o.on = true;
    o.reason = "forced";
    return o;
  }
  if (weak) {
    o.on = false;
    o.reason = "auto-weak";
    return o;
  }
  if (!env || !(env.play || env.photo)) {
    o.on = false;
    o.reason = "auto-edit";
    return o;
  }
  o.on = true;
  o.reason = env.play ? "auto-play" : "auto-photo";
  return o;
}

export function resolveTaa(flag, env, out) {
  const o = out || { on: false, reason: "" };
  const weak = !!(env && env.weak);
  if (flag === false) {
    o.on = false;
    o.reason = "veto";
    return o;
  }
  if (weak) {
    o.on = false;
    o.reason = "weak";
    return o;
  }
  if (flag === true) {
    o.on = true;
    o.reason = "forced";
    return o;
  }
  o.on = true;
  o.reason = "auto-strong";
  return o;
}


const mbScratch = { on: false, reason: "" };
const taaScratch = { on: false, reason: "" };


export function filmFxPlan(src, out) {
  const s = src || {};
  const o = out || {
    ca: 0, grain: 0, mbOn: false, mbReason: "", taaOn: false, taaReason: "",
    shutter: MB_SHUTTER_DEFAULT, maxUv: MB_MAX_UV, taps: MB_TAPS,
    anyFinal: false, active: false,
  };
  const mb = resolveMotionBlur(s.mbFlag === undefined ? null : s.mbFlag, s, mbScratch);
  const taa = resolveTaa(s.taaFlag === undefined ? null : s.taaFlag, s, taaScratch);
  o.ca = sanitizeFilmStrength(s.ca);
  o.grain = sanitizeFilmStrength(s.grain);
  o.mbOn = mb.on;
  o.mbReason = mb.reason;
  o.taaOn = taa.on;
  o.taaReason = taa.reason;
  o.shutter = MB_SHUTTER_DEFAULT;
  o.maxUv = MB_MAX_UV;
  o.taps = MB_TAPS;
  o.anyFinal = o.ca > 0 || o.grain > 0;
  o.active = o.anyFinal || o.mbOn || o.taaOn;
  return o;
}


export function buildFilmFinalGlsl() {
  return [
    "// IL-F32 (filmFxCore): CA + film grain — espelhos JS 1:1 no núcleo.",
    "vec3 rswFxCaFetch(sampler2D rswFxTex, vec2 rswFxUv, float rswFxAmt) {",
    "  vec2 rswFxDir = rswFxUv - vec2(0.5);",
    `  vec2 rswFxOff = rswFxDir * dot(rswFxDir, rswFxDir) * rswFxAmt * ${CA_MAX_UV};`,
    "  float rswFxR = texture2D(rswFxTex, rswFxUv + rswFxOff).r;",
    "  float rswFxG = texture2D(rswFxTex, rswFxUv).g;",
    "  float rswFxB = texture2D(rswFxTex, rswFxUv - rswFxOff).b;",
    "  return vec3(rswFxR, rswFxG, rswFxB);",
    "}",
    "float rswFxIgn(vec2 rswFxP) {",
    `  return fract(${IGN_SCALE} * fract(dot(rswFxP, vec2(${IGN_X}, ${IGN_Y}))));`,
    "}",
    "float rswFxGrainAmp(float rswFxLuma, float rswFxAmt) {",
    `  return rswFxAmt * ${GRAIN_BASE} * (${GRAIN_FLOOR} + ${1 - GRAIN_FLOOR} * exp(-${GRAIN_LUMA_FALLOFF} * max(rswFxLuma, 0.0)));`,
    "}",
    "vec3 rswFxGrainApply(vec3 rswFxC, vec2 rswFxPx, float rswFxAmt, float rswFxFrame) {",
    `  float rswFxN = rswFxIgn(rswFxPx + vec2(rswFxFrame * ${GRAIN_STEP_X.toFixed(1)}, rswFxFrame * ${GRAIN_STEP_Y.toFixed(1)}));`,
    "  float rswFxLuma = dot(rswFxC, vec3(0.2126, 0.7152, 0.0722));",
    "  float rswFxG = (rswFxN - 0.5) * 2.0 * rswFxGrainAmp(rswFxLuma, rswFxAmt);",
    "  return max(rswFxC + vec3(rswFxG), vec3(0.0));",
    "}",
  ].join("\n");
}





export function buildMotionBlurGlsl() {
  const half = ((MB_TAPS - 1) / 2).toFixed(1);
  const span = (MB_TAPS - 1).toFixed(1);
  return [
    "uniform sampler2D tDiffuse;",
    "uniform sampler2D tDepth;",
    "uniform mat4 uInvViewProj;",
    "uniform mat4 uPrevViewProj;",
    "uniform float uShutter;",
    "uniform float uMaxUv;",
    "uniform float uHistoryValid;",
    "varying vec2 vUv;",
    "float rswMbUnpackDepth(const in vec4 v) {",
    "  const vec4 f = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);",
    "  return dot(v, f);",
    "}",
    "void main() {",
    "  vec4 rswMbBase = texture2D(tDiffuse, vUv);",
    "  vec3 rswMbOut = rswMbBase.rgb;",
    "  float rswMbD = rswMbUnpackDepth(texture2D(tDepth, vUv));",
    "  // 1º frame / shutter 0 / céu (depth=1): identidade — ramo desviado.",
    "  if (uHistoryValid > 0.5 && uShutter > 0.0 && rswMbD < 0.9999) {",
    "    vec4 rswMbNdc = vec4(vUv * 2.0 - 1.0, rswMbD * 2.0 - 1.0, 1.0);",
    "    vec4 rswMbWp = uInvViewProj * rswMbNdc;",
    "    if (abs(rswMbWp.w) > 1e-8) {",
    "      vec4 rswMbPc = uPrevViewProj * vec4(rswMbWp.xyz / rswMbWp.w, 1.0);",
    "      if (rswMbPc.w > 1e-6) {",
    "        vec2 rswMbPrevUv = (rswMbPc.xy / rswMbPc.w) * 0.5 + 0.5;",
    "        vec2 rswMbVel = (vUv - rswMbPrevUv) * uShutter;",
    "        float rswMbVlen = length(rswMbVel);",
    "        if (rswMbVlen > 1e-5) {",
    "          if (rswMbVlen > uMaxUv) rswMbVel *= uMaxUv / rswMbVlen;",
    "          vec3 rswMbAcc = vec3(0.0);",
    "          float rswMbW = 0.0;",
    `          for (int rswMbI = 0; rswMbI < ${MB_TAPS}; rswMbI++) {`,
    `            float rswMbT = (float(rswMbI) - ${half}) / ${span};`,
    "            vec2 rswMbUv2 = vUv + rswMbVel * rswMbT;",
    "            if (rswMbUv2.x < 0.0 || rswMbUv2.x > 1.0 || rswMbUv2.y < 0.0 || rswMbUv2.y > 1.0) continue;",
    "            rswMbAcc += texture2D(tDiffuse, rswMbUv2).rgb;",
    "            rswMbW += 1.0;",
    "          }",
    "          if (rswMbW > 0.5) rswMbOut = rswMbAcc / rswMbW;",
    "        }",
    "      }",
    "    }",
    "  }",
    "  gl_FragColor = vec4(rswMbOut, rswMbBase.a);",
    "}",
  ].join("\n");
}
