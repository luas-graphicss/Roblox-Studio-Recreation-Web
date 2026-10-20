import { HW_XYZ_CONF, HW_XYZ_RAD } from "./hosekWilkieData.js";
import { hwFormCoefficients, zenithYxy, perezExtended } from "./skyPhysicalCore.js";

const HALF_PI = Math.PI / 2;


const HW_ALBEDO = 0.15;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = (v, d) => (Number.isFinite(v) ? v : d);


function bez5(t) {
  const it = 1 - t;
  return [
    it * it * it * it * it,
    5 * it * it * it * it * t,
    10 * it * it * it * t * t,
    10 * it * it * t * t * t,
    5 * it * t * t * t * t,
    t * t * t * t * t,
  ];
}


function confAt(ch, a, ti, w) {
  const base = ((a * 10 + ti) * 6) * 9;
  const arr = HW_XYZ_CONF[ch];
  const out = new Array(9);
  for (let c = 0; c < 9; c++) {
    let v = 0;
    for (let b = 0; b < 6; b++) v += w[b] * arr[base + b * 9 + c];
    out[c] = v;
  }
  return out;
}

function radAt(ch, a, ti, w) {
  const base = (a * 10 + ti) * 6;
  const arr = HW_XYZ_RAD[ch];
  let v = 0;
  for (let b = 0; b < 6; b++) v += w[b] * arr[base + b];
  return v;
}


function cook(sampler, ch, T, elev) {
  const e = clamp(fin(elev, 0), 0, HALF_PI);
  const w = bez5(Math.pow(e / HALF_PI, 1 / 3));
  const t = clamp(fin(T, 3), 1, 10);
  const t0 = Math.min(Math.floor(t) - 1, 9) < 0 ? 0 : Math.min(Math.floor(t) - 1, 9);
  const t1 = Math.min(t0 + 1, 9);
  const tf = clamp(t - (t0 + 1), 0, 1);
  const mixT = (a) => {
    const v0 = sampler(ch, a, t0, w);
    if (t1 === t0 || tf === 0) return v0;
    const v1 = sampler(ch, a, t1, w);
    if (Array.isArray(v0)) return v0.map((x, i) => x + (v1[i] - x) * tf);
    return v0 + (v1 - v0) * tf;
  };
  const a0 = mixT(0);
  const a1 = mixT(1);
  if (Array.isArray(a0)) return a0.map((x, i) => x + (a1[i] - x) * HW_ALBEDO);
  return a0 + (a1 - a0) * HW_ALBEDO;
}

const toC9 = (v) => ({ A: v[0], B: v[1], C: v[2], D: v[3], E: v[4], F: v[5], G: v[6], H: v[7], I: v[8] });


function zenithChannelValue(ch, T, thetaS, elev) {
  const c9 = toC9(cook(confAt, ch, T, elev));
  const r = cook(radAt, ch, T, elev);
  return perezExtended(c9, 1, thetaS) * r;
}


let scaleK = 0;
function luminanceScale() {
  if (scaleK > 0) return scaleK;
  const hw0 = zenithChannelValue(1, 3, 0, HALF_PI);
  const pre0 = zenithYxy(3, 0).Y;
  scaleK = Number.isFinite(hw0) && hw0 > 1e-9 && Number.isFinite(pre0) ? pre0 / hw0 : 1;
  return scaleK;
}


export function buildHosekWilkieDataset() {
  return {
    name: "hosek-wilkie-xyz",
    coefficients(T, thetaS) {
      const th = clamp(fin(thetaS, 0), 0, HALF_PI);
      const elev = HALF_PI - th;
      const pre = hwFormCoefficients(T);


      return { Y: toC9(cook(confAt, 1, T, elev)), x: pre.x, y: pre.y };
    },
    zenith(T, thetaS) {
      const th = clamp(fin(thetaS, 0), 0, HALF_PI);
      const elev = HALF_PI - th;
      const vX = zenithChannelValue(0, T, th, elev);
      const vY = zenithChannelValue(1, T, th, elev);
      const vZ = zenithChannelValue(2, T, th, elev);
      const sum = vX + vY + vZ;
      const fb = zenithYxy(T, th);                                         
      const ok = Number.isFinite(sum) && sum > 1e-9 && vX >= 0 && vY >= 0 && vZ >= 0;
      return {
        Y: Math.max(fin(vY, 0), 0) * luminanceScale(),
        x: ok ? vX / sum : fb.x,
        y: ok ? vY / sum : fb.y,
      };
    },
  };
}
