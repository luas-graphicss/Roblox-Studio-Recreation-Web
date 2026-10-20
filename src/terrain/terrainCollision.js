import { VOXEL_SIZE, isWaterMaterial } from "./materials.js";

const ISO = 0.5;
const MIN_KEEP = 0.55;                                                          


const FULL_KEEP = 0.75;
const FULL_OCC = 0.999;
const W = [0.25, 0.5, 0.25];                          
const GRAD_H = 0.6 * VOXEL_SIZE;                                               
const CACHE_MAX = 65536;                                                   


const COORD_LIMIT = 65535;
const KEY_SPAN = 2 * COORD_LIMIT + 2;                 
const KEY_SPAN2 = KEY_SPAN * KEY_SPAN;        
const SCAN_STEP = VOXEL_SIZE * 0.5;
const MAX_SCAN_STEPS = 64;
const BISECT_ITERS = 8;                                  
const MAX_LIFT = VOXEL_SIZE * 2;                                    


export const WALKABLE_NY = 0.35;

export function createTerrainSampler() {
  return { cache: new Map(), td: null, version: -1 };
}


export function syncTerrainSampler(sampler, td) {
  const v = td && typeof td.version === "number" ? td.version : -1;
  if (sampler.td !== td || sampler.version !== v) {
    sampler.cache.clear();
    sampler.td = td;
    sampler.version = v;
  }
}

function solidOcc(td, vx, vy, vz) {
  const o = td.getOcc(vx, vy, vz);
  if (!(o > 0)) return 0;
  if (isWaterMaterial(td.getMat(vx, vy, vz))) return 0;
  return o > 1 ? 1 : o;
}

function clampCoord(v) {
  return v < -COORD_LIMIT ? -COORD_LIMIT : v > COORD_LIMIT ? COORD_LIMIT : v;
}


export function latticeDensity(sampler, td, vx, vy, vz) {
  vx = clampCoord(vx); vy = clampCoord(vy); vz = clampCoord(vz);
  const key = (vx + COORD_LIMIT) + (vy + COORD_LIMIT) * KEY_SPAN + (vz + COORD_LIMIT) * KEY_SPAN2;
  const cache = sampler.cache;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let blur = 0;
  for (let dz = -1; dz <= 1; dz++) {
    const wz = W[dz + 1];
    for (let dy = -1; dy <= 1; dy++) {
      const wyz = wz * W[dy + 1];
      for (let dx = -1; dx <= 1; dx++) {
        const o = solidOcc(td, vx + dx, vy + dy, vz + dz);
        if (o > 0) blur += o * wyz * W[dx + 1];
      }
    }
  }
  const o0 = solidOcc(td, vx, vy, vz);
  const keep = o0 >= FULL_OCC ? FULL_KEEP : o0 * MIN_KEEP;
  const dens = blur > keep ? blur : keep;
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, dens);
  return dens;
}


export function densityAt(sampler, td, wx, wy, wz) {
  if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) return 0;
  const fx = wx / VOXEL_SIZE, fy = wy / VOXEL_SIZE, fz = wz / VOXEL_SIZE;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  const tx = fx - x0, ty = fy - y0, tz = fz - z0;
  const d000 = latticeDensity(sampler, td, x0, y0, z0);
  const d100 = latticeDensity(sampler, td, x0 + 1, y0, z0);
  const d010 = latticeDensity(sampler, td, x0, y0 + 1, z0);
  const d110 = latticeDensity(sampler, td, x0 + 1, y0 + 1, z0);
  const d001 = latticeDensity(sampler, td, x0, y0, z0 + 1);
  const d101 = latticeDensity(sampler, td, x0 + 1, y0, z0 + 1);
  const d011 = latticeDensity(sampler, td, x0, y0 + 1, z0 + 1);
  const d111 = latticeDensity(sampler, td, x0 + 1, y0 + 1, z0 + 1);
  const c00 = d000 + (d100 - d000) * tx;
  const c10 = d010 + (d110 - d010) * tx;
  const c01 = d001 + (d101 - d001) * tx;
  const c11 = d011 + (d111 - d011) * tx;
  const c0 = c00 + (c10 - c00) * ty;
  const c1 = c01 + (c11 - c01) * ty;
  return c0 + (c1 - c0) * tz;
}


export function surfaceNormalAt(sampler, td, wx, wy, wz) {
  const gx = densityAt(sampler, td, wx + GRAD_H, wy, wz) - densityAt(sampler, td, wx - GRAD_H, wy, wz);
  const gy = densityAt(sampler, td, wx, wy + GRAD_H, wz) - densityAt(sampler, td, wx, wy - GRAD_H, wz);
  const gz = densityAt(sampler, td, wx, wy, wz + GRAD_H) - densityAt(sampler, td, wx, wy, wz - GRAD_H);
  const len = Math.hypot(gx, gy, gz);
  if (!(len > 1e-6)) return null;
  return { x: -gx / len, y: -gy / len, z: -gz / len, grad: len / (2 * GRAD_H) };
}

function bisectSurface(sampler, td, wx, yOut, yIn, wz) {
  let hi = yOut, lo = yIn;                                                     
  for (let k = 0; k < BISECT_ITERS; k++) {
    const mid = (hi + lo) * 0.5;
    if (densityAt(sampler, td, wx, mid, wz) >= ISO) lo = mid; else hi = mid;
  }
  return (hi + lo) * 0.5;
}


function liftOut(sampler, td, wx, wz, fromY) {
  let yA = fromY;
  let dA = densityAt(sampler, td, wx, yA, wz);
  const steps = Math.ceil(MAX_LIFT / SCAN_STEP);
  for (let i = 1; i <= steps; i++) {
    const yB = fromY + i * SCAN_STEP;
    const dB = densityAt(sampler, td, wx, yB, wz);
    if (dA >= ISO && dB < ISO) {
      const sy = bisectSurface(sampler, td, wx, yB, yA, wz);
      const n = surfaceNormalAt(sampler, td, wx, sy, wz);
      if (n && n.y >= WALKABLE_NY) return { y: sy, nx: n.x, ny: n.y, nz: n.z };
      return null;
    }
    yA = yB; dA = dB;
  }
  return null;
}


export function groundAt(sampler, td, wx, wz, topY, maxDepth) {
  if (!Number.isFinite(wx) || !Number.isFinite(wz) || !Number.isFinite(topY)) return null;
  let yA = topY;
  let dA = densityAt(sampler, td, wx, yA, wz);
  if (dA >= ISO) return liftOut(sampler, td, wx, wz, topY);
  const depth = maxDepth > 0 ? maxDepth : VOXEL_SIZE;
  const steps = Math.min(MAX_SCAN_STEPS, Math.max(1, Math.ceil(depth / SCAN_STEP)));
  for (let i = 1; i <= steps; i++) {
    const yB = topY - i * SCAN_STEP;
    const dB = densityAt(sampler, td, wx, yB, wz);
    if (dA < ISO && dB >= ISO) {
      const sy = bisectSurface(sampler, td, wx, yA, yB, wz);
      const n = surfaceNormalAt(sampler, td, wx, sy, wz);
      if (n && n.y >= WALKABLE_NY) return { y: sy, nx: n.x, ny: n.y, nz: n.z };
    }
    yA = yB; dA = dB;
  }
  return null;
}


export function ceilingAt(sampler, td, wx, wz, fromY, maxUp) {
  if (!Number.isFinite(wx) || !Number.isFinite(wz) || !Number.isFinite(fromY)) return null;
  let yA = fromY;
  let dA = densityAt(sampler, td, wx, yA, wz);
  if (dA >= ISO) return fromY;
  const range = maxUp > 0 ? maxUp : VOXEL_SIZE;
  const steps = Math.min(MAX_SCAN_STEPS, Math.max(1, Math.ceil(range / SCAN_STEP)));
  for (let i = 1; i <= steps; i++) {
    const yB = fromY + i * SCAN_STEP;
    const dB = densityAt(sampler, td, wx, yB, wz);
    if (dB >= ISO) return bisectSurface(sampler, td, wx, yA, yB, wz);
    yA = yB; dA = dB;
  }
  return null;
}


export function wallPushAt(sampler, td, wx, wy, wz, radius) {
  if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz) || !(radius > 0)) return null;
  const dens = densityAt(sampler, td, wx, wy, wz);
  const n = surfaceNormalAt(sampler, td, wx, wy, wz);
  if (!n || !(n.grad > 1e-4)) return null;
  let sd = (ISO - dens) / n.grad;                                    
  if (sd < -VOXEL_SIZE) sd = -VOXEL_SIZE;                                           
  if (sd >= radius) return null;
  if (n.y >= WALKABLE_NY) return null;                                      
  if (n.y <= -0.7) return null;                                         
  const hl = Math.hypot(n.x, n.z);
  if (!(hl > 0.15)) return null;
  let push = (radius - sd) / hl;
  const maxPush = radius * 1.5;                                             
  if (push > maxPush) push = maxPush;
  return { x: (n.x / hl) * push, z: (n.z / hl) * push };
}


export const WARM_MAX_POINTS_PER_CALL = 2048;                                


export function createCollisionWarmState(x0, y0, z0, x1, y1, z1) {
  const c = (v) => clampCoord(Math.floor(Number.isFinite(v) ? v : 0));
  let ax = c(x0), ay = c(y0), az = c(z0);
  let bx = c(x1), by = c(y1), bz = c(z1);
  if (bx < ax) { const t = ax; ax = bx; bx = t; }
  if (by < ay) { const t = ay; ay = by; by = t; }
  if (bz < az) { const t = az; az = bz; bz = t; }
  const sx = bx - ax + 1, sy = by - ay + 1, sz = bz - az + 1;
  const total = sx * sy * sz;
  return { x0: ax, y0: ay, z0: az, sx, sy, sz, cursor: 0, total, done: total <= 0 };
}


export function warmCollisionRegion(sampler, td, state, opts = {}) {
  const neutral = { computed: 0, done: true, remaining: 0 };
  if (!sampler || !(sampler.cache instanceof Map) || !td || typeof td.getOcc !== "function") return neutral;
  if (!state || !Number.isFinite(state.cursor) || !Number.isFinite(state.total)) return neutral;
  if (state.done || state.cursor >= state.total) { state.done = true; return neutral; }
  syncTerrainSampler(sampler, td);                                             
  const maxPoints = Number.isFinite(opts.maxPoints) ? Math.max(1, Math.floor(opts.maxPoints)) : WARM_MAX_POINTS_PER_CALL;
  const budgetMs = Number.isFinite(opts.budgetMs) ? Math.max(0, opts.budgetMs) : Infinity;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const t0 = now();
  const sx = state.sx, sxy = state.sx * state.sy;
  let computed = 0;
  while (state.cursor < state.total && computed < maxPoints) {
    const i = state.cursor++;
    const lx = i % sx;
    const ly = Math.floor(i / sx) % state.sy;
    const lz = Math.floor(i / sxy);
    latticeDensity(sampler, td, state.x0 + lx, state.y0 + ly, state.z0 + lz);
    computed++;
    if ((computed & 63) === 0 && now() - t0 >= budgetMs) break;
  }
  state.done = state.cursor >= state.total;
  return { computed, done: state.done, remaining: state.total - state.cursor };
}
