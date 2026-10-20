import { VOXEL_SIZE, isWaterMaterial } from "../terrain/materials.js";
import { CHUNK } from "../terrain/terrainData.js";


import {
  gerstnerSurfaceHeight,
  waveAttenuation,
  DEPTH_RANGE,

  waterFlowSpeed,
  WATER_FLOW_DIR_X,
  WATER_FLOW_DIR_Z,
} from "../terrain/waterWaves.js";

export const WATER_DENSITY = 1;                                   
const WATER_OCC = 0.5;                                                 
const WATER_OCC_RAW = 128;                                                
const WAKE_RATIO = 1.15;                                          
const MAX_BUOY_ACCEL_G = 20;                                           
const LINEAR_DRAG = 3;                                     
const ANGULAR_DRAG = 2;                                       
const MAX_SAMPLES_AXIS = 3;                                               
const SURFACE_SCAN_VOXELS = 32;                                              

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}


function nAxis(size) {
  const n = Math.ceil(size / 2.5);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n > MAX_SAMPLES_AXIS ? MAX_SAMPLES_AXIS : n;
}


function rotv(q, x, y, z) {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return {
    x: x + q.w * tx + (q.y * tz - q.z * ty),
    y: y + q.w * ty + (q.z * tx - q.x * tz),
    z: z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function qmul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}




export function buildWaterField(data) {
  const boxes = [];
  let gmin = null;
  let gmax = null;

  const isWater = (vx, vy, vz) => {
    if (!data) return false;
    return data.getOcc(vx, vy, vz) >= WATER_OCC && isWaterMaterial(data.getMat(vx, vy, vz));
  };


  const waterOcc01 = (vx, vy, vz) => {
    if (!data) return 0;
    const o = data.getOcc(vx, vy, vz);
    if (o <= 0) return 0;
    return isWaterMaterial(data.getMat(vx, vy, vz)) ? clamp01(o) : 0;
  };
  const waveDy = (vx, top, vz, wx, wz, waves) => {
    let col = 0;
    for (let i = 0; i < DEPTH_RANGE; i++) col += waterOcc01(vx, top - i, vz);


    return gerstnerSurfaceHeight(wx, wz, waves.t, waves.amp * waveAttenuation(col / DEPTH_RANGE, 1));
  };

  if (data && data.chunks && data.chunks.size > 0) {
    for (const [key, chunk] of data.chunks) {
      if (!chunk || !chunk.occ || !chunk.mat) continue;
      const parts = String(key).split("|");
      const cx = Number(parts[0]);
      const cy = Number(parts[1]);
      const cz = Number(parts[2]);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) continue;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity;
      let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      let any = false;
      for (let i = 0; i < chunk.occ.length; i++) {
        if (chunk.occ[i] < WATER_OCC_RAW || !isWaterMaterial(chunk.mat[i])) continue;
        const lx = i % CHUNK;
        const ly = ((i / CHUNK) | 0) % CHUNK;
        const lz = (i / (CHUNK * CHUNK)) | 0;
        any = true;
        if (lx < x0) x0 = lx;
        if (lx > x1) x1 = lx;
        if (ly < y0) y0 = ly;
        if (ly > y1) y1 = ly;
        if (lz < z0) z0 = lz;
        if (lz > z1) z1 = lz;
      }
      if (!any) continue;
      const b = {
        minX: (cx * CHUNK + x0) * VOXEL_SIZE,
        minY: (cy * CHUNK + y0) * VOXEL_SIZE,
        minZ: (cz * CHUNK + z0) * VOXEL_SIZE,
        maxX: (cx * CHUNK + x1 + 1) * VOXEL_SIZE,
        maxY: (cy * CHUNK + y1 + 1) * VOXEL_SIZE,
        maxZ: (cz * CHUNK + z1 + 1) * VOXEL_SIZE,
      };
      boxes.push(b);
      if (!gmin) {
        gmin = { x: b.minX, y: b.minY, z: b.minZ };
        gmax = { x: b.maxX, y: b.maxY, z: b.maxZ };
      } else {
        if (b.minX < gmin.x) gmin.x = b.minX;
        if (b.minY < gmin.y) gmin.y = b.minY;
        if (b.minZ < gmin.z) gmin.z = b.minZ;
        if (b.maxX > gmax.x) gmax.x = b.maxX;
        if (b.maxY > gmax.y) gmax.y = b.maxY;
        if (b.maxZ > gmax.z) gmax.z = b.maxZ;
      }
    }
  }

  return {
    hasWater: boxes.length > 0,
    boxes,
    min: gmin,
    max: gmax,


    sampleSubmersion(wx, wy, wz, cellH, waves) {
      const vx = Math.floor(wx / VOXEL_SIZE);
      const vy = Math.floor(wy / VOXEL_SIZE);
      const vz = Math.floor(wz / VOXEL_SIZE);
      if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) return 0;
      let h = Number(cellH);
      if (!Number.isFinite(h)) h = VOXEL_SIZE;
      h = Math.min(2 * VOXEL_SIZE, Math.max(0.5, h));
      const wAmp =
        waves && Number.isFinite(waves.amp) && waves.amp > 0 && Number.isFinite(waves.t)
          ? waves.amp
          : 0;
      if (isWater(vx, vy, vz)) {
        let top = vy;
        let guard = 0;
        while (guard < SURFACE_SCAN_VOXELS && isWater(vx, top + 1, vz)) {
          top += 1;
          guard += 1;
        }
        if (guard >= SURFACE_SCAN_VOXELS) return 1;                          
        let surface = (top + 1) * VOXEL_SIZE;
        if (wAmp > 0) surface += waveDy(vx, top, vz, wx, wz, waves);
        return clamp01((surface - wy) / h + 0.5);
      }


      const down = wAmp > 0 ? 1 + Math.ceil(wAmp / VOXEL_SIZE) : 1;
      for (let d = 1; d <= down; d++) {
        const yy = vy - d;
        if (isWater(vx, yy, vz)) {
          let surface = (yy + 1) * VOXEL_SIZE;
          if (wAmp > 0) surface += waveDy(vx, yy, vz, wx, wz, waves);
          return clamp01((surface - wy) / h + 0.5);
        }
        if (data && data.getOcc(vx, yy, vz) >= WATER_OCC) return 0;          
      }
      return 0;
    },


    surfaceYAt(wx, wy, wz, waves) {
      const vx = Math.floor(wx / VOXEL_SIZE);
      const vy = Math.floor(wy / VOXEL_SIZE);
      const vz = Math.floor(wz / VOXEL_SIZE);
      if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) return NaN;
      const wAmp =
        waves && Number.isFinite(waves.amp) && waves.amp > 0 && Number.isFinite(waves.t)
          ? waves.amp
          : 0;
      if (isWater(vx, vy, vz)) {
        let top = vy;
        let guard = 0;
        while (guard < SURFACE_SCAN_VOXELS && isWater(vx, top + 1, vz)) {
          top += 1;
          guard += 1;
        }
        if (guard >= SURFACE_SCAN_VOXELS) return NaN;                       
        let surface = (top + 1) * VOXEL_SIZE;
        if (wAmp > 0) surface += waveDy(vx, top, vz, wx, wz, waves);
        return surface;
      }
      const down = wAmp > 0 ? 1 + Math.ceil(wAmp / VOXEL_SIZE) : 1;
      for (let d = 1; d <= down; d++) {
        const yy = vy - d;
        if (isWater(vx, yy, vz)) {
          let surface = (yy + 1) * VOXEL_SIZE;
          if (wAmp > 0) surface += waveDy(vx, yy, vz, wx, wz, waves);
          return surface;
        }
        if (data && data.getOcc(vx, yy, vz) >= WATER_OCC) return NaN;          
      }
      return NaN;
    },

    intersects(minX, minY, minZ, maxX, maxY, maxZ) {
      if (!this.hasWater || !this.min) return false;
      if (
        maxX < this.min.x || minX > this.max.x ||
        maxY < this.min.y || minY > this.max.y ||
        maxZ < this.min.z || minZ > this.max.z
      ) return false;
      for (const b of this.boxes) {
        if (
          maxX >= b.minX && minX <= b.maxX &&
          maxY >= b.minY && minY <= b.maxY &&
          maxZ >= b.minZ && minZ <= b.maxZ
        ) return true;
      }
      return false;
    },
  };
}


export function applyBuoyancy(field, args) {
  const stats = { bodiesInWater: 0, samples: 0 };
  if (!field || !field.hasWater || !args) return stats;
  const g = Number.isFinite(args.gravityY) ? Math.abs(args.gravityY) : 196.2;
  const dt = Number.isFinite(args.dt) && args.dt > 0 ? args.dt : 1 / 60;
  if (g <= 0) return stats;                                            
  const getFloats = typeof args.getFloats === "function" ? args.getFloats : () => null;
  const bodies = args.bodies || [];
  const waves =
    args.waves && Number.isFinite(args.waves.amp) && args.waves.amp > 0 &&
    Number.isFinite(args.waves.t)
      ? args.waves
      : null;

  for (const body of bodies) {
    if (!body || typeof body.isDynamic !== "function" || !body.isDynamic()) continue;
    const floats = getFloats(body);
    if (!floats || floats.length === 0) continue;


    let br = floats.__boundR;
    if (!Number.isFinite(br)) {
      br = 0;
      for (const f of floats) {
        const o = f.offset;
        const hf = f.half;
        const r =
          Math.sqrt(o.x * o.x + o.y * o.y + o.z * o.z) +
          Math.sqrt(hf.x * hf.x + hf.y * hf.y + hf.z * hf.z);
        if (Number.isFinite(r) && r > br) br = r;
      }
      floats.__boundR = br;
    }
    const p = body.position;
    if (!field.intersects(p.x - br, p.y - br, p.z - br, p.x + br, p.y + br, p.z + br)) continue;


    const bq = body.quaternion;
    let totalFb = 0;
    let totalDispMass = 0;
    let nearSurface = false;                                               
    const hits = [];
    for (const f of floats) {
      const vol = Number(f.volume);
      if (!Number.isFinite(vol) || vol <= 0) continue;
      const q = qmul(bq, f.quat);
      const off = rotv(bq, f.offset.x, f.offset.y, f.offset.z);
      const cx0 = p.x + off.x;
      const cy0 = p.y + off.y;
      const cz0 = p.z + off.z;
      const sx = f.half.x * 2;
      const sy = f.half.y * 2;
      const sz = f.half.z * 2;
      if (!Number.isFinite(cx0 + cy0 + cz0 + sx + sy + sz)) continue;                 
      const ax = rotv(q, 1, 0, 0);
      const ay = rotv(q, 0, 1, 0);
      const az = rotv(q, 0, 0, 1);
      const nx = nAxis(sx);
      const ny = nAxis(sy);
      const nz = nAxis(sz);

      const cellH =
        Math.abs(ax.y) * (sx / nx) + Math.abs(ay.y) * (sy / ny) + Math.abs(az.y) * (sz / nz);
      let sumW = 0;
      let wxAcc = 0;
      let wyAcc = 0;
      let wzAcc = 0;
      for (let i = 0; i < nx; i++) {
        const lx = sx * ((i + 0.5) / nx - 0.5);
        for (let j = 0; j < ny; j++) {
          const ly = sy * ((j + 0.5) / ny - 0.5);
          for (let k = 0; k < nz; k++) {
            const lz = sz * ((k + 0.5) / nz - 0.5);
            const px = cx0 + ax.x * lx + ay.x * ly + az.x * lz;
            const py = cy0 + ax.y * lx + ay.y * ly + az.y * lz;
            const pz = cz0 + ax.z * lx + ay.z * ly + az.z * lz;
            const w = field.sampleSubmersion(px, py, pz, cellH, waves);
            stats.samples += 1;
            if (w > 0.02 && w < 0.98) nearSurface = true;
            if (w > 0) {
              sumW += w;
              wxAcc += w * px;
              wyAcc += w * py;
              wzAcc += w * pz;
            }
          }
        }
      }
      if (sumW <= 0) continue;
      const frac = sumW / (nx * ny * nz);
      const dispVol = vol * frac;
      const fb = WATER_DENSITY * g * dispVol;
      totalFb += fb;
      totalDispMass += WATER_DENSITY * dispVol;
      hits.push({
        fb,
        x: wxAcc / sumW,
        y: wyAcc / sumW,
        z: wzAcc / sumW,
        dispMass: WATER_DENSITY * dispVol,
      });
    }
    if (hits.length === 0) continue;
    stats.bodiesInWater += 1;


    if (typeof body.isSleeping === "function" && body.isSleeping()) {
      if (totalFb > WAKE_RATIO * body.mass * g) body.wakeUp();


      else if (waves && nearSurface && totalFb > 0.5 * body.mass * g) body.wakeUp();
      else continue;
    }


    if (waves && nearSurface && totalFb > 0.5 * body.mass * g && typeof body.wakeUp === "function") {
      body.wakeUp();
    }


    let flowX = 0;
    let flowZ = 0;
    if (waves) {
      const sy = field.surfaceYAt(p.x, p.y, p.z, waves);
      if (Number.isFinite(sy)) {
        const fs = waterFlowSpeed(waves, sy - p.y);
        flowX = fs * WATER_FLOW_DIR_X;
        flowZ = fs * WATER_FLOW_DIR_Z;
      }
    }


    const maxFb = MAX_BUOY_ACCEL_G * body.mass * g;
    const scaleFb = totalFb > maxFb && totalFb > 0 ? maxFb / totalFb : 1;

    const w = body.angularVelocity;
    const v = body.velocity;


    let cd = LINEAR_DRAG;
    const kDragTotal = cd * totalDispMass * body.invMass * dt;
    if (kDragTotal > 0.5) cd *= 0.5 / kDragTotal;
    for (const hpt of hits) {

      body.applyForce({ x: 0, y: hpt.fb * scaleFb, z: 0 }, hpt);
      const rx = hpt.x - p.x;
      const ry = hpt.y - p.y;
      const rz = hpt.z - p.z;
      const vx = v.x + w.y * rz - w.z * ry;
      const vy = v.y + w.z * rx - w.x * rz;
      const vz = v.z + w.x * ry - w.y * rx;
      body.applyForce(
        {
          x: -cd * hpt.dispMass * (vx - flowX),
          y: -cd * hpt.dispMass * vy,
          z: -cd * hpt.dispMass * (vz - flowZ),
        },
        hpt,
      );
    }

    const damp = Math.min(0.9, ANGULAR_DRAG * totalDispMass * body.invMass * dt);
    if (damp > 0) {
      w.x *= 1 - damp;
      w.y *= 1 - damp;
      w.z *= 1 - damp;
    }
  }
  return stats;
}
