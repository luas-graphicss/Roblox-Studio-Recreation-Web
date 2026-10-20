import {
  sanitizeVec,
  sanitizeNum,
  eulerDegToQuat,
  quatConjugate,
  rotateVecByQuat,
  vecLength,
  clampMagnitude,
} from "./mathUtils.js";
import { groupOfPart, areCollidable, DEFAULT_GROUP } from "./collisionGroups.js";
import { raycastMeshCollision } from "./collisionGeometry.js";
import { meshRegistry } from "../assets/meshRegistry.js";
import { terrainStore } from "../terrain/terrainStore.js";
import { VOXEL_SIZE, isWaterMaterial, materialName } from "../terrain/materials.js";


import {
  createTerrainSampler,
  syncTerrainSampler,
  densityAt,
  surfaceNormalAt,
} from "../terrain/terrainCollision.js";


import { queryRayCandidates, queryBoxCandidates } from "./sceneQueryIndex.js";

export const MAX_RAY_DISTANCE = 10000;
const MAX_FILTER = 1000;
const EPS = 1e-9;


const rayCandidateBuffer = [];
const overlapCandidateBuffer = [];

function isPhysicalPart(inst) {
  return (
    inst &&
    inst.__isInstance === true &&
    typeof inst.hasProperty === "function" &&
    inst.hasProperty("Size") &&
    inst.hasProperty("Position") &&
    inst.hasProperty("Rotation") &&
    inst.hasProperty("CanCollide")
  );
}

function isDescendantOfAny(inst, list) {
  let p = inst;
  let guard = 0;
  while (p && guard < 10000) {
    if (list.has(p)) return true;
    p = typeof p.getParent === "function" ? p.getParent() : null;
    guard += 1;
  }
  return false;
}


function rayConvex(o, dir, planes, tMax) {
  let tEnter = 0;
  let tExit = tMax;
  let enterNormal = null;
  for (const pl of planes) {
    const n = pl.n;
    const denom = n.x * dir.x + n.y * dir.y + n.z * dir.z;
    const dist = n.x * o.x + n.y * o.y + n.z * o.z - pl.d;
    if (Math.abs(denom) < EPS) {
      if (dist > 0) return null;                   
      continue;
    }
    const t = -dist / denom;
    if (denom < 0) {

      if (t > tEnter) {
        tEnter = t;
        enterNormal = n;
      }
    } else if (t < tExit) {
      tExit = t;          
    }
    if (tEnter > tExit) return null;
  }
  if (tEnter <= EPS || !enterNormal) return null;                                        
  return { t: tEnter, normal: { ...enterNormal } };
}

function boxPlanes(hx, hy, hz) {
  return [
    { n: { x: 1, y: 0, z: 0 }, d: hx },
    { n: { x: -1, y: 0, z: 0 }, d: hx },
    { n: { x: 0, y: 1, z: 0 }, d: hy },
    { n: { x: 0, y: -1, z: 0 }, d: hy },
    { n: { x: 0, y: 0, z: 1 }, d: hz },
    { n: { x: 0, y: 0, z: -1 }, d: hz },
  ];
}


function wedgePlanes(hx, hy, hz) {
  const planes = boxPlanes(hx, hy, hz);
  const len = Math.hypot(hz, hy) || 1;
  planes.push({ n: { x: 0, y: hz / len, z: hy / len }, d: 0 });
  return planes;
}


function raySphere(o, dir, radius, tMax) {
  const b = o.x * dir.x + o.y * dir.y + o.z * dir.z;
  const c = o.x * o.x + o.y * o.y + o.z * o.z - radius * radius;
  if (c <= 0) return null;                 
  const a = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < EPS || t > tMax) return null;
  const p = { x: o.x + dir.x * t, y: o.y + dir.y * t, z: o.z + dir.z * t };
  const m = vecLength(p) || 1;
  return { t, normal: { x: p.x / m, y: p.y / m, z: p.z / m } };
}


function rayCylinderX(o, dir, r, hx, tMax) {


  if (o.y * o.y + o.z * o.z <= r * r && Math.abs(o.x) <= hx) return null;
  let best = null;

  const a = dir.y * dir.y + dir.z * dir.z;
  if (a > EPS) {
    const b = o.y * dir.y + o.z * dir.z;
    const c = o.y * o.y + o.z * o.z - r * r;
    const disc = b * b - a * c;
    if (disc >= 0 && c > 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      if (t > EPS && t <= tMax) {
        const x = o.x + dir.x * t;
        if (Math.abs(x) <= hx) {
          const y = o.y + dir.y * t;
          const z = o.z + dir.z * t;
          const m = Math.hypot(y, z) || 1;
          best = { t, normal: { x: 0, y: y / m, z: z / m } };
        }
      }
    }
  }

  if (Math.abs(dir.x) > EPS) {
    for (const sign of [1, -1]) {
      const t = (sign * hx - o.x) / dir.x;
      if (t > EPS && t <= tMax && (!best || t < best.t)) {
        const y = o.y + dir.y * t;
        const z = o.z + dir.z * t;
        if (y * y + z * z <= r * r) {
          best = { t, normal: { x: sign, y: 0, z: 0 } };
        }
      }
    }
  }
  return best;
}

function intersectPart(part, origin, dir, tMax) {
  if (part.className === "UnionOperation") {
    const u = unionIntersect(part, origin, dir, tMax);
    if (u !== undefined) return u;
  }
  const pos = sanitizeVec(part.getProperty("Position"));
  const rot = sanitizeVec(part.getProperty("Rotation"));
  const size = sanitizeVec(part.getProperty("Size"), { x: 1, y: 1, z: 1 });
  const hx = Math.max(0.025, Math.abs(size.x) / 2);
  const hy = Math.max(0.025, Math.abs(size.y) / 2);
  const hz = Math.max(0.025, Math.abs(size.z) / 2);
  const q = eulerDegToQuat(rot.x, rot.y, rot.z);
  const qInv = quatConjugate(q);

  const oL = rotateVecByQuat({ x: origin.x - pos.x, y: origin.y - pos.y, z: origin.z - pos.z }, qInv);
  const dL = rotateVecByQuat(dir, qInv);

  const shape = part.hasProperty("Shape") ? part.getProperty("Shape") : "Block";
  let hit = null;
  let handled = false;


  if (part.className === "MeshPart") {
    const meshId = part.hasProperty("MeshId") ? String(part.getProperty("MeshId") || "") : "";
    const info = meshId ? meshRegistry.get(meshId) : null;
    const fidelity = part.hasProperty("CollisionFidelity")
      ? part.getProperty("CollisionFidelity")
      : "Default";
    if (info && fidelity !== "Box") {
      const m = raycastMeshCollision(info.collision, fidelity, hx * 2, hy * 2, hz * 2, oL, dL, tMax);
      if (m !== undefined) {
        hit = m;
        handled = true;
      } else if (info.extents) {


        const ex = info.extents;
        const tighten = fidelity === "Hull" ? 0.92 : 1.0;
        hit = rayConvex(oL, dL, boxPlanes(
          Math.max(0.025, hx * Math.min(1, Math.abs(ex.x)) * tighten),
          Math.max(0.025, hy * Math.min(1, Math.abs(ex.y)) * tighten),
          Math.max(0.025, hz * Math.min(1, Math.abs(ex.z)) * tighten),
        ), tMax);
        handled = true;
      }
    }
  }
  if (!handled) {
    if (shape === "Ball") {
      hit = raySphere(oL, dL, Math.min(hx, hy, hz), tMax);
    } else if (shape === "Cylinder") {
      hit = rayCylinderX(oL, dL, Math.min(hy, hz), hx, tMax);
    } else if (shape === "Wedge") {
      hit = rayConvex(oL, dL, wedgePlanes(hx, hy, hz), tMax);
    } else {
      hit = rayConvex(oL, dL, boxPlanes(hx, hy, hz), tMax);
    }
  }
  if (!hit) return null;

  const nW = rotateVecByQuat(hit.normal, q);
  return { t: hit.t, normal: nW };
}


export function raycastWorkspace(workspaceInst, origin, direction, params) {
  if (!workspaceInst) return null;
  params = params || {};
  const o = sanitizeVec(origin);
  const d = sanitizeVec(direction);
  const mag = vecLength(d);
  if (!(mag > 0)) return null;
  const tMax = Math.min(mag, MAX_RAY_DISTANCE);
  const dir = { x: d.x / mag, y: d.y / mag, z: d.z / mag };

  const filterType = params.filterType === "Include" ? "Include" : "Exclude";
  const rawList = Array.isArray(params.filterList) ? params.filterList.slice(0, MAX_FILTER) : [];
  const filterSet = new Set(rawList.filter((i) => i && i.__isInstance === true));


  if (filterType === "Include" && filterSet.size === 0) return null;
  const group = typeof params.collisionGroup === "string" && params.collisionGroup
    ? params.collisionGroup
    : DEFAULT_GROUP;

  const respectCanCollide = params.respectCanCollide === true;
  const ignoreWater = params.ignoreWater === true;

  let best = null;



  const indexedCandidateCount = queryRayCandidates(workspaceInst, o, dir, tMax, rayCandidateBuffer);
  const rayCandidates = indexedCandidateCount === null
    ? workspaceInst.getDescendants()
    : rayCandidateBuffer;
  const rayCandidateCount = indexedCandidateCount === null
    ? rayCandidates.length
    : indexedCandidateCount;
  for (let candidateIndex = 0; candidateIndex < rayCandidateCount; candidateIndex += 1) {
    const inst = rayCandidates[candidateIndex];
    if (!isPhysicalPart(inst)) continue;
    if (typeof inst.isDestroyed === "function" && inst.isDestroyed()) continue;
    if (!queryEligible(inst, respectCanCollide)) continue;
    if (typeof params.skipInstance === "function" && params.skipInstance(inst)) continue;
    if (filterSet.size) {
      const inFilter = isDescendantOfAny(inst, filterSet);
      if (filterType === "Include" ? !inFilter : inFilter) continue;
    }
    if (!areCollidable(group, groupOfPart(inst))) continue;
    const hit = intersectPart(inst, o, dir, best ? best.t : tMax);
    if (hit && (!best || hit.t < best.t)) {
      best = { t: hit.t, normal: hit.normal, inst };
    }
  }

  const terr = raycastTerrain(o, dir, best ? best.t : tMax, ignoreWater);
  if (terr) {
    const ti = terrainInstance();
    let allowTerrain = true;
    if (ti && filterSet.size) {
      const inFilter = isDescendantOfAny(ti, filterSet);
      allowTerrain = filterType === "Include" ? inFilter : !inFilter;
    }
    if (allowTerrain && (!best || terr.t < best.t)) {
      const dt = sanitizeNum(terr.t, 0);
      return {
        instance: ti || null,
        position: { x: o.x + dir.x * dt, y: o.y + dir.y * dt, z: o.z + dir.z * dt },
        normal: terr.normal,
        material: terr.material,
        distance: dt,
      };
    }
  }

  if (!best) return null;
  const dist = sanitizeNum(best.t, 0);
  return {
    instance: best.inst,
    position: { x: o.x + dir.x * dist, y: o.y + dir.y * dist, z: o.z + dir.z * dist },
    normal: best.normal,
    material: best.inst.hasProperty("Material") ? best.inst.getProperty("Material") : "Plastic",
    distance: dist,
  };
}


const MAX_CAST_STEPS = 512;
const MAX_SHAPE_EXTENT = 2048;

function queryEligible(inst, respectCanCollide) {
  if (respectCanCollide) {
    if (inst.hasProperty("CanCollide") && inst.getProperty("CanCollide") === false) return false;
    return true;
  }
  if (inst.hasProperty("CanQuery") && inst.getProperty("CanQuery") === false) return false;
  return true;
}

function clampTol(v) {
  return Math.max(-10, Math.min(10, sanitizeNum(v, 0)));
}

function clampMaxParts(v) {
  const m = Math.floor(sanitizeNum(v, 0));
  return m > 0 ? Math.min(m, 100000) : 0;
}

function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }


function unionWorldTrisCached(part) {
  const mesh = part._csgMesh;
  if (!mesh || !Array.isArray(mesh.positions) || mesh.positions.length < 9) return null;
  const pos = sanitizeVec(part.getProperty("Position"));
  const rot = sanitizeVec(part.getProperty("Rotation"));
  const size = sanitizeVec(part.getProperty("Size"), { x: 1, y: 1, z: 1 });
  const key = `${pos.x},${pos.y},${pos.z}|${rot.x},${rot.y},${rot.z}|${size.x},${size.y},${size.z}|${mesh.positions.length}`;


  if (part._csgTrisCache && part._csgTrisCache.key === key && part._csgTrisCache.mesh === mesh) {
    return part._csgTrisCache.tris;
  }
  const base = mesh.baseSize && mesh.baseSize.x ? mesh.baseSize : size;
  const sx = base.x ? size.x / base.x : 1;
  const sy = base.y ? size.y / base.y : 1;
  const sz = base.z ? size.z / base.z : 1;
  const q = eulerDegToQuat(rot.x, rot.y, rot.z);
  const arr = mesh.positions;
  const tris = [];
  for (let i = 0; i + 8 < arr.length; i += 9) {
    const v = [];
    for (let k = 0; k < 3; k++) {
      const lx = arr[i + k * 3] * sx;
      const ly = arr[i + k * 3 + 1] * sy;
      const lz = arr[i + k * 3 + 2] * sz;
      const w = rotateVecByQuat({ x: lx, y: ly, z: lz }, q);
      v.push({ x: w.x + pos.x, y: w.y + pos.y, z: w.z + pos.z });
    }
    tris.push(v);
  }
  part._csgTrisCache = { key, mesh, tris };
  return tris;
}

function rayTriangle(o, dir, a, b, c, tMax) {
  const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
  const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
  const px = dir.y * e2z - dir.z * e2y;
  const py = dir.z * e2x - dir.x * e2z;
  const pz = dir.x * e2y - dir.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < EPS) return null;
  const inv = 1 / det;
  const tx = o.x - a.x, ty = o.y - a.y, tz = o.z - a.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dir.x * qx + dir.y * qy + dir.z * qz) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (t < 1e-6 || t > tMax) return null;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  if (nx * dir.x + ny * dir.y + nz * dir.z > 0) { nx = -nx; ny = -ny; nz = -nz; }
  return { t, normal: { x: nx, y: ny, z: nz } };
}

function unionIntersect(part, origin, dir, tMax) {
  const fidelity = part.hasProperty("CollisionFidelity") ? part.getProperty("CollisionFidelity") : "Default";
  if (fidelity === "Box" || fidelity === "Hull") return undefined;
  const tris = unionWorldTrisCached(part);
  if (!tris || !tris.length) return undefined;
  let best = null;
  for (const tri of tris) {
    const h = rayTriangle(origin, dir, tri[0], tri[1], tri[2], best ? best.t : tMax);
    if (h && (!best || h.t < best.t)) best = h;
  }
  return best || null;
}


export function unionSurfaceTopAt(part, x, z) {
  if (!part || part.className !== "UnionOperation") return null;
  const fidelity = part.hasProperty("CollisionFidelity") ? part.getProperty("CollisionFidelity") : "Default";
  if (fidelity === "Box" || fidelity === "Hull") return null;
  const tris = unionWorldTrisCached(part);
  if (!tris || !tris.length) return null;
  let maxY = -Infinity, minY = Infinity;
  for (const tri of tris) {
    for (let k = 0; k < 3; k++) {
      const vy = tri[k].y;
      if (vy > maxY) maxY = vy;
      if (vy < minY) minY = vy;
    }
  }
  if (!Number.isFinite(maxY) || !Number.isFinite(minY)) return null;
  const startY = maxY + 1;
  const origin = { x, y: startY, z };
  const dir = { x: 0, y: -1, z: 0 };
  const span = startY - minY + 2;
  let best = null;
  for (const tri of tris) {
    const h = rayTriangle(origin, dir, tri[0], tri[1], tri[2], best ? best.t : span);
    if (h && (!best || h.t < best.t)) best = h;
  }
  if (!best) return null;
  return startY - best.t;
}

export function unionHasCollisionMesh(part) {
  if (!part || part.className !== "UnionOperation") return false;
  const fidelity = part.hasProperty("CollisionFidelity") ? part.getProperty("CollisionFidelity") : "Default";
  if (fidelity === "Box" || fidelity === "Hull") return false;
  const tris = unionWorldTrisCached(part);
  return !!(tris && tris.length);
}


function activeTerrain() {
  try {
    const td = terrainStore.getData();
    return td && !td.isEmpty() ? td : null;
  } catch (_) { return null; }
}

function terrainInstance() {
  try { return terrainStore.getTerrainInstance(); } catch (_) { return null; }
}

function raycastTerrain(o, dir, tMax, ignoreWater) {
  const td = activeTerrain();
  if (!td) return null;
  const V = VOXEL_SIZE;
  let vx = Math.floor(o.x / V), vy = Math.floor(o.y / V), vz = Math.floor(o.z / V);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  let tMaxX = dir.x !== 0 ? (((dir.x > 0 ? (vx + 1) * V : vx * V) - o.x) / dir.x) : Infinity;
  let tMaxY = dir.y !== 0 ? (((dir.y > 0 ? (vy + 1) * V : vy * V) - o.y) / dir.y) : Infinity;
  let tMaxZ = dir.z !== 0 ? (((dir.z > 0 ? (vz + 1) * V : vz * V) - o.z) / dir.z) : Infinity;
  const tDeltaX = dir.x !== 0 ? Math.abs(V / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(V / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(V / dir.z) : Infinity;
  let t = 0;
  let face = { x: 0, y: 1, z: 0 };


  for (let i = 0; i < 5120 && t <= tMax; i++) {
    if (td.getOcc(vx, vy, vz) >= 0.5) {
      const mat = td.getMat(vx, vy, vz);
      if (!(ignoreWater && isWaterMaterial(mat))) {


        if (isWaterMaterial(mat)) {
          return { t, normal: face, material: materialName(mat) };
        }
        const fine = refineTerrainHit(td, o, dir, t, tMax);
        if (fine) return { t: fine.t, normal: fine.normal, material: materialName(mat) };
        return { t, normal: face, material: materialName(mat) };
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { vx += stepX; t = tMaxX; tMaxX += tDeltaX; face = { x: -stepX, y: 0, z: 0 }; }
    else if (tMaxY < tMaxZ) { vy += stepY; t = tMaxY; tMaxY += tDeltaY; face = { x: 0, y: -stepY, z: 0 }; }
    else { vz += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = { x: 0, y: 0, z: -stepZ }; }
  }
  return null;
}


const rcSampler = createTerrainSampler();
const RC_STEPS = 16;
function refineTerrainHit(td, o, dir, tHit, tMax) {
  syncTerrainSampler(rcSampler, td);
  const t0 = Math.max(0, tHit - VOXEL_SIZE);
  const t1 = Math.min(tMax, tHit + VOXEL_SIZE);
  if (!(t1 > t0)) return null;
  const dt = (t1 - t0) / RC_STEPS;
  const densAtT = (t) => densityAt(rcSampler, td, o.x + dir.x * t, o.y + dir.y * t, o.z + dir.z * t);
  let ta = t0;
  if (densAtT(ta) >= 0.5) return null;                                              
  for (let i = 1; i <= RC_STEPS; i++) {
    const tb = t0 + i * dt;
    if (densAtT(tb) >= 0.5) {
      let lo = ta;
      let hi = tb;                      
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (densAtT(mid) >= 0.5) hi = mid;
        else lo = mid;
      }
      const ts = (lo + hi) / 2;
      const n = surfaceNormalAt(rcSampler, td, o.x + dir.x * ts, o.y + dir.y * ts, o.z + dir.z * ts);
      return { t: ts, normal: n ? { x: n.x, y: n.y, z: n.z } : { x: 0, y: 1, z: 0 } };
    }
    ta = tb;
  }
  return null;
}

function terrainSolidPoint(cx, cy, cz, ignoreWater) {
  const td = activeTerrain();
  if (!td) return false;
  const V = VOXEL_SIZE;
  const vx = Math.floor(cx / V), vy = Math.floor(cy / V), vz = Math.floor(cz / V);
  if (td.getOcc(vx, vy, vz) < 0.5) return false;
  return !(ignoreWater && isWaterMaterial(td.getMat(vx, vy, vz)));
}

function terrainMatAt(cx, cy, cz) {
  const td = activeTerrain();
  if (!td) return "Grass";
  const V = VOXEL_SIZE;
  return materialName(td.getMat(Math.floor(cx / V), Math.floor(cy / V), Math.floor(cz / V)));
}


function partToObb(part) {
  const pos = sanitizeVec(part.getProperty("Position"));
  const rot = sanitizeVec(part.getProperty("Rotation"));
  const size = sanitizeVec(part.getProperty("Size"), { x: 1, y: 1, z: 1 });
  const q = eulerDegToQuat(rot.x, rot.y, rot.z);
  return {
    c: pos,
    half: {
      x: Math.max(0.025, Math.abs(size.x) / 2),
      y: Math.max(0.025, Math.abs(size.y) / 2),
      z: Math.max(0.025, Math.abs(size.z) / 2),
    },
    axes: [
      rotateVecByQuat({ x: 1, y: 0, z: 0 }, q),
      rotateVecByQuat({ x: 0, y: 1, z: 0 }, q),
      rotateVecByQuat({ x: 0, y: 0, z: 1 }, q),
    ],
    shape: part.hasProperty("Shape") ? part.getProperty("Shape") : "Block",
  };
}

function obbAabb(obb) {
  const ex = Math.abs(obb.axes[0].x) * obb.half.x + Math.abs(obb.axes[1].x) * obb.half.y + Math.abs(obb.axes[2].x) * obb.half.z;
  const ey = Math.abs(obb.axes[0].y) * obb.half.x + Math.abs(obb.axes[1].y) * obb.half.y + Math.abs(obb.axes[2].y) * obb.half.z;
  const ez = Math.abs(obb.axes[0].z) * obb.half.x + Math.abs(obb.axes[1].z) * obb.half.y + Math.abs(obb.axes[2].z) * obb.half.z;
  return {
    minX: obb.c.x - ex, maxX: obb.c.x + ex,
    minY: obb.c.y - ey, maxY: obb.c.y + ey,
    minZ: obb.c.z - ez, maxZ: obb.c.z + ez,
  };
}

function aabbOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX &&
    a.minY <= b.maxY && a.maxY >= b.minY &&
    a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

function sphereObbOverlap(center, r, obb) {
  const dx = center.x - obb.c.x, dy = center.y - obb.c.y, dz = center.z - obb.c.z;
  let d2 = 0;
  for (let i = 0; i < 3; i++) {
    const ax = obb.axes[i];
    const dist = dx * ax.x + dy * ax.y + dz * ax.z;
    const h = i === 0 ? obb.half.x : i === 1 ? obb.half.y : obb.half.z;
    if (dist > h) { const e = dist - h; d2 += e * e; }
    else if (dist < -h) { const e = dist + h; d2 += e * e; }
  }
  return d2 <= r * r;
}

function obbObbOverlap(a, b, tol) {
  const t = tol || 0;
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const AbsR = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const E = 1e-6;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    R[i][j] = dot3(a.axes[i], b.axes[j]);
    AbsR[i][j] = Math.abs(R[i][j]) + E;
  }
  const tt = { x: b.c.x - a.c.x, y: b.c.y - a.c.y, z: b.c.z - a.c.z };
  const tv = [dot3(tt, a.axes[0]), dot3(tt, a.axes[1]), dot3(tt, a.axes[2])];
  const ae = [a.half.x + t, a.half.y + t, a.half.z + t];
  const be = [b.half.x + t, b.half.y + t, b.half.z + t];
  for (let i = 0; i < 3; i++) {
    const ra = ae[i];
    const rb = be[0] * AbsR[i][0] + be[1] * AbsR[i][1] + be[2] * AbsR[i][2];
    if (Math.abs(tv[i]) > ra + rb) return false;
  }
  for (let j = 0; j < 3; j++) {
    const ra = ae[0] * AbsR[0][j] + ae[1] * AbsR[1][j] + ae[2] * AbsR[2][j];
    const rb = be[j];
    const tj = tv[0] * R[0][j] + tv[1] * R[1][j] + tv[2] * R[2][j];
    if (Math.abs(tj) > ra + rb) return false;
  }
  let ra, rb;
  ra = ae[1] * AbsR[2][0] + ae[2] * AbsR[1][0]; rb = be[1] * AbsR[0][2] + be[2] * AbsR[0][1]; if (Math.abs(tv[2] * R[1][0] - tv[1] * R[2][0]) > ra + rb) return false;
  ra = ae[1] * AbsR[2][1] + ae[2] * AbsR[1][1]; rb = be[0] * AbsR[0][2] + be[2] * AbsR[0][0]; if (Math.abs(tv[2] * R[1][1] - tv[1] * R[2][1]) > ra + rb) return false;
  ra = ae[1] * AbsR[2][2] + ae[2] * AbsR[1][2]; rb = be[0] * AbsR[0][1] + be[1] * AbsR[0][0]; if (Math.abs(tv[2] * R[1][2] - tv[1] * R[2][2]) > ra + rb) return false;
  ra = ae[0] * AbsR[2][0] + ae[2] * AbsR[0][0]; rb = be[1] * AbsR[1][2] + be[2] * AbsR[1][1]; if (Math.abs(tv[0] * R[2][0] - tv[2] * R[0][0]) > ra + rb) return false;
  ra = ae[0] * AbsR[2][1] + ae[2] * AbsR[0][1]; rb = be[0] * AbsR[1][2] + be[2] * AbsR[1][0]; if (Math.abs(tv[0] * R[2][1] - tv[2] * R[0][1]) > ra + rb) return false;
  ra = ae[0] * AbsR[2][2] + ae[2] * AbsR[0][2]; rb = be[0] * AbsR[1][1] + be[1] * AbsR[1][0]; if (Math.abs(tv[0] * R[2][2] - tv[2] * R[0][2]) > ra + rb) return false;
  ra = ae[0] * AbsR[1][0] + ae[1] * AbsR[0][0]; rb = be[1] * AbsR[2][2] + be[2] * AbsR[2][1]; if (Math.abs(tv[1] * R[0][0] - tv[0] * R[1][0]) > ra + rb) return false;
  ra = ae[0] * AbsR[1][1] + ae[1] * AbsR[0][1]; rb = be[0] * AbsR[2][2] + be[2] * AbsR[2][0]; if (Math.abs(tv[1] * R[0][1] - tv[0] * R[1][1]) > ra + rb) return false;
  ra = ae[0] * AbsR[1][2] + ae[1] * AbsR[0][2]; rb = be[0] * AbsR[2][1] + be[1] * AbsR[2][0]; if (Math.abs(tv[1] * R[0][2] - tv[0] * R[1][2]) > ra + rb) return false;
  return true;
}


function gatherCandidates(ws, params, queryBounds) {
  const opt = params || {};
  const filterSet = Array.isArray(opt.filterList) && opt.filterList.length
    ? new Set(opt.filterList.slice(0, MAX_FILTER).filter((i) => i && i.__isInstance)) : null;
  const includeSet = Array.isArray(opt.includeList)
    ? new Set(opt.includeList.slice(0, MAX_FILTER).filter((i) => i && i.__isInstance)) : null;
  const excludeSet = Array.isArray(opt.excludeList) && opt.excludeList.length
    ? new Set(opt.excludeList.slice(0, MAX_FILTER).filter((i) => i && i.__isInstance)) : null;
  const group = typeof opt.collisionGroup === "string" && opt.collisionGroup ? opt.collisionGroup : DEFAULT_GROUP;
  const respect = opt.respectCanCollide === true;
  const ft = opt.filterType === "Include" ? "Include" : "Exclude";
  const out = [];


  if (ft === "Include" && (!filterSet || filterSet.size === 0)) return out;
  if (!ws) return out;
  const indexedCandidateCount = queryBounds
    ? queryBoxCandidates(ws, queryBounds, overlapCandidateBuffer)
    : null;
  const overlapCandidates = indexedCandidateCount === null
    ? ws.getDescendants()
    : overlapCandidateBuffer;
  const overlapCandidateCount = indexedCandidateCount === null
    ? overlapCandidates.length
    : indexedCandidateCount;
  for (let candidateIndex = 0; candidateIndex < overlapCandidateCount; candidateIndex += 1) {
    const inst = overlapCandidates[candidateIndex];
    if (!isPhysicalPart(inst)) continue;
    if (typeof inst.isDestroyed === "function" && inst.isDestroyed()) continue;
    if (!queryEligible(inst, respect)) continue;
    if (typeof opt.skipInstance === "function" && opt.skipInstance(inst)) continue;
    if (!areCollidable(group, groupOfPart(inst))) continue;
    if (excludeSet && isDescendantOfAny(inst, excludeSet)) continue;
    if (includeSet) {
      if (!includeSet.size) continue;
      if (!isDescendantOfAny(inst, includeSet)) continue;
    }
    if (filterSet) {
      const inF = isDescendantOfAny(inst, filterSet);
      if (ft === "Include" ? !inF : inF) continue;
    }
    const obb = partToObb(inst);
    out.push({ inst, obb, aabb: obbAabb(obb) });
  }
  return out;
}

function partMaterial(inst) {
  return inst.hasProperty("Material") ? inst.getProperty("Material") : "Plastic";
}


export function getPartBoundsInBox(ws, cframe, size, params) {
  const c = sanitizeVec(cframe);
  const sz = sanitizeVec(size, { x: 1, y: 1, z: 1 });
  const tol = clampTol(params && params.tolerance);
  const hx = Math.abs(sz.x) / 2 + tol, hy = Math.abs(sz.y) / 2 + tol, hz = Math.abs(sz.z) / 2 + tol;
  const box = { minX: c.x - hx, maxX: c.x + hx, minY: c.y - hy, maxY: c.y + hy, minZ: c.z - hz, maxZ: c.z + hz };
  const max = clampMaxParts(params && params.maxParts);
  const out = [];
  for (const cd of gatherCandidates(ws, params, box)) {
    if (aabbOverlap(box, cd.aabb)) { out.push(cd.inst); if (max && out.length >= max) break; }
  }
  return out;
}

export function getPartBoundsInRadius(ws, position, radius, params) {
  const c = sanitizeVec(position);
  const r = Math.max(0, Math.min(MAX_RAY_DISTANCE, sanitizeNum(radius, 0))) + clampTol(params && params.tolerance);
  const box = { minX: c.x - r, maxX: c.x + r, minY: c.y - r, maxY: c.y + r, minZ: c.z - r, maxZ: c.z + r };
  const max = clampMaxParts(params && params.maxParts);
  const out = [];
  for (const cd of gatherCandidates(ws, params, box)) {
    if (!aabbOverlap(box, cd.aabb)) continue;
    const dx = Math.max(cd.aabb.minX - c.x, 0, c.x - cd.aabb.maxX);
    const dy = Math.max(cd.aabb.minY - c.y, 0, c.y - cd.aabb.maxY);
    const dz = Math.max(cd.aabb.minZ - c.z, 0, c.z - cd.aabb.maxZ);
    if (dx * dx + dy * dy + dz * dz <= r * r) { out.push(cd.inst); if (max && out.length >= max) break; }
  }
  return out;
}

export function getPartsInPart(ws, testPart, params) {
  if (!testPart || !isPhysicalPart(testPart)) return [];
  const testObb = partToObb(testPart);
  const testAabb = obbAabb(testObb);
  const tol = clampTol(params && params.tolerance);
  const max = clampMaxParts(params && params.maxParts);
  const out = [];
  for (const cd of gatherCandidates(ws, params)) {
    if (cd.inst === testPart) continue;
    if (!aabbOverlap(testAabb, cd.aabb)) continue;
    let hit;
    if (testObb.shape === "Ball") hit = sphereObbOverlap(testObb.c, Math.min(testObb.half.x, testObb.half.y, testObb.half.z) + tol, cd.obb);
    else if (cd.obb.shape === "Ball") hit = sphereObbOverlap(cd.obb.c, Math.min(cd.obb.half.x, cd.obb.half.y, cd.obb.half.z) + tol, testObb);
    else hit = obbObbOverlap(testObb, cd.obb, tol);
    if (hit) { out.push(cd.inst); if (max && out.length >= max) break; }
  }
  return out;
}


function shapecastGeneric(ws, kind, startCenter, shape, direction, params) {
  const o = sanitizeVec(startCenter);
  const d = clampMagnitude(sanitizeVec(direction), MAX_RAY_DISTANCE);
  const mag = vecLength(d);
  if (!(mag > 0)) return null;
  const dir = { x: d.x / mag, y: d.y / mag, z: d.z / mag };
  const ignoreWater = !!(params && params.ignoreWater === true);
  const cands = gatherCandidates(ws, params);
  const radius = kind === "sphere" ? Math.max(0.05, Math.min(MAX_SHAPE_EXTENT, shape.r)) : 0;
  const half = kind !== "sphere" ? shape.half : null;
  const axes = kind !== "sphere" ? (shape.axes || [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]) : null;
  const overlapAt = (cx, cy, cz, obb) => kind === "sphere"
    ? sphereObbOverlap({ x: cx, y: cy, z: cz }, radius, obb)
    : obbObbOverlap({ c: { x: cx, y: cy, z: cz }, half, axes }, obb, 0);
  const minHalf = kind === "sphere" ? radius : Math.min(half.x, half.y, half.z);
  const stepLen = Math.max(0.25, minHalf * 0.5);
  const steps = Math.min(MAX_CAST_STEPS, Math.ceil(mag / stepLen) + 1);
  const startSet = new Set();
  for (const c of cands) if (overlapAt(o.x, o.y, o.z, c.obb)) startSet.add(c.inst);
  let terrStart = terrainSolidPoint(o.x, o.y, o.z, ignoreWater);
  for (let s = 1; s <= steps; s++) {
    const t = Math.min(mag, s * stepLen);
    const cx = o.x + dir.x * t, cy = o.y + dir.y * t, cz = o.z + dir.z * t;
    for (const c of cands) {
      if (startSet.has(c.inst)) { if (!overlapAt(cx, cy, cz, c.obb)) startSet.delete(c.inst); continue; }
      if (overlapAt(cx, cy, cz, c.obb)) {
        let nx = cx - c.obb.c.x, ny = cy - c.obb.c.y, nz = cz - c.obb.c.z;
        const nl = Math.hypot(nx, ny, nz) || 1;
        return { instance: c.inst, position: { x: cx, y: cy, z: cz }, normal: { x: nx / nl, y: ny / nl, z: nz / nl }, material: partMaterial(c.inst), distance: t };
      }
    }
    const ts = terrainSolidPoint(cx, cy, cz, ignoreWater);
    if (ts) {
      if (!terrStart) {
        return { instance: terrainInstance() || null, position: { x: cx, y: cy, z: cz }, normal: { x: -dir.x, y: -dir.y, z: -dir.z }, material: terrainMatAt(cx, cy, cz), distance: t };
      }
    } else terrStart = false;
    if (t >= mag) break;
  }
  return null;
}

export function blockcast(ws, cframe, size, direction, params) {
  const sz = sanitizeVec(size, { x: 1, y: 1, z: 1 });
  const half = {
    x: Math.max(0.05, Math.min(MAX_SHAPE_EXTENT, Math.abs(sz.x) / 2)),
    y: Math.max(0.05, Math.min(MAX_SHAPE_EXTENT, Math.abs(sz.y) / 2)),
    z: Math.max(0.05, Math.min(MAX_SHAPE_EXTENT, Math.abs(sz.z) / 2)),
  };
  return shapecastGeneric(ws, "box", cframe, { half, axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }] }, direction, params);
}

export function spherecast(ws, position, radius, direction, params) {
  return shapecastGeneric(ws, "sphere", position, { r: sanitizeNum(radius, 1) }, direction, params);
}


export function meshPartHasLooseCollision(inst) {
  if (!inst || inst.className !== "MeshPart") return false;
  const fid = inst.hasProperty && inst.hasProperty("CollisionFidelity")
    ? inst.getProperty("CollisionFidelity")
    : "Default";
  if (fid === "Box") return false;                                        
  const meshId = inst.hasProperty && inst.hasProperty("MeshId")
    ? String(inst.getProperty("MeshId") || "")
    : "";
  const info = meshId ? meshRegistry.get(meshId) : null;
  return !(info && info.collision);
}

export function shapecast(ws, part, direction, params) {
  if (!part || !isPhysicalPart(part)) return null;
  const obb = partToObb(part);
  if (obb.shape === "Ball") return shapecastGeneric(ws, "sphere", obb.c, { r: Math.min(obb.half.x, obb.half.y, obb.half.z) }, direction, params);
  return shapecastGeneric(ws, "box", obb.c, { half: obb.half, axes: obb.axes }, direction, params);
}
