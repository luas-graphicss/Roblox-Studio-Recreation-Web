export const AO_MAX_SLICES = 2;
export const AO_MAX_STEPS = 8;
export const CS_MAX_STEPS = 16;

export const CS_DISTANCE_RANGE = Object.freeze([0.5, 3]);
export const AO_RADIUS_RANGE = Object.freeze([0.5, 8]);

export const IGN_MAGIC = Object.freeze([52.9829189, 0.06711056, 0.00583715]);

export const CS_STEP_POW = 1.35;

export const CS_MIN_HIT = 0.02;

export const CS_EDGE_MARGIN = 0.08;

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, lo, hi, d) {
  return Math.min(hi, Math.max(lo, num(v, d)));
}

function iclamp(v, lo, hi, d) {
  return Math.round(clamp(v, lo, hi, d));
}


export function sanitizeAoSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    aoIntensity: clamp(src.aoIntensity, 0, 1, 0.85),
    aoRadius: clamp(src.aoRadius, AO_RADIUS_RANGE[0], AO_RADIUS_RANGE[1], 2.5),
    aoPower: clamp(src.aoPower, 1, 4, 1.6),
    aoBias: clamp(src.aoBias, 0, 0.5, 0.08),
    slices: iclamp(src.slices, 1, AO_MAX_SLICES, 2),
    aoSteps: iclamp(src.aoSteps, 2, AO_MAX_STEPS, 6),
    csStrength: clamp(src.csStrength, 0, 1, 0.6),
    csDistance: clamp(src.csDistance, CS_DISTANCE_RANGE[0], CS_DISTANCE_RANGE[1], 2),
    csThickness: clamp(src.csThickness, 0.05, 2, 0.5),
    csSteps: iclamp(src.csSteps, 4, CS_MAX_STEPS, 12),
  };
}


export function aoTargetSize(w, h) {
  return {
    w: Math.max(1, Math.floor(Math.max(1, w | 0) / 2)),
    h: Math.max(1, Math.floor(Math.max(1, h | 0) / 2)),
  };
}

const fract = (x) => x - Math.floor(x);


export function ignValue(x, y) {
  return fract(IGN_MAGIC[0] * fract(IGN_MAGIC[1] * x + IGN_MAGIC[2] * y));
}


export function sliceDirections(slices) {
  const n = iclamp(slices, 1, AO_MAX_SLICES, 2);
  const out = [];
  for (let i = 0; i < n; i++) out.push((i * Math.PI) / n);
  return out;
}


export function csStepLengths(steps, distance) {
  const n = iclamp(steps, 1, CS_MAX_STEPS, 12);
  const d = clamp(distance, CS_DISTANCE_RANGE[0], CS_DISTANCE_RANGE[1], 2);
  const out = [];
  for (let i = 0; i < n; i++) out.push(d * Math.pow((i + 0.5) / n, CS_STEP_POW));
  return out;
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};


export function edgeFade(u, v, margin = CS_EDGE_MARGIN) {
  return (
    smoothstep(0, margin, u) *
    smoothstep(0, margin, 1 - u) *
    smoothstep(0, margin, v) *
    smoothstep(0, margin, 1 - v)
  );
}


export const AO_LITE_RES_DIV = 4;                                       
export const AO_LITE_TAPS = 4;                                     
export const AO_LITE_LUT_SIZE = 32;                                 

export const AO_LITE_GOLDEN = 2.39996322972865332;


export function aoLiteTargetSize(w, h) {
  return {
    w: Math.max(1, Math.floor(Math.max(1, w | 0) / AO_LITE_RES_DIV)),
    h: Math.max(1, Math.floor(Math.max(1, h | 0) / AO_LITE_RES_DIV)),
  };
}


export function liteSpiralTaps(taps, rnd) {
  const n = iclamp(taps, 1, AO_LITE_TAPS, AO_LITE_TAPS);
  const r = clamp(rnd, 0, 1, 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      ang: (i + r) * AO_LITE_GOLDEN,
      t: Math.sqrt((i + 0.5) / n),
    });
  }
  return out;
}


export function falloffLutValues(size = AO_LITE_LUT_SIZE) {
  const n = iclamp(size, 8, 256, AO_LITE_LUT_SIZE);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    out[i] = 1 - smoothstep(0, 1, t);
  }
  return out;
}


export function falloffLutSample(values, t) {
  const v = Array.isArray(values) && values.length ? values : falloffLutValues();
  const x = clamp(t, 0, 1, 1) * (v.length - 1);
  const i0 = Math.floor(x);
  const i1 = Math.min(i0 + 1, v.length - 1);
  const f = x - i0;
  return num(v[i0], 0) * (1 - f) + num(v[i1], 0) * f;
}


export function gtaoLiteGate(input) {
  const src = input && typeof input === "object" ? input : {};
  return (
    src.flag === true &&
    src.weak === true &&
    src.tierGtao !== true &&
    src.tierGtaoLite === true
  );
}
