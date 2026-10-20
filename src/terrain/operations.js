import { commands } from "../core/commands.js";
import { terrainStore } from "./terrainStore.js";
import { VOXEL_SIZE } from "./materials.js";
import { clampNumber } from "../utils/validate.js";


const MAX_HALF_X = 256;                                             
const MAX_HALF_Z = 256;
const MAX_Y = 128;                               
const MIN_Y = -64;                                           
const MAX_DAB_VOXELS = 200000;

function key(x, y, z) { return x + "|" + y + "|" + z; }
function parseKey(k) { const a = k.split("|"); return [+a[0], +a[1], +a[2]]; }


function brushVoxels(data, world, brush, cb) {
  const radiusStuds = clampNumber(brush.size, 1, 64, 12) / 2;
  let wx = world[0], wy = world[1], wz = world[2];
  const r = Math.max(1, Math.round(radiusStuds / VOXEL_SIZE));
  const ry = brush.shape === "Cylinder" ? Math.max(1, Math.round(r * 0.7)) : r;


  const _pivotRise = brush.shape === "Cylinder" ? ry * VOXEL_SIZE : radiusStuds;
  if (brush.pivot === "Base") wy += _pivotRise;                         
  const center = data.worldToVoxel(wx, wy, wz);
  let count = 0;
  for (let dz = -r; dz <= r; dz++)
    for (let dy = -ry; dy <= ry; dy++)
      for (let dx = -r; dx <= r; dx++) {
        let inside = false, falloff = 0;
        if (brush.shape === "Box") {
          const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / r;
          inside = m <= 1; falloff = 1 - m;
        } else if (brush.shape === "Cylinder") {
          const hor = Math.sqrt(dx * dx + dz * dz) / r;
          inside = hor <= 1 && Math.abs(dy) <= ry; falloff = 1 - hor;
        } else {
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / r;
          inside = d <= 1; falloff = 1 - d;
        }
        if (!inside) continue;
        const x = center[0] + dx, y = center[1] + dy, z = center[2] + dz;
        if (Math.abs(x) > MAX_HALF_X || Math.abs(z) > MAX_HALF_Z || y < MIN_Y || y > MAX_Y) continue;
        if (++count > MAX_DAB_VOXELS) return;
        cb(x, y, z, Math.max(0, Math.min(1, falloff)));
      }
}

function neighborAvgOcc(data, x, y, z) {
  let s = 0, n = 0;
  const o = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (const d of o) { s += data.getOcc(x + d[0], y + d[1], z + d[2]); n++; }
  return n ? s / n : 0;
}
function neighborSolid(data, x, y, z) {
  const o = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let best = 0, mat = 0;
  for (const d of o) {
    const oc = data.getOcc(x + d[0], y + d[1], z + d[2]);
    if (oc > best) { best = oc; mat = data.getMat(x + d[0], y + d[1], z + d[2]); }
  }
  return { occ: best, mat };
}
function neighborEmptiness(data, x, y, z) {
  const o = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let empty = 0;
  for (const d of o) if (data.getOcc(x + d[0], y + d[1], z + d[2]) <= 0) empty++;
  return empty / o.length;
}

export function createStroke(tool, material) {
  return { tool, material, data: terrainStore.getData(), before: new Map(), touched: new Set() };
}
function recordBefore(stroke, x, y, z) {
  const k = key(x, y, z);
  if (!stroke.before.has(k))
    stroke.before.set(k, { m: stroke.data.getMat(x, y, z), o: Math.round(stroke.data.getOcc(x, y, z) * 255) });
  stroke.touched.add(k);
}


export function applyDab(stroke, world) {
  const data = stroke.data;
  const brush = terrainStore.getBrush();
  const strength = clampNumber(brush.strength, 0, 1, 0.5);
  const tool = stroke.tool;
  const mat = stroke.material;

  if (tool === "flatten") {
    const ty = data.worldToVoxel(world[0], world[1], world[2])[1];
    brushVoxels(data, world, brush, (x, y, z) => {
      recordBefore(stroke, x, y, z);
      if (y <= ty) data.set(x, y, z, data.getOcc(x, y, z) > 0 ? data.getMat(x, y, z) : mat, 1);
      else data.set(x, y, z, data.getMat(x, y, z), 0);
    });
    return;
  }

  brushVoxels(data, world, brush, (x, y, z, falloff) => {
    recordBefore(stroke, x, y, z);
    const cur = data.getOcc(x, y, z);
    const curMat = data.getMat(x, y, z);
    const amt = strength * (0.4 + 0.6 * falloff);
    if (tool === "add") {
      data.set(x, y, z, cur > 0 ? curMat : mat, Math.min(1, cur + amt));
    } else if (tool === "subtract") {
      data.set(x, y, z, curMat, Math.max(0, cur - amt));
    } else if (tool === "paint") {
      if (cur > 0) data.paint(x, y, z, mat);
    } else if (tool === "smooth") {
      const avg = neighborAvgOcc(data, x, y, z);
      const no = cur + (avg - cur) * amt;
      data.set(x, y, z, no > 0 ? (cur > 0 ? curMat : mat) : curMat, no);
    } else if (tool === "grow") {
      if (cur < 1) {
        const nb = neighborSolid(data, x, y, z);
        if (nb.occ > 0) data.set(x, y, z, cur > 0 ? curMat : nb.mat, Math.min(1, cur + amt * nb.occ));
      }
    } else if (tool === "erode") {
      if (cur > 0) data.set(x, y, z, curMat, Math.max(0, cur - amt * neighborEmptiness(data, x, y, z)));
    }
  });
}


export function finishStroke(stroke) {
  if (!stroke || stroke.touched.size === 0) { terrainStore.notifyChanged(); return; }
  const data = stroke.data;
  const after = new Map();
  for (const k of stroke.touched) {
    const [x, y, z] = parseKey(k);
    after.set(k, { m: data.getMat(x, y, z), o: Math.round(data.getOcc(x, y, z) * 255) });
  }
  const before = stroke.before;
  const apply = (map) => { for (const [k, v] of map) { const [x, y, z] = parseKey(k); data.set(x, y, z, v.m, v.o / 255); } };
  const title = "Terrain " + stroke.tool.charAt(0).toUpperCase() + stroke.tool.slice(1);
  commands.execute({
    name: title,
    do() { apply(after); terrainStore.notifyChanged(); return true; },
    undo() { apply(before); terrainStore.notifyChanged(); return true; },
  });
}


export function registerTerrainReplace(name, beforeSnap, afterSnap) {
  const data = terrainStore.getData();
  commands.execute({
    name: name || "Terrain",
    do() { data.importAll(afterSnap); terrainStore.notifyChanged(); return true; },
    undo() { data.importAll(beforeSnap); terrainStore.notifyChanged(); return true; },
  });
}

export function clearTerrain() {
  const data = terrainStore.getData();
  if (data.isEmpty()) return false;
  const before = data.exportAll();
  registerTerrainReplace("Clear Terrain", before, { chunks: [], min: null, max: null });
  return true;
}
