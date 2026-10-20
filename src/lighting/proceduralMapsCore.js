export const PBR_MAPS_VERSION = 1;
export const NORMAL_GREEN_SIGN = 1;                                               
export const AO_GAIN = 4;                                                               

function assert(cond, msg) {
  if (!cond) throw new Error("proceduralMapsCore: " + msg);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrap = (i, n) => ((i % n) + n) % n;


export function heightFromRgba(rgba, w, h) {
  assert(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0, "dimensões inválidas");
  assert(rgba && rgba.length === w * h * 4, "RGBA deve ter w*h*4 bytes");
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) / 255;
  }
  return out;
}


export function sobelGradients(height, w, h) {
  assert(height.length === w * h, "height deve ter w*h floats");
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const rm = wrap(y - 1, h) * w;
    const r0 = y * w;
    const rp = wrap(y + 1, h) * w;
    for (let x = 0; x < w; x++) {
      const xm = wrap(x - 1, w);
      const xp = wrap(x + 1, w);
      const a = height[rm + xm];
      const b = height[rm + x];
      const c = height[rm + xp];
      const d = height[r0 + xm];
      const f = height[r0 + xp];
      const g = height[rp + xm];
      const i = height[rp + x];
      const k = height[rp + xp];
      gx[r0 + x] = (c + 2 * f + k - (a + 2 * d + g)) / 8;
      gy[r0 + x] = (g + 2 * i + k - (a + 2 * b + c)) / 8;
    }
  }
  return { gx, gy };
}


export function normalRgbaFromHeight(height, w, h, strength = 4) {
  assert(Number.isFinite(strength) && strength >= 0, "strength deve ser finito e >= 0");
  assert(height.length === w * h, "height deve ter w*h floats");
  const out = new Uint8ClampedArray(w * h * 4);
  if (strength === 0) {
    for (let p = 0; p < out.length; p += 4) {
      out[p] = 128;
      out[p + 1] = 128;
      out[p + 2] = 255;
      out[p + 3] = 255;
    }
    return out;
  }
  const { gx, gy } = sobelGradients(height, w, h);
  for (let i = 0, p = 0; i < gx.length; i++, p += 4) {
    const nx = -gx[i] * strength;
    const ny = NORMAL_GREEN_SIGN * gy[i] * strength;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);                         
    out[p] = Math.round((nx * inv * 0.5 + 0.5) * 255);
    out[p + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
    out[p + 2] = Math.round((inv * 0.5 + 0.5) * 255);
    out[p + 3] = 255;
  }
  return out;
}


export function roughnessFromHeight(height, w, h, base = 0.8, variation = 0.1) {
  assert(base >= 0 && base <= 1, "base deve estar em 0..1");
  assert(variation >= 0 && variation <= 1, "variation deve estar em 0..1");
  assert(height.length === w * h, "height deve ter w*h floats");
  let mean = 0;
  for (let i = 0; i < height.length; i++) mean += height[i];
  mean /= height.length || 1;
  const out = new Float32Array(w * h);
  for (let i = 0; i < height.length; i++) {
    out[i] = clamp01(base + variation * (mean - height[i]) * 2);
  }
  return out;
}


export function boxBlurToroidal(src, w, h, radius) {
  assert(Number.isInteger(radius) && radius >= 1 && radius <= 8, "radius deve ser inteiro 1..8");
  assert(src.length === w * h, "src deve ter w*h floats");
  const n = 2 * radius + 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += src[row + wrap(x + k, w)];
      tmp[row + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += tmp[wrap(y + k, h) * w + x];
      out[y * w + x] = s / n;
    }
  }
  return out;
}


export function aoFromHeight(height, w, h, radius = 3, strength = 0.6) {
  assert(strength >= 0 && strength <= 1, "strength deve estar em 0..1");
  const mean = boxBlurToroidal(height, w, h, radius);
  const out = new Float32Array(w * h);
  for (let i = 0; i < height.length; i++) {
    out[i] = 1 - clamp01((mean[i] - height[i]) * AO_GAIN) * strength;
  }
  return out;
}


export function packOrm(ao, rough, metal, w, h) {
  assert(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0, "dimensões inválidas");
  const n = w * h;
  assert(ao.length === n && rough.length === n, "ao/rough devem ter w*h floats");
  const metalField = typeof metal === "number" ? null : metal;
  if (metalField) assert(metalField.length === n, "metal deve ser escalar ou campo w*h");
  if (!metalField) assert(Number.isFinite(metal), "metal escalar deve ser finito");
  const mByte = metalField ? 0 : Math.round(clamp01(metal) * 255);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[p] = Math.round(clamp01(ao[i]) * 255);
    out[p + 1] = Math.round(clamp01(rough[i]) * 255);
    out[p + 2] = metalField ? Math.round(clamp01(metalField[i]) * 255) : mByte;
    out[p + 3] = 255;
  }
  return out;
}


function tune(over) {
  return Object.freeze({
    normalStrength: 4,                                                   
    roughBase: 0.8,                                                      
    roughVar: 0.1,
    aoStrength: 0.6,
    aoRadius: 3,
    ...over,
  });
}

export const MAP_TUNING_DEFAULTS = tune({});

export const MAP_TUNING_BY_PATTERN = Object.freeze({
  flat: tune({ normalStrength: 0, roughVar: 0, aoStrength: 0 }),
  smooth: tune({ normalStrength: 2, roughVar: 0.05, aoStrength: 0.3 }),
  speckle: tune({ normalStrength: 4, roughVar: 0.1 }),
  grain: tune({ normalStrength: 5, roughVar: 0.15, roughBase: 0.7 }),
  planks: tune({ normalStrength: 7, roughVar: 0.18, roughBase: 0.7, aoStrength: 0.7, aoRadius: 4 }),
  bricks: tune({ normalStrength: 8, roughVar: 0.2, roughBase: 0.85, aoStrength: 0.75, aoRadius: 4 }),
  cobble: tune({ normalStrength: 8, roughVar: 0.2, roughBase: 0.85, aoStrength: 0.75, aoRadius: 5 }),
  facets: tune({ normalStrength: 6, roughVar: 0.15, roughBase: 0.9 }),
  strata: tune({ normalStrength: 5, roughVar: 0.12, roughBase: 0.85 }),
  veins: tune({ normalStrength: 3, roughVar: 0.15, roughBase: 0.35 }),                  
  cracks: tune({ normalStrength: 7, roughVar: 0.2, roughBase: 0.9, aoStrength: 0.8, aoRadius: 4 }),
  tiles: tune({ normalStrength: 6, roughVar: 0.15, roughBase: 0.6, aoStrength: 0.7 }),
  diamond: tune({ normalStrength: 7, roughVar: 0.1, roughBase: 0.35 }),
  brushed: tune({ normalStrength: 3, roughVar: 0.08, roughBase: 0.35 }),
  foil: tune({ normalStrength: 4, roughVar: 0.1, roughBase: 0.25 }),
  rust: tune({ normalStrength: 6, roughVar: 0.25, roughBase: 0.75, aoStrength: 0.7, aoRadius: 4 }),
  blades: tune({ normalStrength: 5, roughVar: 0.15, roughBase: 0.9 }),
  weave: tune({ normalStrength: 5, roughVar: 0.12, roughBase: 0.9 }),
  fibers: tune({ normalStrength: 4, roughVar: 0.1, roughBase: 0.9 }),
  creases: tune({ normalStrength: 5, roughVar: 0.15, roughBase: 0.65 }),
  blotch: tune({ normalStrength: 5, roughVar: 0.18, roughBase: 0.95 }),
  glass: tune({ normalStrength: 1, roughVar: 0.03, roughBase: 0.08, aoStrength: 0 }),
  icy: tune({ normalStrength: 2, roughVar: 0.06, roughBase: 0.15, aoStrength: 0 }),
});


export function tuningForDef(def) {
  const base = (def && MAP_TUNING_BY_PATTERN[def.pattern]) || MAP_TUNING_DEFAULTS;
  return Object.freeze({ ...base, metalness: def && def.metal ? 1 : 0 });
}


export function buildPbrMapsFromRgba(rgba, w, h, tuning) {
  const t = tuning || tuningForDef(null);
  const height = heightFromRgba(rgba, w, h);
  const normalRgba = normalRgbaFromHeight(height, w, h, t.normalStrength);
  const rough = roughnessFromHeight(height, w, h, t.roughBase, t.roughVar);
  const ao = t.aoStrength > 0
    ? aoFromHeight(height, w, h, t.aoRadius, t.aoStrength)
    : new Float32Array(w * h).fill(1);
  const ormRgba = packOrm(ao, rough, typeof t.metalness === "number" ? t.metalness : 0, w, h);
  return { normalRgba, ormRgba };
}
