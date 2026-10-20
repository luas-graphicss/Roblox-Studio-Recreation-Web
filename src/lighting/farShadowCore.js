export const FAR_HF_DIM = 256;                                  
export const FAR_SDF_DIM = 48;                                          
export const FAR_HF_STEPS = 20;                                 
export const FAR_SDF_STEPS = 16;                            
export const FAR_SDF_RANGE = 15;                                           
export const FAR_MAX_DIST = 8192;                                   
export const FAR_MAX_BOXES = 20000;                     
export const FAR_HF_T0 = 6;                                   


export const FAR_LITE_HF_STEPS = 8;
const WORLD_CAP = 60000;
const HALF_CAP = 4096;
const HF_WRITE_BUDGET = 2000000;                                            

function fin(v, d) {
  return Number.isFinite(v) ? v : d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}


export function hfGrowFactorFor(steps) {
  const s = clamp(Math.round(fin(steps, FAR_HF_STEPS)), 2, 64);
  return Math.pow(FAR_MAX_DIST / FAR_HF_T0, 1 / (s - 1));
}

export function hfGrowFactor() {
  return hfGrowFactorFor(FAR_HF_STEPS);
}


export function ignJs(x, y) {
  const a = 0.06711056 * fin(x, 0) + 0.00583715 * fin(y, 0);
  const f = a - Math.floor(a);
  const b = 52.9829189 * f;
  return b - Math.floor(b);
}


export function farLiteProfile(input) {
  const src = input && typeof input === "object" ? input : {};
  if (src.weak !== true) {
    return Object.freeze({
      lite: false,
      withSdf: src.sdfCapable === true,
      steps: FAR_HF_STEPS,
      dither: false,
      texUnits: 2,
    });
  }
  return Object.freeze({
    lite: true,
    withSdf: false,
    steps: FAR_LITE_HF_STEPS,
    dither: true,
    texUnits: 1,
  });
}


export function boxWorldAabb(b) {
  if (!b || !b.c || !b.h) return null;
  const cx = fin(b.c[0], NaN);
  const cy = fin(b.c[1], NaN);
  const cz = fin(b.c[2], NaN);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) return null;
  if (Math.abs(cx) > WORLD_CAP || Math.abs(cy) > WORLD_CAP || Math.abs(cz) > WORLD_CAP) return null;
  const hx = Math.min(HALF_CAP, Math.abs(fin(b.h[0], 0)));
  const hy = Math.min(HALF_CAP, Math.abs(fin(b.h[1], 0)));
  const hz = Math.min(HALF_CAP, Math.abs(fin(b.h[2], 0)));
  if (Math.max(hx, hy, hz) < 0.05) return null;
  let ex = hx;
  let ey = hy;
  let ez = hz;
  if (b.axes && b.axes[0] && b.axes[1] && b.axes[2]) {
    const ax = b.axes[0];
    const ay = b.axes[1];
    const az = b.axes[2];
    ex = Math.abs(fin(ax[0], 0)) * hx + Math.abs(fin(ay[0], 0)) * hy + Math.abs(fin(az[0], 0)) * hz;
    ey = Math.abs(fin(ax[1], 0)) * hx + Math.abs(fin(ay[1], 0)) * hy + Math.abs(fin(az[1], 0)) * hz;
    ez = Math.abs(fin(ax[2], 0)) * hx + Math.abs(fin(ay[2], 0)) * hy + Math.abs(fin(az[2], 0)) * hz;
    if (!Number.isFinite(ex + ey + ez)) return null;
    ex = Math.min(ex, HALF_CAP);
    ey = Math.min(ey, HALF_CAP);
    ez = Math.min(ez, HALF_CAP);
  }
  return { min: [cx - ex, cy - ey, cz - ez], max: [cx + ex, cy + ey, cz + ez] };
}

function collectAabbs(boxes) {
  const list = Array.isArray(boxes) ? boxes : [];
  const end = Math.min(list.length, FAR_MAX_BOXES);
  const out = [];
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < end; i++) {
    const a = boxWorldAabb(list[i]);
    if (!a) continue;
    out.push(a);
    if (a.min[0] < mnx) mnx = a.min[0];
    if (a.min[1] < mny) mny = a.min[1];
    if (a.min[2] < mnz) mnz = a.min[2];
    if (a.max[0] > mxx) mxx = a.max[0];
    if (a.max[1] > mxy) mxy = a.max[1];
    if (a.max[2] > mxz) mxz = a.max[2];
  }
  if (!out.length) return null;
  return { aabbs: out, min: [mnx, mny, mnz], max: [mxx, mxy, mxz] };
}


export function buildHeightfieldFromBoxes(boxes, opts) {
  const o = opts || {};
  const dim = Math.round(clamp(fin(o.dim, FAR_HF_DIM), 16, 512));
  const c = collectAabbs(boxes);
  if (!c) return { empty: true, dim, data: null };
  const minY = c.min[1];
  const rangeY = Math.max(c.max[1] - minY, 1);
  const sizeX = Math.max(c.max[0] - c.min[0], 1);
  const sizeZ = Math.max(c.max[2] - c.min[2], 1);
  const data = new Uint8Array(dim * dim);
  let writes = 0;
  let truncated = false;
  for (const a of c.aabbs) {
    if (writes >= HF_WRITE_BUDGET) {
      truncated = true;
      break;
    }
    const x0 = clamp(Math.floor(((a.min[0] - c.min[0]) / sizeX) * dim), 0, dim - 1);
    const x1 = clamp(Math.floor(((a.max[0] - c.min[0]) / sizeX) * dim), 0, dim - 1);
    const z0 = clamp(Math.floor(((a.min[2] - c.min[2]) / sizeZ) * dim), 0, dim - 1);
    const z1 = clamp(Math.floor(((a.max[2] - c.min[2]) / sizeZ) * dim), 0, dim - 1);


    const top = clamp(Math.floor(((a.max[1] - minY) / rangeY) * 254) + 1, 1, 255);
    for (let z = z0; z <= z1; z++) {
      const row = z * dim;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        if (top > data[i]) data[i] = top;
        writes++;
      }
    }
  }
  return {
    empty: false,
    truncated,
    dim,
    data,
    minX: c.min[0],
    minZ: c.min[2],
    sizeX,
    sizeZ,
    minY,
    rangeY,
  };
}


export function heightAtJs(hf, wx, wz) {
  if (!hf || hf.empty || !hf.data) return -Infinity;
  const u = (fin(wx, NaN) - hf.minX) / hf.sizeX;
  const v = (fin(wz, NaN) - hf.minZ) / hf.sizeZ;
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return -Infinity;
  const x = clamp(Math.floor(u * hf.dim), 0, hf.dim - 1);
  const z = clamp(Math.floor(v * hf.dim), 0, hf.dim - 1);
  const t = hf.data[z * hf.dim + x];
  if (t === 0) return -Infinity;
  return hf.minY + ((t - 1) / 254) * hf.rangeY;
}


export function heightfieldShadowJs(hf, p, sunDir, opts) {
  const o = opts || {};
  const steps = Math.round(clamp(fin(o.steps, FAR_HF_STEPS), 4, 64));
  const dist = clamp(fin(o.dist, FAR_MAX_DIST), 16, FAR_MAX_DIST);
  const soft = clamp(fin(o.soft, 5), 0.5, 64);


  const grow = clamp(fin(o.grow, hfGrowFactorFor(steps)), 1.01, 4);
  if (!hf || hf.empty) return 1;
  let dx = fin(sunDir && sunDir[0], 0);
  let dy = fin(sunDir && sunDir[1], 1);
  let dz = fin(sunDir && sunDir[2], 0);
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return 1;
  dx /= len;
  dy /= len;
  dz /= len;
  const px = fin(p && p[0], 0);
  const py = fin(p && p[1], 0);
  const pz = fin(p && p[2], 0);


  const hSelf = heightAtJs(hf, px, pz);
  if (hSelf > -Infinity && py + (hf.rangeY / 254) * 2 + 1 < hSelf) return 1;
  let s = 1;


  const jitter = clamp(fin(o.jitter, 0), 0, 0.999);
  let t = jitter > 0 ? FAR_HF_T0 * Math.pow(grow, jitter) : FAR_HF_T0;
  for (let i = 0; i < steps; i++) {
    if (t > dist) break;
    const qx = px + dx * t;
    const qy = py + dy * t;
    const qz = pz + dz * t;
    const u = (qx - hf.minX) / hf.sizeX;
    const v = (qz - hf.minZ) / hf.sizeZ;
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) break;
    const h = heightAtJs(hf, qx, qz);
    if (h > -Infinity) {
      const d = qy - h;
      if (d < 0) return 0;
      s = Math.min(s, (soft * d) / t);
      if (s < 0.004) return 0;
    }
    t *= grow;
  }
  return clamp(s, 0, 1);
}


const CHEB_FWD = [];
const CHEB_BWD = [];
for (let dz = -1; dz <= 1; dz++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0 && dz === 0) continue;
      const before = dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0)));
      (before ? CHEB_FWD : CHEB_BWD).push([dx, dy, dz]);
    }
  }
}

export function buildSdfFromBoxes(boxes, opts) {
  const o = opts || {};
  const dim = Math.round(clamp(fin(o.dim, FAR_SDF_DIM), 8, 96));
  const c = collectAabbs(boxes);
  if (!c) return { empty: true, dim, data: null };
  const spanX = c.max[0] - c.min[0];
  const spanY = c.max[1] - c.min[1];
  const spanZ = c.max[2] - c.min[2];
  const span = Math.max(spanX, spanY, spanZ, 32) * 1.02;
  const cell = span / dim;
  const minX = (c.min[0] + c.max[0]) / 2 - span / 2;
  const minY = (c.min[1] + c.max[1]) / 2 - span / 2;
  const minZ = (c.min[2] + c.max[2]) / 2 - span / 2;
  const n = dim * dim * dim;
  const dist = new Uint8Array(n).fill(FAR_SDF_RANGE);
  const dd = dim * dim;
  for (const a of c.aabbs) {
    const x0 = clamp(Math.floor((a.min[0] - minX) / cell), 0, dim - 1);
    const x1 = clamp(Math.floor((a.max[0] - minX) / cell), 0, dim - 1);
    const y0 = clamp(Math.floor((a.min[1] - minY) / cell), 0, dim - 1);
    const y1 = clamp(Math.floor((a.max[1] - minY) / cell), 0, dim - 1);
    const z0 = clamp(Math.floor((a.min[2] - minZ) / cell), 0, dim - 1);
    const z1 = clamp(Math.floor((a.max[2] - minZ) / cell), 0, dim - 1);
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        const base = y * dim + z * dd;
        for (let x = x0; x <= x1; x++) dist[x + base] = 0;
      }
    }
  }

  function pass(offsets, reverse) {
    const zs = reverse ? dim - 1 : 0;
    const ze = reverse ? -1 : dim;
    const st = reverse ? -1 : 1;
    for (let z = zs; z !== ze; z += st) {
      for (let y = zs; y !== ze; y += st) {
        for (let x = zs; x !== ze; x += st) {
          const i = x + dim * (y + dim * z);
          let d = dist[i];
          if (d === 0) continue;
          for (let k = 0; k < offsets.length; k++) {
            const ox = x + offsets[k][0];
            const oy = y + offsets[k][1];
            const oz = z + offsets[k][2];
            if (ox < 0 || oy < 0 || oz < 0 || ox >= dim || oy >= dim || oz >= dim) continue;
            const cand = dist[ox + dim * (oy + dim * oz)] + 1;
            if (cand < d) d = cand;
          }
          dist[i] = d > FAR_SDF_RANGE ? FAR_SDF_RANGE : d;
        }
      }
    }
  }
  pass(CHEB_FWD, false);
  pass(CHEB_BWD, true);
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = dist[i] * 17;
  return { empty: false, dim, data, cell, span, minX, minY, minZ };
}


export function sdfDistJs(sdf, wx, wy, wz) {
  if (!sdf || sdf.empty || !sdf.data) return Infinity;
  const u = (fin(wx, NaN) - sdf.minX) / sdf.span;
  const v = (fin(wy, NaN) - sdf.minY) / sdf.span;
  const w = (fin(wz, NaN) - sdf.minZ) / sdf.span;
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1 && w >= 0 && w <= 1)) return Infinity;
  const x = clamp(Math.floor(u * sdf.dim), 0, sdf.dim - 1);
  const y = clamp(Math.floor(v * sdf.dim), 0, sdf.dim - 1);
  const z = clamp(Math.floor(w * sdf.dim), 0, sdf.dim - 1);
  return (sdf.data[x + sdf.dim * (y + sdf.dim * z)] / 17) * sdf.cell;
}


export function sphereTraceSdfJs(sdf, p, sunDir, opts) {
  const o = opts || {};
  const steps = Math.round(clamp(fin(o.steps, FAR_SDF_STEPS), 4, 64));
  const dist = clamp(fin(o.dist, FAR_MAX_DIST), 16, FAR_MAX_DIST);
  const soft = clamp(fin(o.soft, 5), 0.5, 64);
  if (!sdf || sdf.empty) return 1;
  let dx = fin(sunDir && sunDir[0], 0);
  let dy = fin(sunDir && sunDir[1], 1);
  let dz = fin(sunDir && sunDir[2], 0);
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return 1;
  dx /= len;
  dy /= len;
  dz /= len;
  const px = fin(p && p[0], 0);
  const py = fin(p && p[1], 0);
  const pz = fin(p && p[2], 0);
  let s = 1;
  let t = sdf.cell * 1.5;


  const lift = sdf.cell * 1.1;
  for (let i = 0; i < steps; i++) {
    if (t > dist) break;
    const qx = px + dx * t;
    const qy = py + lift + dy * t;
    const qz = pz + dz * t;
    const d = sdfDistJs(sdf, qx, qy, qz);
    if (d === Infinity) break;
    if (d < sdf.cell * 0.35) return 0;
    s = Math.min(s, (soft * d) / t);
    t += Math.max(d, sdf.cell * 0.5);
  }
  return clamp(s, 0, 1);
}


export function farFadeJs(p, center, half) {
  const h = fin(half, 0);
  if (!(h >= 1)) return 0;
  const mx = Math.abs(fin(p && p[0], 0) - fin(center && center[0], 0));
  const my = Math.abs(fin(p && p[1], 0) - fin(center && center[1], 0));
  const mz = Math.abs(fin(p && p[2], 0) - fin(center && center[2], 0));
  const m = Math.max(mx, my, mz);
  const e0 = h * 0.9;
  const x = clamp((m - e0) / (h - e0), 0, 1);
  return x * x * (3 - 2 * x);
}


export function buildFarShadowGlsl(opts) {
  const o = opts || {};
  const withSdf = !!o.withSdf;


  const hfSteps = Math.round(clamp(fin(o.steps, FAR_HF_STEPS), 4, 64));
  const dither = o.dither === true;
  const grow = hfGrowFactorFor(hfSteps).toFixed(4);
  let glsl =
    "\n" +
    "// Fase 5: far shadows — heightfield + SDF além da janela do sol.\n" +
    "#ifdef USE_SHADOWMAP\n" +
    "#define RSW_FAR_HF_STEPS " + hfSteps + "\n" +
    "#define RSW_FAR_SDF_STEPS " + FAR_SDF_STEPS + "\n" +
    "#define RSW_FAR_HF_GROW " + grow + "\n" +
    "#define RSW_FAR_SDF_RANGE " + FAR_SDF_RANGE.toFixed(1) + "\n" +
    "uniform float uRswFarOn;\n" +
    "uniform float uRswFarHfOn;\n" +
    "uniform vec3 uRswFarSunDir;\n" +
    "uniform vec3 uRswFarWinCenter;\n" +
    "uniform float uRswFarWinHalf;\n" +
    "uniform float uRswFarDist;\n" +
    "uniform float uRswFarSoft;\n" +
    "uniform sampler2D uRswFarHfTex;\n" +
    "uniform vec3 uRswFarHfMin;\n" +
    "uniform vec3 uRswFarHfInv;\n" +
    "varying vec3 vRswFarPos;\n" +
    "float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord );\n";
  if (withSdf) {
    glsl +=
      "uniform float uRswFarSdfOn;\n" +
      "uniform highp sampler3D uRswFarSdfTex;\n" +
      "uniform vec3 uRswFarSdfMin;\n" +
      "uniform float uRswFarSdfInvSpan;\n" +
      "uniform float uRswFarSdfCell;\n";
  }
  if (dither) {


    glsl +=
      "float rswFarIgn( const in vec2 px ) {\n" +
      "  return fract( 52.9829189 * fract( dot( px, vec2( 0.06711056, 0.00583715 ) ) ) );\n" +
      "}\n";
  }
  glsl +=
    "float rswFarHfShadow( const in vec3 p ) {\n" +
    "  if ( uRswFarHfOn < 0.5 ) return 1.0;\n" +


    "  vec2 uv0 = ( p.xz - uRswFarHfMin.xz ) * uRswFarHfInv.xz;\n" +
    "  if ( all( greaterThanEqual( uv0, vec2( 0.0 ) ) ) && all( lessThanEqual( uv0, vec2( 1.0 ) ) ) ) {\n" +
    "    float h0N = texture2D( uRswFarHfTex, uv0 ).r;\n" +
    "    if ( h0N > 0.002 && p.y + uRswFarHfInv.y * 2.0 + 1.0 < uRswFarHfMin.y + ( h0N * 255.0 - 1.0 ) * uRswFarHfInv.y ) return 1.0;\n" +
    "  }\n" +
    "  float s = 1.0;\n" +


    (dither
      ? "  float t = " + FAR_HF_T0.toFixed(1) + " * pow( RSW_FAR_HF_GROW, rswFarIgn( gl_FragCoord.xy ) );\n"
      : "  float t = " + FAR_HF_T0.toFixed(1) + ";\n") +
    "  for ( int i = 0; i < RSW_FAR_HF_STEPS; i ++ ) {\n" +
    "    if ( t > uRswFarDist ) break;\n" +
    "    vec3 q = p + uRswFarSunDir * t;\n" +
    "    vec2 uv = ( q.xz - uRswFarHfMin.xz ) * uRswFarHfInv.xz;\n" +
    "    if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) break;\n" +
    "    float hN = texture2D( uRswFarHfTex, uv ).r;\n" +
    "    if ( hN > 0.002 ) {\n" +
    "      float h = uRswFarHfMin.y + ( hN * 255.0 - 1.0 ) * uRswFarHfInv.y;\n" +
    "      float d = q.y - h;\n" +
    "      if ( d < 0.0 ) return 0.0;\n" +
    "      s = min( s, uRswFarSoft * d / t );\n" +
    "      if ( s < 0.004 ) return 0.0;\n" +
    "    }\n" +
    "    t *= RSW_FAR_HF_GROW;\n" +
    "  }\n" +
    "  return clamp( s, 0.0, 1.0 );\n" +
    "}\n";
  if (withSdf) {
    glsl +=
      "float rswFarSdfShadow( const in vec3 p ) {\n" +
      "  if ( uRswFarSdfOn < 0.5 ) return 1.0;\n" +
      "  float s = 1.0;\n" +
      "  float t = uRswFarSdfCell * 1.5;\n" +


      "  vec3 pl = p + vec3( 0.0, uRswFarSdfCell * 1.1, 0.0 );\n" +
      "  for ( int i = 0; i < RSW_FAR_SDF_STEPS; i ++ ) {\n" +
      "    if ( t > uRswFarDist ) break;\n" +
      "    vec3 q = pl + uRswFarSunDir * t;\n" +
      "    vec3 uvw = ( q - uRswFarSdfMin ) * uRswFarSdfInvSpan;\n" +
      "    if ( any( lessThan( uvw, vec3( 0.0 ) ) ) || any( greaterThan( uvw, vec3( 1.0 ) ) ) ) break;\n" +
      "    float d = texture( uRswFarSdfTex, uvw ).r * RSW_FAR_SDF_RANGE * uRswFarSdfCell;\n" +
      "    if ( d < uRswFarSdfCell * 0.35 ) return 0.0;\n" +
      "    s = min( s, uRswFarSoft * d / t );\n" +
      "    t += max( d, uRswFarSdfCell * 0.5 );\n" +
      "  }\n" +
      "  return clamp( s, 0.0, 1.0 );\n" +
      "}\n";
  }
  glsl +=
    "float rswFarFade( const in vec3 p ) {\n" +
    "  if ( uRswFarWinHalf < 1.0 ) return 0.0;\n" +
    "  vec3 dc = abs( p - uRswFarWinCenter );\n" +
    "  float m = max( dc.x, max( dc.y, dc.z ) );\n" +
    "  return smoothstep( uRswFarWinHalf * 0.9, uRswFarWinHalf, m );\n" +
    "}\n" +
    "float rswFarShadow( const in vec3 p ) {\n" +
    "  float far = rswFarHfShadow( p );\n" +
    (withSdf ? "  far = min( far, rswFarSdfShadow( p ) );\n" : "") +
    "  return far;\n" +
    "}\n" +
    "float rswFarGetShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {\n" +
    "  float s = getShadow( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord );\n" +
    "  if ( uRswFarOn < 0.5 ) return s;\n" +
    "  float f = rswFarFade( vRswFarPos );\n" +
    "  if ( f < 0.002 ) return s;\n" +
    "  return min( s, mix( 1.0, rswFarShadow( vRswFarPos ), f ) );\n" +
    "}\n" +
    "#endif\n";
  return glsl;
}


export function buildFarVertexMain() {
  return (
    "\nvec4 rswFarW = vec4( transformed, 1.0 );\n" +
    "#ifdef USE_INSTANCING\n" +
    "rswFarW = instanceMatrix * rswFarW;\n" +
    "#endif\n" +
    "vRswFarPos = ( modelMatrix * rswFarW ).xyz;"
  );
}


export const FAR_DIR_ANCHOR = "getShadow( directionalShadowMap";

export function parseLightsBeginAnchor(chunk) {
  if (typeof chunk !== "string") return { ok: false, count: 0 };
  let count = 0;
  let i = chunk.indexOf(FAR_DIR_ANCHOR);
  while (i !== -1) {
    count++;
    i = chunk.indexOf(FAR_DIR_ANCHOR, i + 1);
  }
  return { ok: count === 1, count };
}


export function patchLightsBeginChunk(chunk) {
  if (!parseLightsBeginAnchor(chunk).ok) return null;
  return chunk.replace(FAR_DIR_ANCHOR, "rswFarGetShadow( directionalShadowMap");
}
