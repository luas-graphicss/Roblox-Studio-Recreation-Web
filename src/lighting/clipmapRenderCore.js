import {
  sanitizeClipmapConfig,
  pageWorldSize,
} from "./clipmapCore.js";

export const CLIPMAP_RENDER_VERSION = "sun-clipmap-17bc";

export const CLIPMAP_RENDER_LIMITS = Object.freeze({


  budgetMedium: 4,
  budgetHigh: 8,
  budgetUltra: 16,

  blendFraction: 0.1,

  biasCapK: 6,

  pcfTaps: 9,
});

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function wrapMod(v, m) {
  if (!(m > 0)) return 0;
  const r = v % m;
  return r < 0 ? r + m : r;
}


export function clipPagesBudgetForTier(tier) {
  if (tier === "medium") return CLIPMAP_RENDER_LIMITS.budgetMedium;
  if (tier === "high") return CLIPMAP_RENDER_LIMITS.budgetHigh;
  if (tier === "ultra") return CLIPMAP_RENDER_LIMITS.budgetUltra;
  return 0;
}


export function parsePageKey(key) {
  if (typeof key !== "string") return null;
  const a = key.split(":");
  if (a.length !== 3) return null;
  const level = Number(a[0]);
  const col = Number(a[1]);
  const row = Number(a[2]);
  if (!Number.isFinite(level) || !Number.isFinite(col) || !Number.isFinite(row)) return null;
  return { level, col, row };
}


export function pageCheckByte(col, row, grid) {
  const g = Math.max(1, Math.round(num(grid, 1)));
  return wrapMod(Math.floor(num(col, 0) / g), 16) * 16 + wrapMod(Math.floor(num(row, 0) / g), 16);
}


export function tableSizeFor(cfg) {
  const c = sanitizeClipmapConfig(cfg);
  return { width: c.gridPerLevel, height: c.gridPerLevel * c.levels };
}


export function tableIndexFor(cfg, level, col, row) {
  const c = sanitizeClipmapConfig(cfg);
  const n = Math.round(num(level, -1));
  if (n < 0 || n >= c.levels) return -1;
  const g = c.gridPerLevel;
  const x = wrapMod(Math.round(num(col, 0)), g);
  const y = n * g + wrapMod(Math.round(num(row, 0)), g);
  return (y * g + x) * 4;
}


export function buildTableData(cfg, entries, windows, isDirty, out) {
  const c = sanitizeClipmapConfig(cfg);
  const g = c.gridPerLevel;
  const need = g * g * c.levels * 4;
  if (!out || typeof out.fill !== "function" || num(out.length, 0) < need) return -1;
  out.fill(0);
  if (!entries || typeof entries.forEach !== "function") return 0;
  const dirtyFn = typeof isDirty === "function" ? isDirty : null;
  let count = 0;
  entries.forEach(function (value, key) {
    const p = parsePageKey(key);
    if (!p || p.level < 0 || p.level >= c.levels) return;
    const w = Array.isArray(windows) ? windows[p.level] : null;
    if (!w || !Number.isFinite(w.c0) || !Number.isFinite(w.r0)) return;
    if (p.col < w.c0 || p.col > w.c0 + g - 1 || p.row < w.r0 || p.row > w.r0 + g - 1) return;
    if (dirtyFn && dirtyFn(key)) return;
    let slot = -1;
    if (typeof value === "number") slot = value;
    else if (value && typeof value.slot === "number") slot = value.slot;
    if (!(slot >= 0 && slot < c.atlasPages)) return;
    const idx = ((p.level * g + wrapMod(p.row, g)) * g + wrapMod(p.col, g)) * 4;
    out[idx] = slot % c.atlasGrid;
    out[idx + 1] = Math.floor(slot / c.atlasGrid);
    out[idx + 2] = pageCheckByte(p.col, p.row, g);
    out[idx + 3] = 255;
    count++;
  });
  return count;
}


export function planRenderQueue(freshKeys, dirtyKeys, slotFor, budget) {
  const out = { items: [], deferredFreshKeys: [], consumedKeys: [], droppedKeys: [] };
  const b = Math.max(0, Math.floor(num(budget, 0)));
  const fn = typeof slotFor === "function" ? slotFor : function () { return -1; };
  const parseAll = function (keys) {
    const list = [];
    if (!Array.isArray(keys)) return list;
    for (const k of keys) {
      const p = parsePageKey(k);
      if (p) list.push({ key: k, level: p.level, col: p.col, row: p.row });
    }
    list.sort(function (a, z) {
      if (a.level !== z.level) return a.level - z.level;
      if (a.col !== z.col) return a.col - z.col;
      return a.row - z.row;
    });
    return list;
  };
  const seen = new Set();
  const takeFrom = function (list, isFresh) {
    for (const it of list) {
      if (seen.has(it.key)) continue;
      if (out.items.length >= b) {
        if (isFresh) out.deferredFreshKeys.push(it.key);
        continue;
      }
      const slot = num(fn(it.key), -1);
      if (slot < 0) {
        if (!isFresh) out.droppedKeys.push(it.key);
        continue;
      }
      seen.add(it.key);
      out.items.push({ key: it.key, slot: slot, level: it.level, col: it.col, row: it.row });
      out.consumedKeys.push(it.key);
    }
  };
  takeFrom(parseAll(freshKeys), true);
  takeFrom(parseAll(dirtyKeys), false);
  return out;
}


export function jsClipLightPlane(scX, scY, centerU, centerV, halfX, halfY) {
  return {
    u: (num(scX, 0) - 0.5) * (2 * num(halfX, 0)) + num(centerU, 0),
    v: (num(scY, 0) - 0.5) * (2 * num(halfY, 0)) + num(centerV, 0),
  };
}


export function jsClipAtlasUv(cfg, level, slot, u, v) {
  const c = sanitizeClipmapConfig(cfg);
  const pw = pageWorldSize(c, level);
  if (!(pw > 0)) return null;
  const col = Math.floor(num(u, 0) / pw);
  const row = Math.floor(num(v, 0) / pw);
  const inX = num(u, 0) / pw - col;
  const inY = num(v, 0) / pw - row;
  const texel = c.atlasSize > 0 ? 1 / c.atlasSize : 0;
  const s = Math.round(num(slot, -1));
  if (!(s >= 0 && s < c.atlasPages)) return null;
  const sx = (s % c.atlasGrid) * c.pageSize;
  const sy = Math.floor(s / c.atlasGrid) * c.pageSize;
  const mnU = (sx + 1.5) * texel;
  const mnV = (sy + 1.5) * texel;
  const mxU = (sx + c.pageSize - 1.5) * texel;
  const mxV = (sy + c.pageSize - 1.5) * texel;
  const rawU = (sx + inX * c.pageSize) * texel;
  const rawV = (sy + inY * c.pageSize) * texel;
  return {
    col: col,
    row: row,
    u: Math.min(Math.max(rawU, mnU), mxU),
    v: Math.min(Math.max(rawV, mnV), mxV),
    mnU: mnU,
    mnV: mnV,
    mxU: mxU,
    mxV: mxV,
  };
}


export const CLIPMAP_SAMPLE_GLSL_UNIFORMS =
  "uniform sampler2D uRswClipAtlas;\n" +
  "uniform sampler2D uRswClipTable;\n" +
  "uniform vec4 uRswClipWinA;\n" +                                                       
  "uniform vec4 uRswClipCam;\n" +                                                                          
  "uniform vec4 uRswClipAtl;\n";                                                                


export function buildClipmapSampleGlsl() {
  return (
    "#if NUM_DIR_LIGHT_SHADOWS > 0\n" +
    "float rswClipPageVis( const in float lvl, const in vec2 lp, const in float zc, const in float biasBase ) {\n" +
    "  float pw = uRswClipCam.z * exp2( lvl );\n" +
    "  float grid = max( uRswClipCam.w, 1.0 );\n" +
    "  float lvs = max( uRswClipLevels, 1.0 );\n" +
    "  if ( pw <= 0.0 ) return -1.0;\n" +
    "  float colF = floor( lp.x / pw );\n" +
    "  float rowF = floor( lp.y / pw );\n" +
    "  vec2 tuv = vec2( ( mod( colF, grid ) + 0.5 ) / grid, ( lvl * grid + mod( rowF, grid ) + 0.5 ) / ( grid * lvs ) );\n" +
    "  vec4 te = texture2D( uRswClipTable, tuv );\n" +
    "  if ( te.a < 0.5 ) return -1.0;\n" +
    "  float bc = mod( floor( colF / grid ), 16.0 ) * 16.0 + mod( floor( rowF / grid ), 16.0 );\n" +
    "  if ( abs( te.b * 255.0 - bc ) > 0.5 ) return -1.0;\n" +
    "  float pagePx = max( uRswClipAtl.y, 1.0 );\n" +
    "  float texelUv = uRswClipAtl.x;\n" +
    "  vec2 slotPx = floor( te.rg * 255.0 + 0.5 ) * pagePx;\n" +
    "  vec2 inPage = vec2( lp.x / pw - colF, lp.y / pw - rowF );\n" +
    "  vec2 mn = ( slotPx + vec2( 1.5 ) ) * texelUv;\n" +
    "  vec2 mx = ( slotPx + vec2( pagePx - 1.5 ) ) * texelUv;\n" +
    "  vec2 uv0 = clamp( ( slotPx + inPage * pagePx ) * texelUv, mn, mx );\n" +
    "  float zRef = zc + biasBase * clamp( exp2( lvl ), 1.0, 6.0 );\n" +
    "  float sum = 0.0;\n" +
    "  for ( int i = 0; i < 9; i ++ ) {\n" +
    "    float fi = float( i );\n" +
    "    vec2 off = vec2( mod( fi, 3.0 ) - 1.0, floor( fi / 3.0 ) - 1.0 ) * texelUv;\n" +
    "    vec2 uv = clamp( uv0 + off, mn, mx );\n" +
    "    sum += ( zRef <= rswUnpackDepth( texture2D( uRswClipAtlas, uv ) ) ) ? 1.0 : 0.0;\n" +
    "  }\n" +
    "  return sum / 9.0;\n" +
    "}\n" +
    "float rswClipShadow() {\n" +
    "  vec4 sc = vDirectionalShadowCoord[ 0 ];\n" +
    "  float biasBase = directionalLightShadows[ 0 ].shadowBias;\n" +
    "  vec3 p = sc.xyz / max( sc.w, 0.000001 );\n" +
    "  if ( p.z <= 0.0 || p.z >= 1.0 ) return -1.0;\n" +
    "  if ( uRswClipWinA.z <= 0.0 || uRswClipWinA.w <= 0.0 ) return -1.0;\n" +
    "  vec2 lp = ( p.xy - vec2( 0.5 ) ) * ( 2.0 * uRswClipWinA.zw ) + uRswClipWinA.xy;\n" +
    "  float dc = max( abs( lp.x - uRswClipCam.x ), abs( lp.y - uRswClipCam.y ) );\n" +
    "  float lvl = rswClipLevelFor( dc );\n" +
    "  float vis = rswClipPageVis( lvl, lp, p.z, biasBase );\n" +
    "  float hf = max( uRswClipHalf0 * exp2( lvl ), 0.0001 );\n" +
    "  float edge = clamp( dc / hf, 0.0, 1.0 );\n" +
    "  float bfr = clamp( uRswClipAtl.z, 0.01, 0.5 );\n" +
    "  float bstart = 1.0 - bfr;\n" +
    "  if ( vis >= 0.0 && edge > bstart && lvl + 1.5 < uRswClipLevels ) {\n" +
    "    float vis2 = rswClipPageVis( lvl + 1.0, lp, p.z, biasBase );\n" +
    "    if ( vis2 >= 0.0 ) vis = mix( vis, vis2, clamp( ( edge - bstart ) / bfr, 0.0, 1.0 ) );\n" +
    "  }\n" +
    "  if ( vis < 0.0 && lvl + 1.5 < uRswClipLevels ) {\n" +
    "    vis = rswClipPageVis( lvl + 1.0, lp, p.z, biasBase );\n" +
    "  }\n" +
    "  return vis;\n" +
    "}\n" +
    "#endif\n"
  );
}


export function buildClipmapSampleReturn() {
  return (
    "\n#if NUM_DIR_LIGHT_SHADOWS > 0\n" +
    "\tif ( uRswClipOn > 0.5 && uRswPcssOn > 0.5 && shadowRadius > 999.5 && shadowRadius < 1999.5 ) {\n" +
    "\t\tfloat rswClipVis = rswClipShadow();\n" +
    "\t\tif ( rswClipVis >= 0.0 ) return rswClipVis;\n" +
    "\t}\n" +
    "#endif\n"
  );
}
