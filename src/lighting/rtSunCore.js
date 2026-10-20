export const RT_SUN_VERSION = "rt-sun-7b";


export const RT_SUN_RADIUS_MARKER = 3001;
export const RT_MASK_MAX_DIM = 160;
export const RT_MASK_MIN_DIM = 16;
export const RT_MAX_PARTS = 4096;
export const RT_BUDGET_MIN = 512;
export const RT_BUDGET_MAX = 8192;


export const RT_TRACE_TMIN = 0.08;

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}


export function maskDimsFor(viewW, viewH, maxDim) {
  const w = Math.max(1, num(viewW, 1));
  const h = Math.max(1, num(viewH, 1));
  const cap = clamp(Math.round(num(maxDim, RT_MASK_MAX_DIM)), RT_MASK_MIN_DIM, 512);
  const scale = cap / Math.max(w, h);
  return {
    w: clamp(Math.round(w * scale), RT_MASK_MIN_DIM, cap),
    h: clamp(Math.round(h * scale), RT_MASK_MIN_DIM, cap),
  };
}


export function giBoxesToRtParts(boxes, maxParts) {
  const list = Array.isArray(boxes) ? boxes : [];
  const cap = clamp(Math.round(num(maxParts, RT_MAX_PARTS)), 1, 65536);
  const out = [];
  for (const b of list) {
    if (out.length >= cap) break;
    if (!b || !Array.isArray(b.c) || !Array.isArray(b.h)) continue;
    const cx = num(b.c[0], NaN);
    const cy = num(b.c[1], NaN);
    const cz = num(b.c[2], NaN);
    const hx = num(b.h[0], NaN);
    const hy = num(b.h[1], NaN);
    const hz = num(b.h[2], NaN);
    if (
      !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz) ||
      !Number.isFinite(hx) || !Number.isFinite(hy) || !Number.isFinite(hz)
    ) {
      continue;
    }
    const maxH = Math.max(hx, hy, hz);
    if (!(maxH > 0.025) || maxH > 4096) continue;                      
    const part = { position: [cx, cy, cz], size: [hx * 2, hy * 2, hz * 2] };
    const ax = b.axes;
    if (
      Array.isArray(ax) && ax.length === 3 &&
      Array.isArray(ax[0]) && Array.isArray(ax[1]) && Array.isArray(ax[2])
    ) {

      const r = [
        num(ax[0][0], 1), num(ax[1][0], 0), num(ax[2][0], 0),
        num(ax[0][1], 0), num(ax[1][1], 1), num(ax[2][1], 0),
        num(ax[0][2], 0), num(ax[1][2], 0), num(ax[2][2], 1),
      ];
      let ok = true;
      for (const v of r) if (!Number.isFinite(v)) { ok = false; break; }
      if (ok) part.rotation = r;
    }
    out.push(part);
  }
  return out;
}


export function unpackDepthRgba(r, g, b, a) {
  const k = 255 / 256;
  const R = clamp(num(r, 0), 0, 255) / 255;
  const G = clamp(num(g, 0), 0, 255) / 255;
  const B = clamp(num(b, 0), 0, 255) / 255;
  const A = clamp(num(a, 0), 0, 255) / 255;
  return R * (k / 16777216) + G * (k / 65536) + B * (k / 256) + A * k;
}


export function worldFromPixel(ix, iy, w, h, depth01, invVp) {
  const e = invVp;
  if (!e || e.length !== 16) return null;
  const W = Math.max(1, num(w, 1));
  const H = Math.max(1, num(h, 1));
  const nx = ((num(ix, 0) + 0.5) / W) * 2 - 1;
  const ny = ((num(iy, 0) + 0.5) / H) * 2 - 1;
  const nz = clamp(num(depth01, 0), 0, 1) * 2 - 1;
  const X = e[0] * nx + e[4] * ny + e[8] * nz + e[12];
  const Y = e[1] * nx + e[5] * ny + e[9] * nz + e[13];
  const Z = e[2] * nx + e[6] * ny + e[10] * nz + e[14];
  const Wc = e[3] * nx + e[7] * ny + e[11] * nz + e[15];
  if (!Number.isFinite(Wc) || Math.abs(Wc) < 1e-9) return null;
  const inv = 1 / Wc;
  const x = X * inv;
  const y = Y * inv;
  const z = Z * inv;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}


export function decideRtTier(args) {
  const a = args || {};
  if (a.webgpuReady === true) {
    return { backend: "gpu", raysPerFrame: RT_BUDGET_MAX, samples: 8 };
  }
  const ema = num(a.emaMs, 0);
  let rays = 2048;
  if (ema > 28) rays = RT_BUDGET_MIN;
  else if (ema > 20) rays = 1024;
  else if (ema > 0 && ema < 12) rays = 4096;
  return { backend: "cpu", raysPerFrame: clamp(rays, RT_BUDGET_MIN, RT_BUDGET_MAX), samples: 4 };
}


export function mixRamp(cur, target) {
  const c = clamp(num(cur, 0), 0, 1);
  const t = clamp(num(target, 0), 0, 1);
  const next = c + (t - c) * 0.25;
  return Math.abs(next - t) < 0.002 ? t : next;
}


export function buildRtMaskGlsl() {
  return (
    "\n" +
    "// Fase 7 (fatia B): mask RT do sol em screen-space (refina no ócio).\n" +
    "uniform float uRswRtOn;\n" +
    "uniform float uRswRtMix;\n" +
    "uniform sampler2D uRswRtTex;\n" +
    "uniform vec2 uRswRtInvRes;\n" +
    "// .x = visibilidade RT; .y = validade (0 = céu/fora do alcance do depth\n" +
    "// prepass — nesses texels a base clássica fica intacta, nunca apagada).\n" +
    "vec2 rswRtSample() {\n" +
    "  return texture2D(uRswRtTex, gl_FragCoord.xy * uRswRtInvRes).rg;\n" +
    "}\n"
  );
}


export function buildRtReturn() {
  return (
    "\n\tif ( uRswRtOn > 0.5 && ( ( shadowRadius > 999.5 && shadowRadius < 1999.5 ) || shadowRadius > 2999.5 ) ) {" +
    "\n#if NUM_DIR_LIGHT_SHADOWS > 0" +
    "\n\t\tfloat rswRtBase = ( uRswCsmOn > 0.5 && shadowRadius < 1999.5 ) ? rswCsmShadow() : ( uRswPcssOn > 0.5 ? rswPcss( shadowMap, shadowBias, shadowRadius, shadowCoord ) : 1.0 );" +
    "\n#else" +
    "\n\t\tfloat rswRtBase = uRswPcssOn > 0.5 ? rswPcss( shadowMap, shadowBias, shadowRadius, shadowCoord ) : 1.0;" +
    "\n#endif" +
    "\n\t\tvec2 rswRtSV = rswRtSample();" +
    "\n\t\treturn mix( rswRtBase, rswRtSV.x, clamp( uRswRtMix, 0.0, 1.0 ) * rswRtSV.y );" +
    "\n\t}"
  );
}
