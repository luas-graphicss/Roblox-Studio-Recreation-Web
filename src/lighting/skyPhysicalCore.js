export const SKY_TURBIDITY_MIN = 1.7;
export const SKY_TURBIDITY_MAX = 10;
export const SKY_TURBIDITY_DEFAULT = 3;
export const SKY_ALBEDO_DEFAULT = 0.25;


export const SKY_PHYS_KNEE = 1.25;

export const MAX_SUN_ZENITH = 1.55;

export const BLEND_SIN_ELEV_LO = -0.18;                                 
export const BLEND_SIN_ELEV_HI = 0.06;                              

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function clampNum(v, lo, hi, dflt) {
  const n = num(v, dflt);
  return n < lo ? lo : n > hi ? hi : n;
}


export function resolveSkyModel(renderStyleRaw) {
  return renderStyleRaw === "Realistic" ? 1 : 0;
}

export function sanitizeSkyInputs(inp) {
  const src = inp && typeof inp === "object" ? inp : {};
  return {
    turbidity: clampNum(src.turbidity, SKY_TURBIDITY_MIN, SKY_TURBIDITY_MAX, SKY_TURBIDITY_DEFAULT),
    albedo: clampNum(src.albedo, 0, 1, SKY_ALBEDO_DEFAULT),
  };
}


export function perezYxyCoefficients(turbidity) {
  const T = clampNum(turbidity, SKY_TURBIDITY_MIN, SKY_TURBIDITY_MAX, SKY_TURBIDITY_DEFAULT);
  return {
    Y: {
      A: 0.1787 * T - 1.463,
      B: -0.3554 * T + 0.4275,
      C: -0.0227 * T + 5.3251,
      D: 0.1206 * T - 2.5771,
      E: -0.067 * T + 0.3703,
    },
    x: {
      A: -0.0193 * T - 0.2592,
      B: -0.0665 * T + 0.0008,
      C: -0.0004 * T + 0.2125,
      D: -0.0641 * T - 0.8989,
      E: -0.0033 * T + 0.0452,
    },
    y: {
      A: -0.0167 * T - 0.2608,
      B: -0.095 * T + 0.0092,
      C: -0.0079 * T + 0.2102,
      D: -0.0441 * T - 1.6537,
      E: -0.0109 * T + 0.0529,
    },
  };
}


export function zenithYxy(turbidity, thetaS) {
  const T = clampNum(turbidity, SKY_TURBIDITY_MIN, SKY_TURBIDITY_MAX, SKY_TURBIDITY_DEFAULT);
  const t = clampNum(thetaS, 0, MAX_SUN_ZENITH, 0);
  const chi = (4 / 9 - T / 120) * (Math.PI - 2 * t);
  const Yz = (4.0453 * T - 4.971) * Math.tan(chi) - 0.2155 * T + 2.4192;
  const t2 = t * t;
  const t3 = t2 * t;
  const T2 = T * T;
  const xz =
    T2 * (0.00166 * t3 - 0.00375 * t2 + 0.00209 * t) +
    T * (-0.02903 * t3 + 0.06377 * t2 - 0.03202 * t + 0.00394) +
    (0.11693 * t3 - 0.21196 * t2 + 0.06052 * t + 0.25886);
  const yz =
    T2 * (0.00275 * t3 - 0.0061 * t2 + 0.00317 * t) +
    T * (-0.04214 * t3 + 0.0897 * t2 - 0.04153 * t + 0.00516) +
    (0.15346 * t3 - 0.26756 * t2 + 0.0667 * t + 0.26688);
  return { Y: Math.max(Yz, 1e-4), x: xz, y: yz };
}


export function hwFormCoefficients(turbidity) {
  const p = perezYxyCoefficients(turbidity);
  const mk = (c) => ({ A: c.A, B: c.B, C: 1, D: c.C, E: c.D, F: c.E, G: 0, H: 0, I: 0 });
  return { Y: mk(p.Y), x: mk(p.x), y: mk(p.y) };
}


let hwDataset = null;

function datasetChannelOk(c) {
  if (!c || typeof c !== "object") return false;
  for (const k of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) {
    if (!Number.isFinite(Number(c[k]))) return false;
  }
  return true;
}

function datasetZenithOk(z) {
  return !!z && Number.isFinite(Number(z.Y)) && Number(z.Y) > 0 &&
    Number.isFinite(Number(z.x)) && Number.isFinite(Number(z.y));
}

export function setSkyPhysicalDataset(ds) {
  if (ds === null || ds === undefined) {
    hwDataset = null;
    return true;
  }
  if (typeof ds !== "object" || typeof ds.coefficients !== "function" || typeof ds.zenith !== "function") {
    return false;
  }
  try {
    const c = ds.coefficients(SKY_TURBIDITY_DEFAULT, 0);
    const z = ds.zenith(SKY_TURBIDITY_DEFAULT, 0);
    if (!c || !datasetChannelOk(c.Y) || !datasetChannelOk(c.x) || !datasetChannelOk(c.y) || !datasetZenithOk(z)) {
      return false;
    }
  } catch (_e) {
    return false;
  }
  hwDataset = { name: String(ds.name || "custom"), coefficients: ds.coefficients, zenith: ds.zenith };
  return true;
}

export function getSkyPhysicalDataset() {
  return { name: hwDataset ? hwDataset.name : null, active: !!hwDataset };
}


function datasetCoefficients(T, thetaS) {
  try {
    const c = hwDataset.coefficients(T, thetaS);
    if (c && datasetChannelOk(c.Y) && datasetChannelOk(c.x) && datasetChannelOk(c.y)) return c;
  } catch (_e) {                       }
  return hwFormCoefficients(T);
}

function datasetZenith(T, thetaS) {
  try {
    const z = hwDataset.zenith(T, thetaS);
    if (datasetZenithOk(z)) return { Y: Math.max(Number(z.Y), 1e-4), x: Number(z.x), y: Number(z.y) };
  } catch (_e) {                       }
  return zenithYxy(T, thetaS);
}


export function perezExtended(c9, cosTheta, gamma) {
  const ct = Math.max(num(cosTheta, 0), 0);
  const g = clampNum(gamma, 0, Math.PI, 0);
  const cg = Math.cos(g);
  const chi = (1 + cg * cg) / Math.pow(Math.max(1 + c9.H * c9.H - 2 * c9.H * cg, 1e-4), 1.5);
  return (
    (1 + c9.A * Math.exp(c9.B / (ct + 0.01))) *
    (c9.C + c9.D * Math.exp(c9.E * g) + c9.F * cg * cg + c9.G * chi + c9.I * Math.sqrt(ct))
  );
}


export function xyYtoLinearRGB(x, y, Y) {
  const yc = Math.max(num(y, 0.001), 0.001);
  const xc = clampNum(x, 0, 1, 0);
  const Yl = Math.max(num(Y, 0), 0);
  const X = (xc * Yl) / yc;
  const Z = ((1 - xc - yc) * Yl) / yc;
  const r = 3.2406 * X - 1.5372 * Yl - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 * Yl + 0.0415 * Z;
  const b = 0.0557 * X - 0.204 * Yl + 1.057 * Z;
  return [Math.max(r, 0), Math.max(g, 0), Math.max(b, 0)];
}


export function skyPhysBlend(sinElev) {
  const s = clampNum(sinElev, -1, 1, -1);
  const t = clampNum((s - BLEND_SIN_ELEV_LO) / (BLEND_SIN_ELEV_HI - BLEND_SIN_ELEV_LO), 0, 1, 0);
  return t * t * (3 - 2 * t);
}


export const Y_NORM = zenithYxy(SKY_TURBIDITY_DEFAULT, 0).Y;


export function skyPhysicalUniforms(inp) {
  const src = inp && typeof inp === "object" ? inp : {};
  const { turbidity, albedo } = sanitizeSkyInputs(src);
  const sd = src.sunDir && typeof src.sunDir === "object" ? src.sunDir : { x: 0, y: 1, z: 0 };
  let sx = num(sd.x, 0);
  let sy = num(sd.y, 1);
  let sz = num(sd.z, 0);


  const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
  if (Number.isFinite(len) && len > 1e-6) {
    sx /= len;
    sy /= len;
    sz /= len;
  } else {
    sx = 0;
    sy = 1;
    sz = 0;
  }
  const sinElev = clampNum(sy, -1, 1, 1);
  const thetaEval = Math.min(Math.acos(sinElev), MAX_SUN_ZENITH);


  const c9 = hwDataset ? datasetCoefficients(turbidity, thetaEval) : hwFormCoefficients(turbidity);
  const zen = hwDataset ? datasetZenith(turbidity, thetaEval) : zenithYxy(turbidity, thetaEval);


  const f0Y = Math.max(perezExtended(c9.Y, 1, thetaEval), 1e-4);
  const f0x = Math.max(perezExtended(c9.x, 1, thetaEval), 1e-4);
  const f0y = Math.max(perezExtended(c9.y, 1, thetaEval), 1e-4);
  const zY = zen.Y / f0Y / Y_NORM;
  const zx = zen.x / f0x;
  const zy = zen.y / f0y;


  const gY = Math.max(zY * perezExtended(c9.Y, 0, Math.PI / 2), 0);
  const gx = zx * perezExtended(c9.x, 0, Math.PI / 2);
  const gy = zy * perezExtended(c9.y, 0, Math.PI / 2);


  const gRGB = xyYtoLinearRGB(clampNum(gx, 0.02, 0.6, 0.31), clampNum(gy, 0.02, 0.6, 0.33), gY);
  const ground = [
    1 - Math.exp(-SKY_PHYS_KNEE * gRGB[0] * albedo),
    1 - Math.exp(-SKY_PHYS_KNEE * gRGB[1] * albedo),
    1 - Math.exp(-SKY_PHYS_KNEE * gRGB[2] * albedo),
  ];
  const out = {
    blend: skyPhysBlend(sinElev),
    turbidity,
    albedo,
    elevDeg: (Math.asin(sinElev) * 180) / Math.PI,
    zenithY: zY,
    sun: [sx, sy, sz],
    A: [c9.Y.A, c9.x.A, c9.y.A],
    B: [c9.Y.B, c9.x.B, c9.y.B],
    C: [c9.Y.C, c9.x.C, c9.y.C],
    D: [c9.Y.D, c9.x.D, c9.y.D],
    E: [c9.Y.E, c9.x.E, c9.y.E],
    F: [c9.Y.F, c9.x.F, c9.y.F],
    G: [c9.Y.G, c9.x.G, c9.y.G],
    H: [c9.Y.H, c9.x.H, c9.y.H],
    I: [c9.Y.I, c9.x.I, c9.y.I],
    zenith: [zY, zx, zy],
    ground,
  };


  for (const k of ["blend", "turbidity", "albedo", "elevDeg", "zenithY"]) {
    if (!Number.isFinite(out[k])) out[k] = 0;
  }
  for (const k of ["sun", "A", "B", "C", "D", "E", "F", "G", "H", "I", "zenith", "ground"]) {
    const arr = out[k];
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) arr[i] = 0;
  }
  return out;
}


export function sampleSkyYxy(uni, dir) {
  const d = dir && typeof dir === "object" ? dir : { x: 0, y: 1, z: 0 };
  let dx = num(d.x, 0);
  let dy = num(d.y, 1);
  let dz = num(d.z, 0);

  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (Number.isFinite(len) && len > 1e-6) {
    dx /= len;
    dy /= len;
    dz /= len;
  } else {
    dx = 0;
    dy = 1;
    dz = 0;
  }
  const cosT = Math.max(dy, 0);
  const cosG = clampNum(dx * uni.sun[0] + dy * uni.sun[1] + dz * uni.sun[2], -1, 1, 0);
  const gamma = Math.acos(cosG);
  const ch = (i) => ({ A: uni.A[i], B: uni.B[i], C: uni.C[i], D: uni.D[i], E: uni.E[i], F: uni.F[i], G: uni.G[i], H: uni.H[i], I: uni.I[i] });
  return {
    Y: Math.max(uni.zenith[0] * perezExtended(ch(0), cosT, gamma), 0),
    x: uni.zenith[1] * perezExtended(ch(1), cosT, gamma),
    y: uni.zenith[2] * perezExtended(ch(2), cosT, gamma),
    h: dy,
  };
}


export function sampleSkyRGB(uni, dir) {
  const s = sampleSkyYxy(uni, dir);


  const rgb = xyYtoLinearRGB(clampNum(s.x, 0.02, 0.6, 0.31), clampNum(s.y, 0.02, 0.6, 0.33), s.Y);
  let r = 1 - Math.exp(-SKY_PHYS_KNEE * rgb[0]);
  let g = 1 - Math.exp(-SKY_PHYS_KNEE * rgb[1]);
  let b = 1 - Math.exp(-SKY_PHYS_KNEE * rgb[2]);

  const tRaw = clampNum(-s.h / 0.35, 0, 1, 0);
  const tg = tRaw * tRaw * (3 - 2 * tRaw);
  r = r + (uni.ground[0] - r) * tg;
  g = g + (uni.ground[1] - g) * tg;
  b = b + (uni.ground[2] - b) * tg;
  return [r, g, b];
}
