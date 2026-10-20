import { VOXEL_SIZE } from "./materials.js";


export const TERRAIN_FILL_MAX_SPAN = 512;                  
export const FILL_FACE_EPS = 1e-6;                                                        

const num = (v) => (typeof v === "number" ? v : Number(v) || 0);


export function safeUnitQuat(q) {
  if (!q) return null;
  const x = Number(q.x), y = Number(q.y), z = Number(q.z), w = Number(q.w);
  if (!Number.isFinite(x + y + z + w)) return null;
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  if (!(len > 1e-8)) return null;
  return { x: x / len, y: y / len, z: z / len, w: w / len };
}


export function regionToBox(min, max) {
  const x0 = num(min && min.x), y0 = num(min && min.y), z0 = num(min && min.z);
  const x1 = num(max && max.x), y1 = num(max && max.y), z1 = num(max && max.z);
  if (!Number.isFinite(x0 + y0 + z0 + x1 + y1 + z1)) return null;
  const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
  if (!(sx > 0 && sy > 0 && sz > 0)) return null;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, sx, sy, sz };
}


export function expandRegionToGrid(min, max, resolution) {
  const res = num(resolution);
  if (!Number.isFinite(res) || !(res > 0)) return null;
  const x0 = Math.floor(num(min && min.x) / res) * res;
  const y0 = Math.floor(num(min && min.y) / res) * res;
  const z0 = Math.floor(num(min && min.z) / res) * res;
  const x1 = Math.ceil(num(max && max.x) / res) * res;
  const y1 = Math.ceil(num(max && max.y) / res) * res;
  const z1 = Math.ceil(num(max && max.z) / res) * res;
  if (!Number.isFinite(x0 + y0 + z0 + x1 + y1 + z1)) return null;
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
}

export function fillBlockVoxels(cx, cy, cz, sx, sy, sz, quat, write) {
  if (typeof write !== "function") return;
  const V = VOXEL_SIZE;
  cx = num(cx); cy = num(cy); cz = num(cz);
  const clamp = (v) => Math.min(TERRAIN_FILL_MAX_SPAN, Math.max(0, num(v)));
  sx = clamp(sx); sy = clamp(sy); sz = clamp(sz);
  if (!(sx > 0 && sy > 0 && sz > 0)) return;
  if (!Number.isFinite(cx + cy + cz)) return;
  const q = safeUnitQuat(quat);
  if (!q || (q.x === 0 && q.y === 0 && q.z === 0)) {


    for (let z = Math.floor((cz - sz / 2) / V); z <= Math.floor((cz + sz / 2) / V); z++) {
      const wz = (z + 0.5) * V;
      if (wz < cz - sz / 2 || wz > cz + sz / 2) continue;
      for (let y = Math.floor((cy - sy / 2) / V); y <= Math.floor((cy + sy / 2) / V); y++) {
        const wy = (y + 0.5) * V;
        if (wy < cy - sy / 2 || wy > cy + sy / 2) continue;
        for (let x = Math.floor((cx - sx / 2) / V); x <= Math.floor((cx + sx / 2) / V); x++) {
          const wx = (x + 0.5) * V;
          if (wx < cx - sx / 2 || wx > cx + sx / 2) continue;
          write(x, y, z);
        }
      }
    }
    return;
  }


  const xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
  const xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
  const wxq = q.w * q.x, wyq = q.w * q.y, wzq = q.w * q.z;
  const ax = { x: 1 - 2 * (yy + zz), y: 2 * (xy + wzq), z: 2 * (xz - wyq) };
  const ay = { x: 2 * (xy - wzq), y: 1 - 2 * (xx + zz), z: 2 * (yz + wxq) };
  const az = { x: 2 * (xz + wyq), y: 2 * (yz - wxq), z: 1 - 2 * (xx + yy) };
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;

  const ex = Math.abs(ax.x) * hx + Math.abs(ay.x) * hy + Math.abs(az.x) * hz;
  const ey = Math.abs(ax.y) * hx + Math.abs(ay.y) * hy + Math.abs(az.y) * hz;
  const ez = Math.abs(ax.z) * hx + Math.abs(ay.z) * hy + Math.abs(az.z) * hz;
  const axes = [ax, ay, az];
  const half = [hx + FILL_FACE_EPS, hy + FILL_FACE_EPS, hz + FILL_FACE_EPS];
  for (let z = Math.floor((cz - ez) / V); z <= Math.floor((cz + ez) / V); z++) {
    const dz = (z + 0.5) * V - cz;
    for (let y = Math.floor((cy - ey) / V); y <= Math.floor((cy + ey) / V); y++) {
      const dy = (y + 0.5) * V - cy;


      let lo = cx - ex, hi = cx + ex, ok = true;
      for (let i = 0; i < 3; i++) {
        const A = axes[i];
        const b = dy * A.y + dz * A.z;
        const s = A.x, h = half[i];
        if (Math.abs(s) < 1e-12) {
          if (Math.abs(b) > h) { ok = false; break; }
        } else {
          let t0 = cx + (-h - b) / s;
          let t1 = cx + (h - b) / s;
          if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
          if (t0 > lo) lo = t0;
          if (t1 < hi) hi = t1;
          if (lo > hi) { ok = false; break; }
        }
      }
      if (!ok) continue;

      const x0 = Math.ceil(lo / V - 0.5);
      const x1 = Math.floor(hi / V - 0.5);
      for (let x = x0; x <= x1; x++) write(x, y, z);
    }
  }
}
