export const CSM_MAX_CASCADES = 4;
export const CSM_MIN_HALF = 24;
export const CSM_MAX_HALF = 640;                                        
export const CSM_BLEND_FRACTION = 0.08;                                         
export const CSM_NEAR_SPLIT_MIN = 40;
export const CSM_NEAR_SPLIT_MAX = 80;
export const CSM_HALF_STEP = 4;                                      
export const CSM_DEPTH_STEP = 32;                                         

export const CSM_SUN_RADIUS_MARKER = 1001;
export const CSM_GHOST_RADIUS_MARKER = 2001;

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}


export function computeCsmSplits({ cascades, near, maxDistance, lambda } = {}) {
  const n = clamp(num(near, 0.5), 0.05, 64);
  const N = Math.round(clamp(num(cascades, CSM_MAX_CASCADES), 1, CSM_MAX_CASCADES));
  const far = clamp(num(maxDistance, 1280), n + 8, 60000);
  const lam = clamp(num(lambda, 0.7), 0, 1);
  if (N === 1) return [{ start: n, end: far }];

  const s0 = Math.max(n + 1, Math.min(clamp(far * 0.05, CSM_NEAR_SPLIT_MIN, CSM_NEAR_SPLIT_MAX), far * 0.5));
  const bounds = [n, s0];
  const k = N - 1;                         
  for (let i = 1; i < k; i++) {
    const t = i / k;
    const logD = s0 * Math.pow(far / s0, t);
    const uniD = s0 + (far - s0) * t;
    const d = lam * logD + (1 - lam) * uniD;
    bounds.push(clamp(d, bounds[bounds.length - 1] + 1, far));
  }
  bounds.push(far);
  const out = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    out.push({ start: bounds[i], end: Math.max(bounds[i + 1], bounds[i] + 1) });
  }
  return out;
}


export function frustumSliceSphere({ position, forward, fovYDeg, aspect, start, end } = {}) {
  const px = num(position && position[0], 0);
  const py = num(position && position[1], 0);
  const pz = num(position && position[2], 0);
  let fx = num(forward && forward[0], 0);
  let fy = num(forward && forward[1], 0);
  let fz = num(forward && forward[2], -1);
  const fl = Math.hypot(fx, fy, fz);
  if (fl < 1e-6) {
    fx = 0; fy = 0; fz = -1;
  } else {
    fx /= fl; fy /= fl; fz /= fl;
  }
  const fov = (clamp(num(fovYDeg, 70), 5, 140) * Math.PI) / 180;
  const asp = clamp(num(aspect, 16 / 9), 0.1, 8);
  const n = clamp(num(start, 0.5), 0.01, 59999);
  const f = clamp(num(end, n + 1), n + 0.01, 60000);
  const tanY = Math.tan(fov / 2);
  const tanX = tanY * asp;
  const k2 = tanX * tanX + tanY * tanY;
  const k = Math.sqrt(k2);
  let a = ((n + f) * (1 + k2)) / 2;
  a = clamp(a, n, f);
  const rNear = Math.hypot(n - a, n * k);
  const rFar = Math.hypot(f - a, f * k);
  const radius = Math.max(rNear, rFar);
  return {
    center: [px + fx * a, py + fy * a, pz + fz * a],
    radius,
    axisDist: a,
  };
}


export function lightBasis(lightDir) {
  let dx = num(lightDir && lightDir[0], 0);
  let dy = num(lightDir && lightDir[1], 1);
  let dz = num(lightDir && lightDir[2], 0);
  let l = Math.hypot(dx, dy, dz);
  if (l < 1e-6) {
    dx = 0; dy = 1; dz = 0;
  } else {
    dx /= l; dy /= l; dz /= l;
  }

  let rx = dz;
  const ry = 0;
  let rz = -dx;
  let rl2 = rx * rx + rz * rz;
  if (rl2 < 1e-12) {

    dz += 0.0001;
    l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
    rx = dz; rz = -dx;
    rl2 = rx * rx + rz * rz;
  }
  const rl = Math.sqrt(rl2) || 1;
  rx /= rl; rz /= rl;

  const ux = dy * rz - dz * ry;
  const uy = dz * rx - dx * rz;
  const uz = dx * ry - dy * rx;
  return { dir: [dx, dy, dz], right: [rx, ry, rz], up: [ux, uy, uz] };
}


export function fitCascadeWindow({ sphereCenter, sphereRadius, lightDir, mapSize, minHalf, maxHalf, biasScale, biasCap } = {}) {
  const b = lightBasis(lightDir);
  const cx = num(sphereCenter && sphereCenter[0], 0);
  const cy = num(sphereCenter && sphereCenter[1], 0);
  const cz = num(sphereCenter && sphereCenter[2], 0);
  const px = Math.max(64, Math.min(8192, num(mapSize, 2048)));
  const lo = clamp(num(minHalf, CSM_MIN_HALF), 4, CSM_MAX_HALF);
  const hi = Math.max(lo, clamp(num(maxHalf, CSM_MAX_HALF), 4, 100000));
  let half = clamp(num(sphereRadius, lo) * 1.02, lo, hi);
  half = Math.ceil(half / CSM_HALF_STEP) * CSM_HALF_STEP;
  if (half > hi) half = Math.max(lo, Math.floor(hi / CSM_HALF_STEP) * CSM_HALF_STEP);
  const texel = (half * 2) / px;
  const u = cx * b.right[0] + cy * b.right[1] + cz * b.right[2];
  const v = cx * b.up[0] + cy * b.up[1] + cz * b.up[2];
  const w = cx * b.dir[0] + cy * b.dir[1] + cz * b.dir[2];
  const ui = Math.round(u / texel);
  const vi = Math.round(v / texel);
  const wi = Math.round(w / CSM_DEPTH_STEP);
  const uS = ui * texel;
  const vS = vi * texel;
  const wS = wi * CSM_DEPTH_STEP;
  const center = [
    b.right[0] * uS + b.up[0] * vS + b.dir[0] * wS,
    b.right[1] * uS + b.up[1] * vS + b.dir[1] * wS,
    b.right[2] * uS + b.up[2] * vS + b.dir[2] * wS,
  ];


  const bs7 = Math.min(1, Math.max(0.1, num(biasScale, 0.35)));
  const bc7raw = num(biasCap, NaN);
  const bc7 = Number.isFinite(bc7raw) && bc7raw > 0 ? Math.min(2, Math.max(0.02, bc7raw)) : 0.6;
  const normalBias = Math.max(0.02, Math.min(bc7, texel * bs7));
  const signature = ui + "|" + vi + "|" + wi + "|" + half + "|" + px;
  return { center, half, normalBias, texel, signature };
}


export function buildCsmGlsl() {
  return (
    "\n" +
    "// Fase 1: CSM — cascatas do sol (seleção + blend no fragment).\n" +
    "uniform float uRswCsmOn;\n" +
    "uniform float uRswCsmCount;\n" +
    "uniform vec4 uRswCsmScale;\n" +
    "uniform float uRswCsmBlend;\n" +
    "#if NUM_DIR_LIGHT_SHADOWS > 0\n" +
    "float rswCsmScaleFor(const in int c) {\n" +
    "  if (c <= 0) return uRswCsmScale.x;\n" +
    "  if (c == 1) return uRswCsmScale.y;\n" +
    "  if (c == 2) return uRswCsmScale.z;\n" +
    "  return uRswCsmScale.w;\n" +
    "}\n" +


    "float rswCsmCapFor(const in int c) {\n" +
    "  return clamp(rswCsmScaleFor(c) / max(uRswPcssScale, 1e-4), 1.0, 6.0);\n" +
    "}\n" +
    "float rswCsmSample(const in int c) {\n" +
    "#if NUM_DIR_LIGHT_SHADOWS > 3\n" +
    "  if (c >= 3) return rswPcssScaled(directionalShadowMap[ 3 ], directionalLightShadows[ 3 ].shadowBias, vDirectionalShadowCoord[ 3 ], rswCsmScaleFor(3), rswCsmCapFor(3));\n" +
    "#endif\n" +
    "#if NUM_DIR_LIGHT_SHADOWS > 2\n" +
    "  if (c >= 2) return rswPcssScaled(directionalShadowMap[ 2 ], directionalLightShadows[ 2 ].shadowBias, vDirectionalShadowCoord[ 2 ], rswCsmScaleFor(2), rswCsmCapFor(2));\n" +
    "#endif\n" +
    "#if NUM_DIR_LIGHT_SHADOWS > 1\n" +
    "  if (c >= 1) return rswPcssScaled(directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowBias, vDirectionalShadowCoord[ 1 ], rswCsmScaleFor(1), rswCsmCapFor(1));\n" +
    "#endif\n" +
    "  return rswPcssScaled(directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowBias, vDirectionalShadowCoord[ 0 ], rswCsmScaleFor(0), rswCsmCapFor(0));\n" +
    "}\n" +
    "// Distância (em UV) até a borda da janela da cascata; negativa = fora.\n" +
    "float rswCsmEdge(const in vec4 sc) {\n" +
    "  vec3 p = sc.xyz / max(sc.w, 1e-6);\n" +
    "  if (p.z < 0.0 || p.z > 1.0) return -1.0;\n" +
    "  vec2 d2 = min(p.xy, vec2(1.0) - p.xy);\n" +
    "  return min(d2.x, d2.y);\n" +
    "}\n" +
    "float rswCsmShadow() {\n" +
    "  int rswN = int(clamp(uRswCsmCount, 1.0, float(NUM_DIR_LIGHT_SHADOWS)));\n" +


    "  float rswEdge = -1.0;\n" +
    "#if NUM_DIR_LIGHT_SHADOWS > 1\n" +
    "  if (rswN > 1) {\n" +
    "    rswEdge = rswCsmEdge(vDirectionalShadowCoord[ 0 ]);\n" +
    "    if (rswEdge >= uRswCsmBlend) return rswCsmSample(0);\n" +
    "    if (rswEdge >= 0.0) return mix(rswCsmSample(1), rswCsmSample(0), rswEdge / max(uRswCsmBlend, 1e-4));\n" +
    "  }\n" +
    "#endif\n" +
    "#if NUM_DIR_LIGHT_SHADOWS > 2\n" +
    "  if (rswN > 2) {\n" +
    "    rswEdge = rswCsmEdge(vDirectionalShadowCoord[ 1 ]);\n" +
    "    if (rswEdge >= uRswCsmBlend) return rswCsmSample(1);\n" +
    "    if (rswEdge >= 0.0) return mix(rswCsmSample(2), rswCsmSample(1), rswEdge / max(uRswCsmBlend, 1e-4));\n" +
    "  }\n" +
    "#endif\n" +
    "#if NUM_DIR_LIGHT_SHADOWS > 3\n" +
    "  if (rswN > 3) {\n" +
    "    rswEdge = rswCsmEdge(vDirectionalShadowCoord[ 2 ]);\n" +
    "    if (rswEdge >= uRswCsmBlend) return rswCsmSample(2);\n" +
    "    if (rswEdge >= 0.0) return mix(rswCsmSample(3), rswCsmSample(2), rswEdge / max(uRswCsmBlend, 1e-4));\n" +
    "  }\n" +
    "#endif\n" +
    "  return rswCsmSample(rswN - 1);\n" +
    "}\n" +
    "#endif\n"
  );
}


export function buildCsmReturn() {
  return (
    "\n\tif ( uRswCsmOn > 0.5 && shadowRadius > 1999.5 ) return 1.0;" +
    "\n#if NUM_DIR_LIGHT_SHADOWS > 0" +
    "\n\tif ( uRswPcssOn > 0.5 && uRswCsmOn > 0.5 && shadowRadius > 999.5 ) return rswCsmShadow();" +
    "\n#endif"
  );
}
