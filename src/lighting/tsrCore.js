export const TSR_VERSION = "tsr-f40";


export function halton(i, b) {
  let f = 1;
  let r = 0;
  let n = i + 1;                                  
  while (n > 0) {
    f /= b;
    r += f * (n % b);
    n = Math.floor(n / b);
  }
  return r;
}


export const TSR_JITTER_COUNT = 8;
const _jitter = [];
for (let i = 0; i < TSR_JITTER_COUNT; i++) {
  _jitter.push({ x: halton(i, 2) - 0.5, y: halton(i, 3) - 0.5 });
}
export const TSR_JITTER_TABLE = Object.freeze(_jitter.map(j => Object.freeze(j)));


export function jitterForFrame(frameIdx) {
  return TSR_JITTER_TABLE[((frameIdx | 0) % TSR_JITTER_COUNT + TSR_JITTER_COUNT) % TSR_JITTER_COUNT];
}


export function jitterToNdc(jx, jy, w, h) {
  return {
    x: (w > 0) ? 2 * jx / w : 0,
    y: (h > 0) ? 2 * jy / h : 0,
  };
}


export function resolveObjectMv(flag, env, out) {
  const o = out || { on: false, reason: "" };
  if (flag === false) { o.on = false; o.reason = "veto"; return o; }
  const weak = !!(env && env.weak);
  if (weak) { o.on = false; o.reason = "weak"; return o; }
  if (flag === true) { o.on = true; o.reason = "forced"; return o; }


  const hasMbOrTaa = !!(env && (env.mbOn || env.taaOn));
  if (hasMbOrTaa) { o.on = true; o.reason = "auto-mb-taa"; return o; }
  o.on = false; o.reason = "auto-no-consumer";
  return o;
}


export function resolveTemporalUpscale(flag, env, out) {
  const o = out || { on: false, reason: "" };
  if (flag === false) { o.on = false; o.reason = "veto"; return o; }
  const weak = !!(env && env.weak);
  if (weak) { o.on = false; o.reason = "weak"; return o; }
  if (flag === true) {
    const taaOn = !!(env && env.taaOn);
    if (!taaOn) { o.on = false; o.reason = "forced-no-taa"; return o; }
    o.on = true; o.reason = "forced";
    return o;
  }

  o.on = false; o.reason = "auto-off-parity";
  return o;
}


const _mvScratch = { on: false, reason: "" };
const _upScratch = { on: false, reason: "" };


export function tsrPlan(src, out) {
  const s = src || {};
  const o = out || {
    mvOn: false, mvReason: "",
    upscaleOn: false, upscaleReason: "",
    active: false,
  };
  const mv = resolveObjectMv(
    s.mvFlag === undefined ? null : s.mvFlag,
    s,
    _mvScratch,
  );
  const up = resolveTemporalUpscale(
    s.upscaleFlag === undefined ? null : s.upscaleFlag,
    s,
    _upScratch,
  );
  o.mvOn = mv.on;
  o.mvReason = mv.reason;
  o.upscaleOn = up.on;
  o.upscaleReason = up.reason;
  o.active = o.mvOn || o.upscaleOn;
  return o;
}


export const TSR_COST = Object.freeze({


  jitter: "0 — modifica projectionMatrix.elements[8/9] antes do render; revertido depois",


  objectMv: "1 pass geometria ½-res RGBA8 + uniform feed ao TAA/MB (só quando mvOn)",


  temporalUpscale: "AUTO OFF (opt-in futuro — ADAPTIVE_RES_OFF=true no projeto)",
});


export function buildMotionBlurVelocityGlsl(opts) {
  const taps = (opts && opts.taps) ? opts.taps : 8;
  const MV_MAX_UV = 0.25;
  const half = ((taps - 1) / 2).toFixed(1);
  const span = (taps - 1).toFixed(1);
  return [
    "uniform sampler2D tDiffuse;",
    "uniform sampler2D tDepth;",
    "uniform sampler2D tVelocity;",
    "uniform mat4 uInvViewProj;",
    "uniform mat4 uPrevViewProj;",
    "uniform float uShutter;",
    "uniform float uMaxUv;",
    "uniform float uHistoryValid;",
    "uniform float uTsrMvOn;",
    "varying vec2 vUv;",
    "float rswTsrMbUnpackDepth(const in vec4 v) {",
    "  const vec4 f = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);",
    "  return dot(v, f);",
    "}",
    "void main() {",
    "  vec4 rswBase = texture2D(tDiffuse, vUv);",
    "  vec3 rswOut = rswBase.rgb;",
    "  float rswD = rswTsrMbUnpackDepth(texture2D(tDepth, vUv));",
    "  if (uHistoryValid > 0.5 && uShutter > 0.0 && rswD < 0.9999) {",
    "    vec2 rswVel = vec2(0.0);",
    "    bool rswUsedMv = false;",







    "    if (uTsrMvOn > 0.5) {",
    `      vec4 rswMvTex = texture2D(tVelocity, vUv);`,
    "      if (rswMvTex.a > 0.5) {",
    "        vec2 rswMvE = rswMvTex.rg - 0.5;",
    "        if (abs(rswMvE.x) <= 0.6 / 255.0) rswMvE.x = 0.0;",
    "        if (abs(rswMvE.y) <= 0.6 / 255.0) rswMvE.y = 0.0;",
    `        vec2 rswMvDecoded = rswMvE * (2.0 * ${MV_MAX_UV.toFixed(4)});`,
    "        rswVel = rswMvDecoded * uShutter;",
    "        rswUsedMv = true;",
    "      }",
    "    }",

    "    if (!rswUsedMv) {",
    "      vec4 rswNdc = vec4(vUv * 2.0 - 1.0, rswD * 2.0 - 1.0, 1.0);",
    "      vec4 rswWp = uInvViewProj * rswNdc;",
    "      if (abs(rswWp.w) > 1e-8) {",
    "        vec4 rswPc = uPrevViewProj * vec4(rswWp.xyz / rswWp.w, 1.0);",
    "        if (rswPc.w > 1e-6) {",
    "          vec2 rswPrevUv = (rswPc.xy / rswPc.w) * 0.5 + 0.5;",
    "          rswVel = (vUv - rswPrevUv) * uShutter;",
    "        }",
    "      }",
    "    }",
    "    float rswVlen = length(rswVel);",
    "    if (rswVlen > 1e-5) {",
    "      if (rswVlen > uMaxUv) rswVel *= uMaxUv / rswVlen;",
    "      vec3 rswAcc = vec3(0.0);",
    "      float rswW = 0.0;",
    `      for (int rswI = 0; rswI < ${taps}; rswI++) {`,
    `        float rswT = (float(rswI) - ${half}) / ${span};`,
    "        vec2 rswUv2 = vUv + rswVel * rswT;",
    "        if (rswUv2.x < 0.0 || rswUv2.x > 1.0 || rswUv2.y < 0.0 || rswUv2.y > 1.0) continue;",
    "        rswAcc += texture2D(tDiffuse, rswUv2).rgb;",
    "        rswW += 1.0;",
    "      }",
    "      if (rswW > 0.5) rswOut = rswAcc / rswW;",
    "    }",
    "  }",
    "  gl_FragColor = vec4(rswOut, rswBase.a);",
    "}",
  ].join("\n");
}







export function cameraVelocityJs(uv, depth, invViewProj4x4, prevViewProj4x4, shutter) {

  function multiplyMV(m, v) {
    return [
      m[0]*v[0] + m[4]*v[1] + m[8]*v[2]  + m[12]*v[3],
      m[1]*v[0] + m[5]*v[1] + m[9]*v[2]  + m[13]*v[3],
      m[2]*v[0] + m[6]*v[1] + m[10]*v[2] + m[14]*v[3],
      m[3]*v[0] + m[7]*v[1] + m[11]*v[2] + m[15]*v[3],
    ];
  }
  const ndc = [uv[0]*2-1, uv[1]*2-1, depth*2-1, 1];
  const wp = multiplyMV(invViewProj4x4, ndc);
  if (Math.abs(wp[3]) <= 1e-8) return [0, 0];
  const wc = [wp[0]/wp[3], wp[1]/wp[3], wp[2]/wp[3]];
  const pc = multiplyMV(prevViewProj4x4, [...wc, 1]);
  if (pc[3] <= 1e-6) return [0, 0];
  const prevUv = [(pc[0]/pc[3])*0.5 + 0.5, (pc[1]/pc[3])*0.5 + 0.5];
  return [(uv[0] - prevUv[0]) * shutter, (uv[1] - prevUv[1]) * shutter];
}


export function decodeMvVelocity(r, g) {
  const MV_MAX_UV = 0.25;
  const DEAD_ZONE_ENC = 0.6 / 255;
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  let ex = clamp01(r) - 0.5;
  let ey = clamp01(g) - 0.5;
  if (Math.abs(ex) <= DEAD_ZONE_ENC) ex = 0;
  if (Math.abs(ey) <= DEAD_ZONE_ENC) ey = 0;
  return [ex * (2 * MV_MAX_UV), ey * (2 * MV_MAX_UV)];
}
