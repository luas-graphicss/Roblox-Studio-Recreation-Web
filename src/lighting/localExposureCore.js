export const LE_GUIDE_DIV = 4;


export const LE_STRENGTH_DEFAULT = 0.35;
export const LE_STRENGTH_MAX = 1;

export const LE_MAX_STOPS = 2;

export const LE_MID_GREY = 0.18;


export const LE_RANGE_SIGMA = 1.25;

export const LE_SPATIAL_SIGMA = 2.5;

export const LE_TAP_RADIUS = 4;

export const LE_EPS = 1e-4;


export const LE_LOG_MIN = -12;
export const LE_LOG_SPAN = 16;


export const LE_HALO_LIMIT = 0.05;
export const LE_GUIDE_LUMA_CEILING = 4;

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}


export function sanitizeLeStrength(raw) {
  return clamp(num(raw, LE_STRENGTH_DEFAULT), 0, LE_STRENGTH_MAX);
}


export function localExposurePlan(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const flag = src.flag === true ? true : src.flag === false ? false : null;
  const weak = src.weakGpu === true;
  const renderStyle = src.renderStyle === "Realistic" ? "Realistic" : "Classic";
  const strength = sanitizeLeStrength(src.strength);
  const wanted = flag !== false;
  const active = !weak && wanted && strength > 0;
  return Object.freeze({
    active,
    strength,
    flag,
    auto: flag === null,
    renderStyle,
    weakGpu: weak,
    midGrey: LE_MID_GREY,
    midLog: Math.log2(LE_MID_GREY),
    maxStops: LE_MAX_STOPS,
    rangeSigma: LE_RANGE_SIGMA,
    rangeInvEnc: leRangeInvEnc(LE_RANGE_SIGMA),
    guideDiv: LE_GUIDE_DIV,
    tapRadius: LE_TAP_RADIUS,
  });
}


export function leLuma(rgb) {
  const v = Array.isArray(rgb) ? rgb : [0, 0, 0];
  return 0.299 * num(v[0], 0) + 0.587 * num(v[1], 0) + 0.114 * num(v[2], 0);
}


export function leLogLum(rgb) {
  return Math.log2(clamp(leLuma(rgb), LE_EPS, LE_GUIDE_LUMA_CEILING));
}


export function leEncodeLog(lg) {
  return clamp((num(lg, LE_LOG_MIN) - LE_LOG_MIN) / LE_LOG_SPAN, 0, 1);
}

export function leDecodeLog(enc) {
  return clamp(num(enc, 0), 0, 1) * LE_LOG_SPAN + LE_LOG_MIN;
}


export function leRangeInvEnc(sigmaStops) {
  const s = num(sigmaStops, 0);
  if (!(s > 0)) return 0;
  const enc = s / LE_LOG_SPAN;
  return 1 / (2 * enc * enc);
}


export function leSpatialWeights(radius = LE_TAP_RADIUS, sigma = LE_SPATIAL_SIGMA) {
  const r = Math.max(0, Math.min(16, Math.floor(num(radius, 0))));
  const sg = Math.max(num(sigma, LE_SPATIAL_SIGMA), 1e-3);
  const out = [];
  for (let k = 0; k <= r; k++) out.push(Math.exp(-(k * k) / (2 * sg * sg)));
  return out;
}


export function leBilateralBlur1D(encLine, opts) {
  const line = Array.isArray(encLine) ? encLine : [];
  if (line.length === 0) return [];
  const o = opts && typeof opts === "object" ? opts : {};
  const radius = Math.max(0, Math.min(16, Math.floor(num(o.radius, LE_TAP_RADIUS))));
  const w = leSpatialWeights(radius, num(o.spatialSigma, LE_SPATIAL_SIGMA));
  const rangeInv = num(o.rangeInvEnc, leRangeInvEnc(LE_RANGE_SIGMA));
  const n = line.length;
  const at = (i) => num(line[clamp(i, 0, n - 1)], 0);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = at(i);
    let acc = c * w[0];
    let wsum = w[0];
    for (let k = 1; k <= radius; k++) {
      const a = at(i + k);
      const b = at(i - k);
      const wa = w[k] * Math.exp(-(a - c) * (a - c) * rangeInv);
      const wb = w[k] * Math.exp(-(b - c) * (b - c) * rangeInv);
      acc += a * wa + b * wb;
      wsum += wa + wb;
    }
    out[i] = acc / wsum;
  }
  return out;
}


export function leGain(regionLog, params) {
  const p = params && typeof params === "object" ? params : {};
  const strength = clamp(num(p.strength, 0), 0, LE_STRENGTH_MAX);
  if (strength === 0) return 1;
  const midLog = num(p.midLog, Math.log2(LE_MID_GREY));
  const maxStops = Math.max(0, num(p.maxStops, LE_MAX_STOPS));
  const d = clamp(-strength * (num(regionLog, midLog) - midLog), -maxStops, maxStops);
  return Math.pow(2, d);
}

export function leApply(rgb, regionLog, params) {
  const v = Array.isArray(rgb) ? rgb : [0, 0, 0];
  const g = leGain(regionLog, params);
  return [num(v[0], 0) * g, num(v[1], 0) * g, num(v[2], 0) * g];
}


export function leHaloEdgeMetric(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const darkLog = num(o.darkLog, -6);
  const brightLog = num(o.brightLog, 1);
  const width = Math.max(16, Math.min(512, Math.floor(num(o.width, 64))));
  const radius = Math.max(0, Math.min(16, Math.floor(num(o.radius, LE_TAP_RADIUS))));
  const p = {
    strength: num(o.strength, LE_STRENGTH_DEFAULT),
    midLog: num(o.midLog, Math.log2(LE_MID_GREY)),
    maxStops: num(o.maxStops, LE_MAX_STOPS),
  };
  const half = width >> 1;
  const enc = new Array(width);
  for (let i = 0; i < width; i++) enc[i] = leEncodeLog(i < half ? darkLog : brightLog);
  const blurred = leBilateralBlur1D(enc, {
    radius,
    spatialSigma: num(o.spatialSigma, LE_SPATIAL_SIGMA),
    rangeInvEnc: num(o.rangeInvEnc, leRangeInvEnc(LE_RANGE_SIGMA)),
  });
  const stops = (i) => Math.log2(leGain(leDecodeLog(blurred[i]), p));
  const refDark = stops(0);
  const refBright = stops(width - 1);
  let halo = 0;
  for (let i = 0; i < half; i++) halo = Math.max(halo, Math.abs(stops(i) - refDark));
  for (let i = half; i < width; i++) halo = Math.max(halo, Math.abs(stops(i) - refBright));
  return {
    halo,
    gainDark: Math.pow(2, refDark),
    gainBright: Math.pow(2, refBright),
  };
}


function fmt(x) {
  const s = String(Math.round(x * 1e8) / 1e8);
  return s.indexOf(".") >= 0 || s.indexOf("e") >= 0 ? s : s + ".0";
}


export function buildLeDownsampleGlsl() {
  return [
    "uniform sampler2D tDiffuse;",
    "uniform vec2 uSrcTexel;",
    "varying vec2 vUv;",
    "void main() {",
    "  vec3 c = texture2D(tDiffuse, vUv + vec2(-uSrcTexel.x, -uSrcTexel.y)).rgb;",
    "  c += texture2D(tDiffuse, vUv + vec2(uSrcTexel.x, -uSrcTexel.y)).rgb;",
    "  c += texture2D(tDiffuse, vUv + vec2(-uSrcTexel.x, uSrcTexel.y)).rgb;",
    "  c += texture2D(tDiffuse, vUv + vec2(uSrcTexel.x, uSrcTexel.y)).rgb;",
    "  c *= 0.25;",
    "  float lum = min(dot(c, vec3(0.299, 0.587, 0.114)), " + fmt(LE_GUIDE_LUMA_CEILING) + ");",
    "  float lg = log2(max(lum, " + fmt(LE_EPS) + "));",
    "  float enc = clamp((lg - (" + fmt(LE_LOG_MIN) + ")) / " + fmt(LE_LOG_SPAN) + ", 0.0, 1.0);",
    "  gl_FragColor = vec4(vec3(enc), 1.0);",
    "}",
  ].join("\n");
}


export function buildLeBlurGlsl() {
  const w = leSpatialWeights(LE_TAP_RADIUS, LE_SPATIAL_SIGMA);
  const lines = [
    "uniform sampler2D tGuide;",
    "uniform vec2 uStep;",
    "uniform float uRangeInv;",
    "varying vec2 vUv;",
    "void main() {",
    "  float c = texture2D(tGuide, vUv).r;",
    "  float acc = c * " + fmt(w[0]) + ";",
    "  float wsum = " + fmt(w[0]) + ";",
    "  float a; float b; float wa; float wb; vec2 o;",
  ];
  for (let k = 1; k <= LE_TAP_RADIUS; k++) {
    lines.push(
      "  o = uStep * " + fmt(k) + ";",
      "  a = texture2D(tGuide, vUv + o).r;",
      "  b = texture2D(tGuide, vUv - o).r;",
      "  wa = " + fmt(w[k]) + " * exp(-(a - c) * (a - c) * uRangeInv);",
      "  wb = " + fmt(w[k]) + " * exp(-(b - c) * (b - c) * uRangeInv);",
      "  acc += a * wa + b * wb;",
      "  wsum += wa + wb;",
    );
  }
  lines.push("  gl_FragColor = vec4(vec3(acc / wsum), 1.0);", "}");
  return lines.join("\n");
}


export function buildLeApplyGlsl() {
  return [
    "uniform sampler2D tLeGuide;",
    "uniform vec2 uLeGuideTexel;",
    "uniform float uLeOn;",
    "uniform float uLeStrength;",
    "uniform float uLeMidLog;",
    "uniform float uLeMaxStops;",
    "// Tenda 2x2 no guia: 4 taps bilineares a meio texel do centro. Sem isto",
    "// a ampliacao 4x do guia de 1/4 res vira ESCADA na borda do ganho e os",
    "// objetos ficam com cara de pixelado contra o ceu claro.",
    "// uLeGuideTexel=(0,0) faz os 4 taps cairem no centro (fallback antigo).",
    "float rswLeGuide(vec2 uv) {",
    "  vec2 o = uLeGuideTexel * 0.5;",
    "  float g = texture2D(tLeGuide, uv + vec2(-o.x, -o.y)).r;",
    "  g += texture2D(tLeGuide, uv + vec2(o.x, -o.y)).r;",
    "  g += texture2D(tLeGuide, uv + vec2(-o.x, o.y)).r;",
    "  g += texture2D(tLeGuide, uv + vec2(o.x, o.y)).r;",
    "  return g * 0.25;",
    "}",
    "vec3 rswLeApply(vec3 c, vec2 uv) {",
    "  if (uLeOn < 0.5) return c;",
    "  float regionLog = rswLeGuide(uv) * " + fmt(LE_LOG_SPAN) + " + (" + fmt(LE_LOG_MIN) + ");",
    "  float d = clamp(-uLeStrength * (regionLog - uLeMidLog), -uLeMaxStops, uLeMaxStops);",
    "  return c * exp2(d);",
    "}",
  ].join("\n");
}
