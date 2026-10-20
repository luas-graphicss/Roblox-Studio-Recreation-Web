export const RT_PARITY_VERSION = "rt-parity-11c";


export const RT_SPATIAL_RADIUS = 2;       
export const RT_SPATIAL_VAR_EPS = 1e-4;
export const RT_SPATIAL_SIGMA_FLOOR = 0.08;         

export const RT_SPATIAL_CHUNK = 131072;

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}


export function spatialDenoiseRange(vis, origins, w, h, from, to, out, opts) {
  const W = Math.max(1, Math.floor(num(w, 1)));
  const H = Math.max(1, Math.floor(num(h, 1)));
  if (!vis || vis.length !== W * H) throw new RangeError("rtParityCore: vis deve ter w*h floats");
  if (!origins || origins.length !== W * H * 4) throw new RangeError("rtParityCore: origins deve ter w*h*4 floats");
  if (!out || out.length !== W * H) throw new RangeError("rtParityCore: out deve ter w*h floats");
  const o = opts || {};
  const cam = Array.isArray(o.camPos) || (o.camPos && ArrayBuffer.isView(o.camPos)) ? o.camPos : [0, 0, 0];
  const cx = num(cam[0], 0);
  const cy = num(cam[1], 0);
  const cz = num(cam[2], 0);
  const k = Math.max(1e-6, num(o.worldPerTexel, 0.002));
  const varEps = Math.max(0, num(o.varEps, RT_SPATIAL_VAR_EPS));
  const sigmaFloor = Math.max(1e-3, num(o.sigmaFloor, RT_SPATIAL_SIGMA_FLOOR));
  const R = clamp(Math.floor(num(o.radius, RT_SPATIAL_RADIUS)), 1, 3);
  const G = [1, 4, 6, 4, 1];
  const a = clamp(Math.floor(num(from, 0)), 0, W * H);
  const b = clamp(Math.floor(num(to, W * H)), a, W * H);
  for (let idx = a; idx < b; idx++) {
    const q = idx * 4;
    const v0 = clamp(num(vis[idx], 1), 0, 1);
    if (!(origins[q + 3] > 0)) {
      out[idx] = v0;
      continue;
    }
    const x = idx % W;
    const y = (idx / W) | 0;

    let n = 0;
    let s = 0;
    let s2 = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= W) continue;
        const j = yy * W + xx;
        if (!(origins[j * 4 + 3] > 0)) continue;
        const v = clamp(num(vis[j], v0), 0, 1);
        n++;
        s += v;
        s2 += v * v;
      }
    }
    const mean = n > 0 ? s / n : v0;
    const variance = n > 0 ? Math.max(0, s2 / n - mean * mean) : 0;
    if (variance <= varEps) {
      out[idx] = v0;
      continue;
    }

    const px = origins[q];
    const py = origins[q + 1];
    const pz = origins[q + 2];
    const dist = Math.hypot(px - cx, py - cy, pz - cz);
    const sw = Math.max(sigmaFloor, k * dist * 3);
    const inv2 = 1 / (2 * sw * sw);
    let wSum = 0;
    let vSum = 0;
    for (let dy = -R; dy <= R; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= W) continue;
        const j = yy * W + xx;
        const qj = j * 4;
        if (!(origins[qj + 3] > 0)) continue;
        const ddx = origins[qj] - px;
        const ddy = origins[qj + 1] - py;
        const ddz = origins[qj + 2] - pz;
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        let gw = Math.exp(-d2 * inv2);
        if (R === 2) gw *= G[dx + 2] * G[dy + 2];
        if (!(gw > 0)) continue;
        wSum += gw;
        vSum += clamp(num(vis[j], 0), 0, 1) * gw;
      }
    }
    out[idx] = wSum > 1e-9 ? clamp(vSum / wSum, 0, 1) : v0;
  }
  return out;
}




export function buildSpatialWgsl(opts) {
  const o = opts || {};
  const wg = Math.round(clamp(num(o.workgroupSize, 64), 1, 256));
  return (
    "// rt-parity-11c: denoise espacial bilateral da máscara RT (espelho de spatialDenoiseRange)\n" +
    "struct SpatialParams {\n" +
    "  dims : vec4u, // x = w, y = h, z = radius (1..3), w = reservado\n" +
    "  cam : vec4f,  // xyz = posição da câmera; w = worldPerTexel (k)\n" +
    "  tune : vec4f, // x = sigmaFloor, y = varEps, zw reservado\n" +
    "};\n" +
    "@group(0) @binding(0) var<storage, read> visIn : array<f32>;\n" +
    "@group(0) @binding(1) var<storage, read> origins : array<vec4f>;\n" +
    "@group(0) @binding(2) var<storage, read_write> visOut : array<f32>;\n" +
    "@group(0) @binding(3) var<uniform> params : SpatialParams;\n" +
    "fn rswGauss5(i : i32) -> f32 {\n" +
    "  var g = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);\n" +
    "  return g[u32(clamp(i + 2, 0, 4))];\n" +
    "}\n" +
    "@compute @workgroup_size(" + wg + ")\n" +
    "fn rswRtSpatial(@builtin(global_invocation_id) gid : vec3u) {\n" +
    "  let w = i32(params.dims.x);\n" +
    "  let h = i32(params.dims.y);\n" +
    "  let total = w * h;\n" +
    "  let idx = i32(gid.x);\n" +
    "  if (idx >= total) { return; }\n" +
    "  let v0 = clamp(visIn[idx], 0.0, 1.0);\n" +
    "  let og = origins[idx];\n" +
    "  if (og.w <= 0.0) { visOut[idx] = v0; return; }\n" +
    "  let x = idx % w;\n" +
    "  let y = idx / w;\n" +
    "  var n = 0.0;\n" +
    "  var s = 0.0;\n" +
    "  var s2 = 0.0;\n" +
    "  for (var dy = -1; dy <= 1; dy = dy + 1) {\n" +
    "    let yy = y + dy;\n" +
    "    if (yy < 0 || yy >= h) { continue; }\n" +
    "    for (var dx = -1; dx <= 1; dx = dx + 1) {\n" +
    "      let xx = x + dx;\n" +
    "      if (xx < 0 || xx >= w) { continue; }\n" +
    "      let j = yy * w + xx;\n" +
    "      if (origins[j].w <= 0.0) { continue; }\n" +
    "      let v = clamp(visIn[j], 0.0, 1.0);\n" +
    "      n = n + 1.0;\n" +
    "      s = s + v;\n" +
    "      s2 = s2 + v * v;\n" +
    "    }\n" +
    "  }\n" +
    "  let mean = select(v0, s / max(n, 1.0), n > 0.0);\n" +
    "  let variance = select(0.0, max(0.0, s2 / max(n, 1.0) - mean * mean), n > 0.0);\n" +
    "  if (variance <= params.tune.y) { visOut[idx] = v0; return; }\n" +
    "  let p = og.xyz;\n" +
    "  let dist = length(p - params.cam.xyz);\n" +
    "  let sw = max(params.tune.x, params.cam.w * dist * 3.0);\n" +
    "  let inv2 = 1.0 / (2.0 * sw * sw);\n" +
    "  let r = i32(clamp(params.dims.z, 1u, 3u));\n" +
    "  var wSum = 0.0;\n" +
    "  var vSum = 0.0;\n" +
    "  for (var dy = -r; dy <= r; dy = dy + 1) {\n" +
    "    let yy = y + dy;\n" +
    "    if (yy < 0 || yy >= h) { continue; }\n" +
    "    for (var dx = -r; dx <= r; dx = dx + 1) {\n" +
    "      let xx = x + dx;\n" +
    "      if (xx < 0 || xx >= w) { continue; }\n" +
    "      let j = yy * w + xx;\n" +
    "      let oj = origins[j];\n" +
    "      if (oj.w <= 0.0) { continue; }\n" +
    "      let dd = oj.xyz - p;\n" +
    "      var gw = exp(-dot(dd, dd) * inv2);\n" +
    "      if (r == 2) { gw = gw * rswGauss5(dx) * rswGauss5(dy); }\n" +
    "      wSum = wSum + gw;\n" +
    "      vSum = vSum + clamp(visIn[j], 0.0, 1.0) * gw;\n" +
    "    }\n" +
    "  }\n" +
    "  visOut[idx] = select(v0, clamp(vSum / wSum, 0.0, 1.0), wSum > 1e-9);\n" +
    "}\n"
  );
}











export const RT_C2_VERSION = "rt-parity-11c2";


export const RT_C2_CPU_MS_GATE = 12;

export const RT_C2_MIN_PASSES = 2;

export const RT_C2_GPU_REGRET = 1.5;

export const RT_C2_ORIGINS_PER_FRAME = 262144;

export const RT_C2_EMA_ALPHA = 0.3;
export const RT_C2_MS_SAMPLE_MAX = 10000;

function c2Num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function c2Clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}




export function spatialEmaStep(prev, sampleMs) {
  const s = c2Clamp(c2Num(sampleMs, 0), 0, RT_C2_MS_SAMPLE_MAX);
  const p = c2Num(prev, 0);
  if (!(p > 0)) return s;
  return p + (s - p) * RT_C2_EMA_ALPHA;
}











export function decideSpatialBackend(args) {
  const a = args && typeof args === "object" ? args : {};
  const mode = a.mode === "cpu" || a.mode === "gpu" || a.mode === "ab" || a.mode === "auto" ? a.mode : "auto";
  if (mode === "cpu") return "cpu";
  const gpuOk = a.gpuReady === true && a.failed !== true;
  const traced = c2Num(a.traced, 0);
  if (!gpuOk || !(traced > 0)) return "cpu";
  if (mode === "gpu") return "gpu";
  if (mode === "ab") return "ab";
  const minPasses = Math.max(1, Math.round(c2Num(a.minPasses, RT_C2_MIN_PASSES)));
  const gate = Math.max(0, c2Num(a.cpuMsGate, RT_C2_CPU_MS_GATE));
  const regret = Math.max(1, c2Num(a.gpuRegret, RT_C2_GPU_REGRET));
  const cpuPasses = c2Num(a.cpuPasses, 0);
  const cpuMsEma = c2Num(a.cpuMsEma, 0);
  const gpuPasses = c2Num(a.gpuPasses, 0);
  const gpuMsEma = c2Num(a.gpuMsEma, 0);
  if (cpuPasses < minPasses) return "cpu";                           
  if (!(cpuMsEma > gate)) return "cpu";                            
  if (gpuPasses > 0 && gpuMsEma > cpuMsEma * regret) return "cpu";                  
  return "gpu";
}





export function maskDiffStats(a, b, valid) {
  if (!a || !b || a.length !== b.length) {
    throw new RangeError("rtParityCore: máscaras A/B com tamanhos diferentes");
  }
  if (valid && valid.length !== a.length) {
    throw new RangeError("rtParityCore: valid deve ter o tamanho das máscaras");
  }
  let n = 0;
  let maxAbs = 0;
  let sumAbs = 0;
  let over = 0;
  for (let i = 0; i < a.length; i++) {
    if (valid && !(valid[i] > 0)) continue;
    const va = c2Clamp(c2Num(a[i], 0), 0, 1);
    const vb = c2Clamp(c2Num(b[i], 0), 0, 1);
    const d = Math.abs(va - vb);
    n++;
    sumAbs += d;
    if (d > maxAbs) maxAbs = d;
    if (d > 1 / 255) over++;
  }
  return {
    n,
    maxAbs,
    meanAbs: n > 0 ? sumAbs / n : 0,
    pctOver: n > 0 ? over / n : 0,
  };
}
