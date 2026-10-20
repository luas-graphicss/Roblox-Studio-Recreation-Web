export const GRADING_PRESET_NAMES = Object.freeze(["None", "FilmicCool", "Golden", "Noir"]);
export const WB_TEMP_DEFAULT = 6500;
export const WB_TEMP_MIN = 1500;
export const WB_TEMP_MAX = 15000;
export const WB_TINT_SCALE = 0.05;
export const LUT_SIZE_MIN = 2;
export const LUT_SIZE_MAX = 65;
export const LUT_BAKE_SIZE = 33;
export const GRADE_CONTRAST_PIVOT = 0.18;

const IDENTITY9 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const LUMA_709 = Object.freeze([0.2126, 0.7152, 0.0722]);

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clampNum(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

export function resolveGradingPreset(raw) {
  const s = typeof raw === "string" ? raw : "";
  return GRADING_PRESET_NAMES.indexOf(s) >= 0 ? s : "None";
}

export function sanitizeGradingProps(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    temp: clampNum(src.temp, WB_TEMP_MIN, WB_TEMP_MAX, WB_TEMP_DEFAULT),
    tint: clampNum(src.tint, -1, 1, 0),
    preset: resolveGradingPreset(src.preset),
    lutAmount: clampNum(src.lutAmount, 0, 1, 1),
  };
}


function krystekUv(t) {
  const t2 = t * t;
  const u = (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t2) / (1 + 8.42420235e-4 * t + 7.08145163e-7 * t2);
  const v = (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t2) / (1 - 2.89741816e-5 * t + 1.61456053e-7 * t2);
  return [u, v];
}


function m3MulV3(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function m3MulM3(a, b) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
    }
  }
  return out;
}

const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const BRADFORD_INV = [[0.9869929, -0.1470543, 0.1599627], [0.4323053, 0.5183603, 0.0492912], [-0.0085287, 0.0400428, 0.9684867]];
const SRGB_TO_XYZ = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]];
const XYZ_TO_SRGB = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]];
const D65_XY = [0.3127, 0.329];

function xyToXYZ(x, y) {
  const yy = Math.max(y, 1e-6);
  return [x / yy, 1, (1 - x - yy) / yy];
}


export function whiteBalanceMatrix(tempRaw, tintRaw) {
  const temp = clampNum(tempRaw, WB_TEMP_MIN, WB_TEMP_MAX, WB_TEMP_DEFAULT);
  const tint = clampNum(tintRaw, -1, 1, 0);
  if (temp === WB_TEMP_DEFAULT && tint === 0) {
    return { on: false, mat: IDENTITY9.slice(), temp, tint };
  }
  const uv = krystekUv(temp);

  const dT = Math.max(temp * 0.01, 10);
  const uv2 = krystekUv(temp + dT);
  let du = uv2[0] - uv[0];
  let dv = uv2[1] - uv[1];
  const len = Math.hypot(du, dv) || 1;
  du /= len;
  dv /= len;


  const us = uv[0] + dv * tint * WB_TINT_SCALE;
  const vs = uv[1] + -du * tint * WB_TINT_SCALE;
  const d = 2 * us - 8 * vs + 4;
  const dd = Math.abs(d) > 1e-9 ? d : 1e-9;
  const x = (3 * us) / dd;
  const y = (2 * vs) / dd;
  const srcXYZ = xyToXYZ(x, y);
  const dstXYZ = xyToXYZ(D65_XY[0], D65_XY[1]);
  const lmsS = m3MulV3(BRADFORD, srcXYZ);
  const lmsD = m3MulV3(BRADFORD, dstXYZ);
  const gains = [0, 1, 2].map((i) => (Math.abs(lmsS[i]) > 1e-9 ? lmsD[i] / lmsS[i] : 1));
  const diag = [[gains[0], 0, 0], [0, gains[1], 0], [0, 0, gains[2]]];
  const mXyz = m3MulM3(BRADFORD_INV, m3MulM3(diag, BRADFORD));
  let m = m3MulM3(XYZ_TO_SRGB, m3MulM3(mXyz, SRGB_TO_XYZ));
  const w = m3MulV3(m, [1, 1, 1]);
  const lum = LUMA_709[0] * w[0] + LUMA_709[1] * w[1] + LUMA_709[2] * w[2];
  if (Number.isFinite(lum) && lum > 1e-6) {
    m = m.map((row) => row.map((val) => val / lum));
  }

  const flat = [m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]];
  for (let i = 0; i < 9; i++) {
    if (!Number.isFinite(flat[i])) return { on: false, mat: IDENTITY9.slice(), temp, tint };
  }
  return { on: true, mat: flat, temp, tint };
}


export function applyWhiteBalanceJs(mat, rgb) {
  const m = mat && mat.length === 9 ? mat : IDENTITY9;
  return [
    m[0] * rgb[0] + m[3] * rgb[1] + m[6] * rgb[2],
    m[1] * rgb[0] + m[4] * rgb[1] + m[7] * rgb[2],
    m[2] * rgb[0] + m[5] * rgb[1] + m[8] * rgb[2],
  ];
}


export const WHEELS_NEUTRAL = Object.freeze({
  lift: Object.freeze([0, 0, 0]),
  gamma: Object.freeze([1, 1, 1]),
  gain: Object.freeze([1, 1, 1]),
  satZone: Object.freeze([1, 1, 1]),
  conZone: Object.freeze([1, 1, 1]),
});

function vec3From(raw, def) {
  if (Array.isArray(raw)) {
    return [num(raw[0], def[0]), num(raw[1], def[1]), num(raw[2], def[2])];
  }
  if (raw && typeof raw === "object") {
    const r = num(raw.r !== undefined ? raw.r : raw.x, def[0]);
    const g = num(raw.g !== undefined ? raw.g : raw.y, def[1]);
    const b = num(raw.b !== undefined ? raw.b : raw.z, def[2]);
    return [r, g, b];
  }
  return def.slice();
}

function vec3Clamp(v, min, max) {
  return [Math.min(max, Math.max(min, v[0])), Math.min(max, Math.max(min, v[1])), Math.min(max, Math.max(min, v[2]))];
}


export function sanitizeWheels(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const lift = vec3Clamp(vec3From(src.lift, [0, 0, 0]), -1, 1);
  const gamma = vec3Clamp(vec3From(src.gamma, [1, 1, 1]), 0.2, 5);
  const gain = vec3Clamp(vec3From(src.gain, [1, 1, 1]), 0, 4);
  const satZone = vec3Clamp(vec3From(src.satZone, [1, 1, 1]), 0, 4);
  const conZone = vec3Clamp(vec3From(src.conZone, [1, 1, 1]), 0.2, 4);
  const neutral =
    lift[0] === 0 && lift[1] === 0 && lift[2] === 0 &&
    gamma[0] === 1 && gamma[1] === 1 && gamma[2] === 1 &&
    gain[0] === 1 && gain[1] === 1 && gain[2] === 1 &&
    satZone[0] === 1 && satZone[1] === 1 && satZone[2] === 1 &&
    conZone[0] === 1 && conZone[1] === 1 && conZone[2] === 1;
  return { on: !neutral, lift, gamma, gain, satZone, conZone };
}

function smoothstepJs(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function lumaJs(rgb) {
  return LUMA_709[0] * rgb[0] + LUMA_709[1] * rgb[1] + LUMA_709[2] * rgb[2];
}


export function zoneWeightsJs(l) {
  const ws = 1 - smoothstepJs(0, 0.33, l);
  const wh = smoothstepJs(0.55, 1, l);
  const wm = Math.max(1 - ws - wh, 0);
  return [ws, wm, wh];
}


export function applyWheelsJs(rgb, wheels) {
  const w = wheels || WHEELS_NEUTRAL;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const v = Math.max(w.gain[i] * rgb[i] + w.lift[i] * (1 - rgb[i]), 0);
    out[i] = Math.pow(v, 1 / Math.max(w.gamma[i], 0.01));
  }
  return out;
}


export function applyZonesJs(rgb, satZone, conZone) {
  const w = zoneWeightsJs(lumaJs(rgb));
  const sat = w[0] * satZone[0] + w[1] * satZone[1] + w[2] * satZone[2];
  const con = w[0] * conZone[0] + w[1] * conZone[1] + w[2] * conZone[2];
  const r = [0, 0, 0];
  for (let i = 0; i < 3; i++) r[i] = (rgb[i] - GRADE_CONTRAST_PIVOT) * con + GRADE_CONTRAST_PIVOT;
  const l2 = lumaJs([Math.max(r[0], 0), Math.max(r[1], 0), Math.max(r[2], 0)]);
  for (let i = 0; i < 3; i++) r[i] = Math.max(l2 + (r[i] - l2) * sat, 0);
  return r;
}


function parseTriple(chunk, lineIdx) {
  const parts = String(chunk).trim().split(/\s+/);
  if (parts.length !== 3) throw new Error("cube: DOMAIN na linha " + (lineIdx + 1) + " precisa de 3 números");
  const out = [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  if (!Number.isFinite(out[0]) || !Number.isFinite(out[1]) || !Number.isFinite(out[2])) {
    throw new Error("cube: DOMAIN não numérico na linha " + (lineIdx + 1));
  }
  return out;
}


export function parseCubeLut(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("cube: texto vazio");
  const lines = text.split(/\r\n|\r|\n/);
  let size = 0;
  let expected = 0;
  let cursor = 0;
  let data = null;
  let title = "";
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.charAt(0) === "#") continue;
    const up = line.toUpperCase();
    if (up.indexOf("TITLE") === 0) {
      const m = line.match(/^TITLE\s+"?([^"]*)"?\s*$/i);
      title = m ? m[1] : "";
      continue;
    }
    if (up.indexOf("LUT_1D_SIZE") === 0) throw new Error("cube: LUT 1D não suportada (esperado LUT_3D_SIZE)");
    if (up.indexOf("LUT_3D_SIZE") === 0) {
      const n = Number(line.slice(11).trim());
      if (!Number.isInteger(n) || n < LUT_SIZE_MIN || n > LUT_SIZE_MAX) {
        throw new Error("cube: LUT_3D_SIZE inválido (" + line + "; aceito " + LUT_SIZE_MIN + ".." + LUT_SIZE_MAX + ")");
      }
      size = n;
      expected = n * n * n;
      data = new Float32Array(expected * 3);
      continue;
    }
    if (up.indexOf("DOMAIN_MIN") === 0) {
      domainMin = parseTriple(line.slice(10), i);
      continue;
    }
    if (up.indexOf("DOMAIN_MAX") === 0) {
      domainMax = parseTriple(line.slice(10), i);
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length !== 3) throw new Error("cube: linha " + (i + 1) + " inválida (" + line + ")");
    if (!data) throw new Error("cube: dados antes do LUT_3D_SIZE (linha " + (i + 1) + ")");
    if (cursor >= expected) throw new Error("cube: mais dados que size³ (" + expected + ")");
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      throw new Error("cube: valor não numérico na linha " + (i + 1));
    }
    const o = cursor * 3;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    cursor++;
  }
  if (!size || !data) throw new Error("cube: LUT_3D_SIZE ausente");
  if (cursor !== expected) throw new Error("cube: esperava " + expected + " amostras, veio " + cursor);
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(domainMin[i]) || !Number.isFinite(domainMax[i]) || domainMax[i] - domainMin[i] < 1e-6) {
      throw new Error("cube: DOMAIN_MIN/DOMAIN_MAX inválidos");
    }
  }
  return { size, data, domainMin, domainMax, title };
}


export function lutDomainTransform(lut) {
  const mul = [0, 0, 0];
  const add = [0, 0, 0];
  for (let i = 0; i < 3; i++) {


    const lo = lut && lut.domainMin && Number.isFinite(lut.domainMin[i]) ? lut.domainMin[i] : 0;
    const hi = lut && lut.domainMax && Number.isFinite(lut.domainMax[i]) ? lut.domainMax[i] : 1;
    const span = hi - lo;
    const safe = Number.isFinite(span) && Math.abs(span) >= 1e-6 ? span : 1;
    mul[i] = 1 / safe;
    add[i] = -lo / safe;
  }
  return { mul, add };
}


export function sampleLutJs(lut, rgb) {
  const s = lut.size;
  const out = [0, 0, 0];
  const fx = clamp01(num(rgb[0], 0)) * (s - 1);
  const fy = clamp01(num(rgb[1], 0)) * (s - 1);
  const fz = clamp01(num(rgb[2], 0)) * (s - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, s - 1);
  const y1 = Math.min(y0 + 1, s - 1);
  const z1 = Math.min(z0 + 1, s - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  for (let ch = 0; ch < 3; ch++) {
    const v000 = lut.data[((z0 * s + y0) * s + x0) * 3 + ch];
    const v100 = lut.data[((z0 * s + y0) * s + x1) * 3 + ch];
    const v010 = lut.data[((z0 * s + y1) * s + x0) * 3 + ch];
    const v110 = lut.data[((z0 * s + y1) * s + x1) * 3 + ch];
    const v001 = lut.data[((z1 * s + y0) * s + x0) * 3 + ch];
    const v101 = lut.data[((z1 * s + y0) * s + x1) * 3 + ch];
    const v011 = lut.data[((z1 * s + y1) * s + x0) * 3 + ch];
    const v111 = lut.data[((z1 * s + y1) * s + x1) * 3 + ch];
    const a = v000 + (v100 - v000) * tx;
    const b = v010 + (v110 - v010) * tx;
    const c = v001 + (v101 - v001) * tx;
    const d = v011 + (v111 - v011) * tx;
    const e = a + (b - a) * ty;
    const f = c + (d - c) * ty;
    out[ch] = e + (f - e) * tz;
  }
  return out;
}


export function hashLutData(data) {
  let h = 0x811c9dc5;
  const n = data ? data.length : 0;
  for (let i = 0; i < n; i++) {
    const q = Math.round(data[i] * 100000) | 0;
    h ^= q & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}


export function packLutTo2D(lut) {
  const s = lut.size | 0;
  const width = s * s;
  const height = s;
  const out = new Uint8Array(width * height * 4);
  for (let z = 0; z < s; z++) {
    for (let g = 0; g < s; g++) {
      for (let r = 0; r < s; r++) {
        const src = ((z * s + g) * s + r) * 3;
        const px = (g * width + (z * s + r)) * 4;
        out[px] = Math.round(clamp01(lut.data[src]) * 255);
        out[px + 1] = Math.round(clamp01(lut.data[src + 1]) * 255);
        out[px + 2] = Math.round(clamp01(lut.data[src + 2]) * 255);
        out[px + 3] = 255;
      }
    }
  }
  return { width, height, data: out, size: s };
}


function scurve01(x) {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}


export function presetTransformJs(name, rgb) {
  const r0 = clamp01(num(rgb[0], 0));
  const g0 = clamp01(num(rgb[1], 0));
  const b0 = clamp01(num(rgb[2], 0));
  if (name === "FilmicCool") {
    const c = [r0 * 0.94, g0 * 1.0, b0 * 1.07];
    const w = zoneWeightsJs(lumaJs(c));
    c[2] += 0.03 * w[0];
    c[1] += 0.012 * w[0];
    c[0] += 0.02 * w[2];
    c[1] += 0.008 * w[2];
    for (let i = 0; i < 3; i++) c[i] = c[i] + (scurve01(c[i]) - c[i]) * 0.18;
    const l = lumaJs(c);
    for (let i = 0; i < 3; i++) c[i] = clamp01(l + (c[i] - l) * 0.92);
    return c;
  }
  if (name === "Golden") {
    const c = [r0 * 1.08, g0 * 1.0, b0 * 0.85];
    const w = zoneWeightsJs(lumaJs(c));
    c[0] += 0.012;
    c[1] += 0.006;
    c[1] += 0.01 * w[1];
    for (let i = 0; i < 3; i++) c[i] = c[i] + (scurve01(c[i]) - c[i]) * 0.1;
    const l = lumaJs(c);
    for (let i = 0; i < 3; i++) c[i] = clamp01(l + (c[i] - l) * 1.06);
    return c;
  }
  if (name === "Noir") {
    const l0 = lumaJs([r0, g0, b0]);
    const c = [l0 + (r0 - l0) * 0.12, l0 + (g0 - l0) * 0.12, l0 + (b0 - l0) * 0.12];
    c[0] *= 0.97;
    c[2] *= 1.05;
    for (let i = 0; i < 3; i++) c[i] = c[i] + (scurve01(c[i]) - c[i]) * 0.45;
    for (let i = 0; i < 3; i++) c[i] = clamp01(c[i] * 1.05 - 0.02);
    return c;
  }
  return [r0, g0, b0];
}

const bakeCache = new Map();


export function bakePresetLut(name, sizeRaw) {
  const preset = resolveGradingPreset(name);
  const s = Math.max(LUT_SIZE_MIN, Math.min(LUT_SIZE_MAX, (sizeRaw | 0) || LUT_BAKE_SIZE));
  const key = preset + "|" + s;
  const hit = bakeCache.get(key);
  if (hit) return hit;
  const data = new Float32Array(s * s * s * 3);
  const inv = 1 / (s - 1);
  let o = 0;
  for (let b = 0; b < s; b++) {
    for (let g = 0; g < s; g++) {
      for (let r = 0; r < s; r++) {
        const v = presetTransformJs(preset, [r * inv, g * inv, b * inv]);
        data[o] = v[0];
        data[o + 1] = v[1];
        data[o + 2] = v[2];
        o += 3;
      }
    }
  }
  const lut = { size: s, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1], title: "preset:" + preset };
  bakeCache.set(key, lut);
  return lut;
}


export function buildGradingPlan(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const props = sanitizeGradingProps(src);
  const wheels = sanitizeWheels(src.wheels);
  const wb = whiteBalanceMatrix(props.temp, props.tint);
  let parsed = null;
  let source = "none";
  const ext = src.lutParsed;


  if (
    ext && ext.data && Number.isInteger(ext.size) &&
    ext.size >= LUT_SIZE_MIN && ext.size <= LUT_SIZE_MAX &&
    ext.data.length === ext.size * ext.size * ext.size * 3
  ) {
    const dMin = [0, 1, 2].map((i) => (ext.domainMin && Number.isFinite(ext.domainMin[i]) ? ext.domainMin[i] : 0));
    const dMax = [0, 1, 2].map((i) => {
      const v = ext.domainMax && Number.isFinite(ext.domainMax[i]) ? ext.domainMax[i] : 1;
      return Math.abs(v - dMin[i]) >= 1e-6 ? v : dMin[i] + 1;
    });
    parsed = { size: ext.size, data: ext.data, domainMin: dMin, domainMax: dMax, title: typeof ext.title === "string" ? ext.title : "" };
    source = src.lutSource === "asset" ? "asset" : "handle";
  } else if (props.preset !== "None") {
    parsed = bakePresetLut(props.preset, LUT_BAKE_SIZE);
    source = "preset";
  }
  let lut = null;
  if (parsed && props.lutAmount > 0) {
    const packed = packLutTo2D(parsed);
    const dom = lutDomainTransform(parsed);
    const label = source === "preset" ? props.preset : String(src.lutLabel || "lut");


    const contentSig = source === "preset" ? "preset:" + props.preset : "h:" + hashLutData(parsed.data);
    const domSig = parsed.domainMin.join(",") + ">" + parsed.domainMax.join(",");
    lut = {
      on: true,
      size: parsed.size,
      width: packed.width,
      height: packed.height,
      data: packed.data,
      amount: props.lutAmount,
      domainMul: dom.mul,
      domainAdd: dom.add,
      source,
      title: parsed.title || "",
      signature: source + "|" + label + "|" + parsed.size + "|" + contentSig + "|" + domSig,
    };
  }
  const signature = [
    props.temp,
    props.tint,
    props.preset,
    props.lutAmount,
    lut ? lut.signature : "lut-off",
    wheels.on
      ? wheels.lift.join(",") + ";" + wheels.gamma.join(",") + ";" + wheels.gain.join(",") + ";" + wheels.satZone.join(",") + ";" + wheels.conZone.join(",")
      : "wheels-neutros",
  ].join("|");
  return { wb, wheels, lut, preset: props.preset, signature };
}


export function gradingGlslChunk() {
  return `
float rswGrLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
vec3 rswGrZoneWeights(float l) {
  float ws = 1.0 - smoothstep(0.0, 0.33, l);
  float wh = smoothstep(0.55, 1.0, l);
  float wm = max(1.0 - ws - wh, 0.0);
  return vec3(ws, wm, wh);
}
vec3 rswGrWheels(vec3 c, vec3 liftW, vec3 gammaW, vec3 gainW) {
  vec3 v = gainW * c + liftW * (vec3(1.0) - c);
  v = max(v, vec3(0.0));
  return pow(v, vec3(1.0) / max(gammaW, vec3(0.01)));
}
vec3 rswGrZones(vec3 c, vec3 satZone, vec3 conZone) {
  vec3 w = rswGrZoneWeights(rswGrLuma(c));
  float sat = dot(w, satZone);
  float con = dot(w, conZone);
  vec3 v = (c - vec3(0.18)) * con + vec3(0.18);
  float l2 = rswGrLuma(max(v, vec3(0.0)));
  v = vec3(l2) + (v - vec3(l2)) * sat;
  return max(v, vec3(0.0));
}
vec3 rswLutSample(sampler2D lutTex, vec3 c, float lutSize) {
  float s = max(lutSize, 2.0);
  vec3 cc = clamp(c, 0.0, 1.0);
  float zf = cc.b * (s - 1.0);
  float z0 = floor(zf);
  float zt = zf - z0;
  float z1 = min(z0 + 1.0, s - 1.0);
  float u = (cc.r * (s - 1.0) + 0.5) / (s * s);
  float v = (cc.g * (s - 1.0) + 0.5) / s;
  float du = 1.0 / s;
  vec3 lo = texture2D(lutTex, vec2(u + z0 * du, v)).rgb;
  vec3 hi = texture2D(lutTex, vec2(u + z1 * du, v)).rgb;
  return lo + (hi - lo) * zt;
}
`;
}
