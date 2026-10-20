export const AE_SMALL_SIZE = 64;

export const AE_EV_MIN_NORM = -14;
export const AE_EV_MAX_NORM = 10;

export const AE_REF_EV = Math.log2(0.18);

export const AE_W_MIN = 0.15;
export const AE_W_FALLOFF = 1.8;

export const AE_P95_POW = 6;

export const AE_DEFAULTS = Object.freeze({
  minEv: -10,                                                            
  maxEv: 8,                                                      
  speedUpEvPerS: 5,                                                               
  speedDownEvPerS: 2.5,                                                   
  deadbandEv: 0.35,                                                               
  settleEv: 0.05,                                                  
  highlightWeight: 0.5,                                                
  highlightHeadroomEv: 3,                                                              
  rangeEv: 4,                               
});

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function sanitizeAutoExposureOpts(opts) {
  const src = opts && typeof opts === "object" ? opts : {};
  const d = AE_DEFAULTS;


  const num = (v, def, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? clampNum(v, lo, hi) : def);
  let minEv = num(src.minEv, d.minEv, AE_EV_MIN_NORM, AE_EV_MAX_NORM);
  let maxEv = num(src.maxEv, d.maxEv, AE_EV_MIN_NORM, AE_EV_MAX_NORM);
  if (!(minEv < maxEv)) {

    minEv = d.minEv;
    maxEv = d.maxEv;
  }
  const deadbandEv = num(src.deadbandEv, d.deadbandEv, 0, 2);
  return Object.freeze({
    minEv,
    maxEv,
    speedUpEvPerS: num(src.speedUpEvPerS, d.speedUpEvPerS, 0.1, 50),
    speedDownEvPerS: num(src.speedDownEvPerS, d.speedDownEvPerS, 0.1, 50),
    deadbandEv,
    settleEv: Math.min(num(src.settleEv, d.settleEv, 0.01, 1), Math.max(deadbandEv, 0.01)),
    highlightWeight: num(src.highlightWeight, d.highlightWeight, 0, 1),
    highlightHeadroomEv: num(src.highlightHeadroomEv, d.highlightHeadroomEv, 0, 8),
    rangeEv: num(src.rangeEv, d.rangeEv, 1, 8),
  });
}


export function normToEv(n) {
  return AE_EV_MIN_NORM + clampNum(Number(n) || 0, 0, 1) * (AE_EV_MAX_NORM - AE_EV_MIN_NORM);
}

export function evToNorm(ev) {
  const e = Number.isFinite(Number(ev)) ? Number(ev) : 0;
  return clampNum((e - AE_EV_MIN_NORM) / (AE_EV_MAX_NORM - AE_EV_MIN_NORM), 0, 1);
}


export function meteringWeightAt(u, v) {
  const dx = (clampNum(Number(u) || 0, 0, 1) - 0.5) * 2;
  const dy = (clampNum(Number(v) || 0, 0, 1) - 0.5) * 2;
  return AE_W_MIN + (1 - AE_W_MIN) * Math.exp(-AE_W_FALLOFF * (dx * dx + dy * dy));
}


export function evTargetFor(meanNl, p95Nl, opts) {
  const o = opts && typeof opts.minEv === "number" ? opts : sanitizeAutoExposureOpts(opts);
  const m = clampNum(Number(meanNl) || 0, 0, 1);
  const p = Math.max(clampNum(Number(p95Nl) || 0, 0, 1), m);                                                                         
  const evMean = normToEv(m);
  const evP95 = normToEv(p);
  const lift = Math.max(0, evP95 - o.highlightHeadroomEv - evMean);
  return clampNum(evMean + lift * o.highlightWeight, o.minEv, o.maxEv);
}


export function encodeFixed16(x) {
  const v = clampNum(Number.isFinite(Number(x)) ? Number(x) : 0, 0, 1) * 255;
  const hi = Math.floor(v);
  const lo = Math.round((v - hi) * 255);
  return { hi, lo };
}

export function decodeFixed16(hiByte, loByte) {
  const hi = clampNum(Math.round(Number(hiByte) || 0), 0, 255);
  const lo = clampNum(Math.round(Number(loByte) || 0), 0, 255);
  return (hi + lo / 255) / 255;
}


export function createAutoExposureController(opts) {
  const o = sanitizeAutoExposureOpts(opts);
  let evAdapt = null;
  let evTargetLast = null;
  let moving = false;
  let samples = 0;
  let dropped = 0;
  let scale = 1;

  const stateBuf = { scale: 1, evAdapt: null, evTarget: null, moving: false, samples: 0, dropped: 0 };

  function scaleFor(ev) {
    return Math.pow(2, clampNum(AE_REF_EV - ev, -o.rangeEv, o.rangeEv));
  }

  function getState() {
    stateBuf.scale = scale;
    stateBuf.evAdapt = evAdapt;
    stateBuf.evTarget = evTargetLast;
    stateBuf.moving = moving;
    stateBuf.samples = samples;
    stateBuf.dropped = dropped;
    return stateBuf;
  }

  function step(sample) {
    const okSample =
      !!sample &&
      Number.isFinite(sample.meanNl) &&
      Number.isFinite(sample.p95Nl) &&
      Number.isFinite(sample.dtMs) &&
      sample.dtMs > 0;
    if (!okSample) {
      dropped++;                                              
      return getState();
    }
    const dtS = clampNum(sample.dtMs, 1, 500) / 1000;                                           
    const target = evTargetFor(clampNum(sample.meanNl, 0, 1), clampNum(sample.p95Nl, 0, 1), o);
    evTargetLast = target;
    if (evAdapt === null) {
      evAdapt = target;                                  
      moving = false;
    } else {
      const delta = target - evAdapt;
      if (!moving && Math.abs(delta) > o.deadbandEv) moving = true;
      if (moving) {
        const rate = delta >= 0 ? o.speedUpEvPerS : o.speedDownEvPerS;
        const maxStep = rate * dtS;
        evAdapt += Math.abs(delta) <= maxStep ? delta : delta > 0 ? maxStep : -maxStep;
        if (Math.abs(target - evAdapt) <= o.settleEv) moving = false;
      }
    }
    samples++;
    scale = scaleFor(evAdapt);
    return getState();
  }

  function deactivate() {


    evAdapt = null;
    evTargetLast = null;
    moving = false;
    scale = 1;
  }

  return { step, deactivate, getState, opts: o };
}

export function resolveAutoExposure(flag, env, out) {
  const weak = !!(env && env.weak);
  const tier = env && typeof env.tier === "string" ? env.tier : null;
  let on = false;
  let reason = "auto-weak-off";
  if (flag === true) {
    if (weak && tier === "micro") {
      reason = "tier-micro";
    } else {
      on = true;
      reason = "flag";
    }
  } else if (flag === false) {
    reason = "flag-off";
  } else if (!weak) {
    on = true;
    reason = "auto-strong";
  }
  if (out && typeof out === "object") {
    out.on = on;
    out.reason = reason;
    return out;
  }
  return { on, reason };
}


export function aeMeasureCadence(weak) {
  return weak ? 2 : 1;
}


const fmtF = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export function buildAeMeasureGlsl() {
  const span = AE_EV_MAX_NORM - AE_EV_MIN_NORM;
  return `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float nl = clamp((log2(max(lum, 1e-6)) - (${fmtF(AE_EV_MIN_NORM)})) / ${fmtF(span)}, 0.0, 1.0);
  float dx = (vUv.x - 0.5) * 2.0;
  float dy = (vUv.y - 0.5) * 2.0;
  float w = ${fmtF(AE_W_MIN)} + ${fmtF(1 - AE_W_MIN)} * exp(-${fmtF(AE_W_FALLOFF)} * (dx * dx + dy * dy));
  float p2 = nl * nl;
  float p6 = p2 * p2 * p2;
  gl_FragColor = vec4(w * nl, w, w * p6, 1.0);
}
`;
}

export function buildAeReduceGlsl() {


  return `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tSrc, vUv);
}
`;
}

export function buildAeEncodeGlsl() {
  return `
uniform sampler2D tSrc;
varying vec2 vUv;
vec2 pack16(float x) {
  float v = clamp(x, 0.0, 1.0) * 255.0;
  float hi = floor(v);
  float lo = floor(fract(v) * 255.0 + 0.5);
  return vec2(hi, lo) / 255.0;
}
void main() {
  vec4 t = texture2D(tSrc, vec2(0.5, 0.5));
  float w = max(t.g, 1e-5);
  float meanNl = clamp(t.r / w, 0.0, 1.0);
  float p6 = clamp(t.b / w, 0.0, 1.0);
  float p95 = pow(p6, 1.0 / ${fmtF(AE_P95_POW)});
  vec2 m = pack16(meanNl);
  vec2 q = pack16(p95);
  gl_FragColor = vec4(m.x, m.y, q.x, q.y);
}
`;
}
