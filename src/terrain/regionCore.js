import { MATERIAL_COUNT, VOXEL_SIZE } from "./materials.js";


export const REGION_LIMITS = Object.freeze({
  MAX_HALF_X: 256,
  MAX_HALF_Z: 256,
  MIN_Y: -64,
  MAX_Y: 128,
  MAX_SPAN_VOXELS: 128,
});

function toInt(v) { return Number.isFinite(v) ? Math.trunc(v) : null; }

function clampMat(mat) {
  const m = toInt(mat);
  if (m == null) return 0;
  return Math.max(0, Math.min(MATERIAL_COUNT - 1, m));
}


export function clampRegionBox(box) {
  if (!box || typeof box !== "object") return null;
  const ax = toInt(box.x0), ay = toInt(box.y0), az = toInt(box.z0);
  const bx = toInt(box.x1), by = toInt(box.y1), bz = toInt(box.z1);
  if (ax == null || ay == null || az == null || bx == null || by == null || bz == null) return null;
  let x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
  let y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  let z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  const L = REGION_LIMITS;
  x0 = Math.max(-L.MAX_HALF_X, Math.min(L.MAX_HALF_X, x0));
  x1 = Math.max(-L.MAX_HALF_X, Math.min(L.MAX_HALF_X, x1));
  z0 = Math.max(-L.MAX_HALF_Z, Math.min(L.MAX_HALF_Z, z0));
  z1 = Math.max(-L.MAX_HALF_Z, Math.min(L.MAX_HALF_Z, z1));
  y0 = Math.max(L.MIN_Y, Math.min(L.MAX_Y, y0));
  y1 = Math.max(L.MIN_Y, Math.min(L.MAX_Y, y1));
  x1 = Math.min(x1, x0 + L.MAX_SPAN_VOXELS - 1);
  y1 = Math.min(y1, y0 + L.MAX_SPAN_VOXELS - 1);
  z1 = Math.min(z1, z0 + L.MAX_SPAN_VOXELS - 1);
  if (x1 < x0 || y1 < y0 || z1 < z0) return null;
  return Object.freeze({ x0, y0, z0, x1, y1, z1 });
}


export function regionFromVoxelCorners(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const ax = toInt(a[0]), ay = toInt(a[1]), az = toInt(a[2]);
  let bx = toInt(b[0]), by = toInt(b[1]), bz = toInt(b[2]);
  if (ax == null || ay == null || az == null || bx == null || by == null || bz == null) return null;
  const s = REGION_LIMITS.MAX_SPAN_VOXELS - 1;
  bx = Math.max(ax - s, Math.min(ax + s, bx));
  by = Math.max(ay - s, Math.min(ay + s, by));
  bz = Math.max(az - s, Math.min(az + s, bz));
  return clampRegionBox({ x0: ax, y0: ay, z0: az, x1: bx, y1: by, z1: bz });
}

export function regionVolume(box) {
  if (!box) return 0;
  return (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1) * (box.z1 - box.z0 + 1);
}


export function regionBoxToWorld(box) {
  if (!box) return null;
  return {
    min: [box.x0 * VOXEL_SIZE, box.y0 * VOXEL_SIZE, box.z0 * VOXEL_SIZE],
    max: [(box.x1 + 1) * VOXEL_SIZE, (box.y1 + 1) * VOXEL_SIZE, (box.z1 + 1) * VOXEL_SIZE],
  };
}

export function worldPointToVoxel(wx, wy, wz) {
  return [Math.floor(wx / VOXEL_SIZE), Math.floor(wy / VOXEL_SIZE), Math.floor(wz / VOXEL_SIZE)];
}


export function fitRegionYToTerrain(data, box) {
  if (!data || !box) return box || null;
  const b = data.getBounds ? data.getBounds() : null;
  if (!b || !b.min || !b.max) return box;
  const yLo = Math.max(REGION_LIMITS.MIN_Y, Math.min(box.y0, b.min[1]));
  const yHi = Math.min(REGION_LIMITS.MAX_Y, Math.max(box.y1, b.max[1]));
  let minY = Infinity, maxY = -Infinity;
  for (let z = box.z0; z <= box.z1; z++)
    for (let x = box.x0; x <= box.x1; x++)
      for (let y = yLo; y <= yHi; y++) {
        if (data.getOcc(x, y, z) > 0) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
  if (minY === Infinity) return box;
  return clampRegionBox({
    x0: box.x0, y0: Math.min(minY, box.y0), z0: box.z0,
    x1: box.x1, y1: Math.max(maxY, box.y1), z1: box.z1,
  });
}


export function regionStats(data, box) {
  const counts = new Array(MATERIAL_COUNT).fill(0);
  const out = { volume: regionVolume(box), occupied: 0, counts, dominant: -1 };
  if (!data || !box) return out;
  for (let z = box.z0; z <= box.z1; z++)
    for (let y = box.y0; y <= box.y1; y++)
      for (let x = box.x0; x <= box.x1; x++) {
        if (data.getOcc(x, y, z) > 0) {
          out.occupied++;
          const m = data.getMat(x, y, z) | 0;
          if (m >= 0 && m < MATERIAL_COUNT) counts[m]++;
        }
      }
  let best = 0;
  for (let i = 0; i < MATERIAL_COUNT; i++) {
    if (counts[i] > best) { best = counts[i]; out.dominant = i; }
  }
  return out;
}


export function applyFillRegion(data, box, mat) {
  if (!data || !box) return 0;
  const m = clampMat(mat);
  let changed = 0;
  for (let z = box.z0; z <= box.z1; z++)
    for (let y = box.y0; y <= box.y1; y++)
      for (let x = box.x0; x <= box.x1; x++) {
        if (data.getOcc(x, y, z) >= 1 && (data.getMat(x, y, z) | 0) === m) continue;
        data.set(x, y, z, m, 1);
        changed++;
      }
  return changed;
}


export function applyReplaceRegion(data, box, fromMat, toMat) {
  if (!data || !box) return 0;
  const from = clampMat(fromMat), to = clampMat(toMat);
  if (from === to) return 0;
  let changed = 0;
  for (let z = box.z0; z <= box.z1; z++)
    for (let y = box.y0; y <= box.y1; y++)
      for (let x = box.x0; x <= box.x1; x++) {
        if (data.getOcc(x, y, z) > 0 && (data.getMat(x, y, z) | 0) === from) {
          if (data.paint(x, y, z, to)) changed++;
        }
      }
  return changed;
}
