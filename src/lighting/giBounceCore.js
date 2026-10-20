import { NEON_NITS, nitsToRadiance } from "./emissiveNitsCore.js";

export const GI_BOUNCE_VERSION = "gi-bounce-39a";

export const GI_BOUNCE_MAX_EXTRA = 2;


export const GI_BOUNCE_EXTRA_SWEEPS = 2;

export const GI_MAX_EMISSIVES = 24;
export const GI_MAX_EMISSIVES_LITE = 8;
export const GI_EMISSIVE_MAX_NITS = 4000;


export const GI_EMISSIVE_GAIN = 0.22;

export const GI_SPEC_AMOUNT = 0.35;
export const GI_SPEC_ROUGH_MIN = 0.45;
export const GI_SPEC_ROUGH_SPAN = 0.4;

export const GI_SPEC_BASIC_W = 0.25;


export const GI_BOUNCE_BUDGET_MS_HI = 2.5;
export const GI_BOUNCE_BUDGET_MS_LITE = 1;

export const GI_EMISSIVES_PER_SLICE = 2;

export const GI_NEON_NITS = NEON_NITS;


const FACE_COUNT = 6;
const WORLD_CAP = 10000;
const HALF_CAP = 512;

function fin(v, d) {
  return Number.isFinite(v) ? v : d;
}

function clamp01(v) {
  v = fin(v, 0);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}


export function resolveGiBounceFlag(raw, ctx) {
  const c = ctx || {};
  if (c.giActive !== true) return false;
  if (raw === false) return false;
  if (raw === true) return true;
  return c.realistic === true && c.weak !== true && c.tech === "Future";
}


export function giBouncePlan(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const weak = o.weak === true;
  const on = resolveGiBounceFlag(o.flag, {
    giActive: o.giActive === true,
    realistic: o.realistic === true,
    weak,
    tech: typeof o.tech === "string" ? o.tech : "",
  });
  const lite = on && weak;
  const tier = typeof o.tier === "string" ? o.tier : "";
  const hi = tier === "high" || tier === "ultra";
  const extraBounces = !on ? 0 : lite ? 1 : hi ? GI_BOUNCE_MAX_EXTRA : 1;
  const specularGi = on && !lite;
  let reason;
  if (o.giActive !== true) reason = "gi-inativa";
  else if (o.flag === false) reason = "veto";
  else if (o.flag === true) reason = lite ? "forcado-lite-fraco" : "forcado";
  else if (on) reason = "auto-realistic-future";
  else if (weak) reason = "auto-off-fraco";
  else reason = "auto-off";
  return Object.freeze({
    on,
    lite,
    reason,
    extraBounces,
    extraSweeps: GI_BOUNCE_EXTRA_SWEEPS,
    emissiveGi: on,
    maxEmissives: lite ? GI_MAX_EMISSIVES_LITE : GI_MAX_EMISSIVES,
    specularGi,
    specAmount: specularGi ? GI_SPEC_AMOUNT : 0,
    budgetMs: lite ? GI_BOUNCE_BUDGET_MS_LITE : GI_BOUNCE_BUDGET_MS_HI,
  });
}


export function emissiveRadiance(nits) {
  const n = Math.min(GI_EMISSIVE_MAX_NITS, Math.max(0, fin(nits, 0)));
  return nitsToRadiance(n) * GI_EMISSIVE_GAIN;
}


export function sanitizeEmissives(list, maxN) {
  const out = [];
  if (!Array.isArray(list)) return out;
  const cap = Math.min(GI_MAX_EMISSIVES, Math.max(0, fin(maxN, GI_MAX_EMISSIVES)) | 0);
  for (let i = 0; i < list.length && out.length < cap; i++) {
    const e = list[i];
    if (!e || !e.c || !e.h) continue;
    const cx = fin(e.c[0], NaN), cy = fin(e.c[1], NaN), cz = fin(e.c[2], NaN);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) continue;
    if (Math.abs(cx) > WORLD_CAP || Math.abs(cy) > WORLD_CAP || Math.abs(cz) > WORLD_CAP) continue;
    const hx = Math.min(HALF_CAP, Math.abs(fin(e.h[0], 0)));
    const hy = Math.min(HALF_CAP, Math.abs(fin(e.h[1], 0)));
    const hz = Math.min(HALF_CAP, Math.abs(fin(e.h[2], 0)));
    if (Math.max(hx, hy, hz) < 0.01) continue;
    const nits = Math.min(GI_EMISSIVE_MAX_NITS, Math.max(0, fin(e.nits, 0)));
    if (nits <= 0) continue;
    const rec = {
      c: [cx, cy, cz],
      h: [hx, hy, hz],
      color: [clamp01(e.color ? e.color[0] : 1), clamp01(e.color ? e.color[1] : 1), clamp01(e.color ? e.color[2] : 1)],
      nits,
    };


    if (e.axes && e.axes[0] && e.axes[1] && e.axes[2]) rec.axes = e.axes;
    out.push(rec);
  }
  return out;
}


export function pickTopLights(lights, maxN) {
  const cap = Math.max(0, fin(maxN, 16)) | 0;
  if (!Array.isArray(lights) || cap === 0) return [];
  const scored = [];
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    if (!l || !l.pos) continue;
    const inten = fin(l.intensity, NaN);
    const range = fin(l.range, NaN);
    if (!Number.isFinite(inten) || !Number.isFinite(range)) continue;
    if (inten <= 0 || range <= 0) continue;
    scored.push({ i, s: inten * range * range, l });
  }
  scored.sort((a, b) => (b.s - a.s) || (a.i - b.i));
  const out = [];
  for (let k = 0; k < scored.length && out.length < cap; k++) out.push(scored[k].l);
  return out;
}


export function injectEmissives(grid, emissives, from = 0, to = Infinity) {
  if (!grid || !Array.isArray(emissives) || !emissives.length) return 0;
  const { dim, cell, origin, occ, src } = grid;
  const lut = grid.surfLut;
  const mask = grid.surfMask;
  const fsrc = grid.faceSrc;
  if (!lut || !mask || !fsrc || !occ || !src) return 0;
  const inv = 1 / cell;
  const pad = cell * 0.45;
  let touched = 0;
  const end = Math.min(to, emissives.length, GI_MAX_EMISSIVES);
  for (let bi = Math.max(0, from); bi < end; bi++) {
    const e = emissives[bi];
    if (!e || !e.c || !e.h) continue;
    const rad = emissiveRadiance(e.nits);
    if (rad <= 0) continue;
    const cx = fin(e.c[0], NaN), cy = fin(e.c[1], NaN), cz = fin(e.c[2], NaN);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) continue;
    if (Math.abs(cx) > WORLD_CAP || Math.abs(cy) > WORLD_CAP || Math.abs(cz) > WORLD_CAP) continue;
    const hx = Math.min(HALF_CAP, Math.abs(fin(e.h[0], 0)));
    const hy = Math.min(HALF_CAP, Math.abs(fin(e.h[1], 0)));
    const hz = Math.min(HALF_CAP, Math.abs(fin(e.h[2], 0)));
    if (Math.max(hx, hy, hz) < 0.01) continue;
    const er = clamp01(e.color ? e.color[0] : 1) * rad;
    const eg = clamp01(e.color ? e.color[1] : 1) * rad;
    const eb = clamp01(e.color ? e.color[2] : 1) * rad;
    if (er <= 0 && eg <= 0 && eb <= 0) continue;
    const ax = e.axes ? e.axes[0] : null;
    const ay = e.axes ? e.axes[1] : null;
    const az = e.axes ? e.axes[2] : null;

    let ex, ey, ez;
    if (ax && ay && az) {
      ex = Math.abs(ax[0]) * hx + Math.abs(ay[0]) * hy + Math.abs(az[0]) * hz;
      ey = Math.abs(ax[1]) * hx + Math.abs(ay[1]) * hy + Math.abs(az[1]) * hz;
      ez = Math.abs(ax[2]) * hx + Math.abs(ay[2]) * hy + Math.abs(az[2]) * hz;
    } else {
      ex = hx; ey = hy; ez = hz;
    }
    let x0 = Math.floor((cx - ex - pad - origin[0]) * inv);
    let x1 = Math.floor((cx + ex + pad - origin[0]) * inv);
    let y0 = Math.floor((cy - ey - pad - origin[1]) * inv);
    let y1 = Math.floor((cy + ey + pad - origin[1]) * inv);
    let z0 = Math.floor((cz - ez - pad - origin[2]) * inv);
    let z1 = Math.floor((cz + ez + pad - origin[2]) * inv);
    if (x1 < 0 || y1 < 0 || z1 < 0 || x0 >= dim || y0 >= dim || z0 >= dim) continue;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); z0 = Math.max(0, z0);
    x1 = Math.min(dim - 1, x1); y1 = Math.min(dim - 1, y1); z1 = Math.min(dim - 1, z1);
    for (let z = z0; z <= z1; z++) {
      const pz = origin[2] + (z + 0.5) * cell - cz;
      for (let y = y0; y <= y1; y++) {
        const py = origin[1] + (y + 0.5) * cell - cy;
        for (let x = x0; x <= x1; x++) {
          const px = origin[0] + (x + 0.5) * cell - cx;
          let inside;
          if (ax && ay && az) {
            inside =
              Math.abs(px * ax[0] + py * ax[1] + pz * ax[2]) <= hx + pad &&
              Math.abs(px * ay[0] + py * ay[1] + pz * ay[2]) <= hy + pad &&
              Math.abs(px * az[0] + py * az[1] + pz * az[2]) <= hz + pad;
          } else {
            inside = Math.abs(px) <= hx + pad && Math.abs(py) <= hy + pad && Math.abs(pz) <= hz + pad;
          }
          if (!inside) continue;
          const i = x + dim * (y + dim * z);
          if (!occ[i]) continue;                                           
          const si = lut[i];
          if (si < 0) continue;                                          
          const m = mask[si];
          const fb = si * 18;
          let hit = false;
          for (let f = 0; f < FACE_COUNT; f++) {
            if (!((m >> f) & 1)) continue;
            fsrc[fb + f * 3] += er;
            fsrc[fb + f * 3 + 1] += eg;
            fsrc[fb + f * 3 + 2] += eb;
            src[i * 3] += er;
            src[i * 3 + 1] += eg;
            src[i * 3 + 2] += eb;
            hit = true;
          }
          if (hit) touched += 1;
        }
      }
    }
  }
  return touched;
}


export function giSpecWeightJs(roughness) {


  const w = (fin(roughness, 0) - GI_SPEC_ROUGH_MIN) / GI_SPEC_ROUGH_SPAN;
  if (!Number.isFinite(w)) return 0;
  if (w >= 1 - 1e-9) return 1;
  return w <= 0 ? 0 : w;
}


export function giSpecRoughFromShininess(shininess) {
  const s = Math.max(fin(shininess, 30), 1e-4);
  const r = Math.sqrt(2 / (s + 2));
  return r > 1 ? 1 : r;
}

export function giSpecWeightBasicJs(shininess) {
  return giSpecWeightJs(giSpecRoughFromShininess(shininess));
}


export function buildGiSpecularGlsl(standard) {


  const weightLine = standard
    ? "\tfloat rswGiSpecW = clamp( ( material.roughness - " + GI_SPEC_ROUGH_MIN.toFixed(2) + " ) / " + GI_SPEC_ROUGH_SPAN.toFixed(2) + ", 0.0, 1.0 );"
    : "\tfloat rswGiSpecRough = clamp( sqrt( 2.0 / ( max( material.specularShininess, 1e-4 ) + 2.0 ) ), 0.0, 1.0 );\n\tfloat rswGiSpecW = clamp( ( rswGiSpecRough - " + GI_SPEC_ROUGH_MIN.toFixed(2) + " ) / " + GI_SPEC_ROUGH_SPAN.toFixed(2) + ", 0.0, 1.0 );";
  return [
    "",
    "if ( uRswGiSpec > 0.001 ) {",
    weightLine,
    "\treflectedLight.indirectSpecular += rswSampleGi( vRswGiPos, normal ) * uRswGiSpec * rswGiSpecW * rswSampleSkyA( vRswGiPos, normal );",
    "}",
    "",
  ].join("\n");
}
