import { bus } from "../core/eventBus.js";

import { buildTerrainBodies } from "./terrainPhysics.js";
import { buildWaterField, applyBuoyancy } from "./waterPhysics.js";             


import { waveStateFromTerrain } from "../terrain/waterWaves.js";                               
import { waveClock } from "../terrain/waveClock.js";
import { TerrainEvents, terrainStore } from "../terrain/terrainStore.js";
import { Events, makeVector3 } from "../datamodel/index.js";
import { getCachedWind } from "../climate/climateRuntime.js";            
import {
  sanitizeVec,
  sanitizeNum,
  eulerDegToQuat,
  quatToEulerDeg,
  quatMultiply,
  quatConjugate,
  rotateVecByQuat,
  vecLength,
} from "./mathUtils.js";
import { getPhysicalProperties, getPartMass, getPartVolume } from "./materials.js";


let SOLID_LIMITS = { maxHulls: 512 };
import("../interop/rbxSolidMesh.js")
  .then((m) => {
    if (m && m.SOLID_LIMITS && Number.isFinite(m.SOLID_LIMITS.maxHulls)) {
      SOLID_LIMITS = m.SOLID_LIMITS;
    }
  })
  .catch(() => {

  });
import { meshRegistry } from "../assets/meshRegistry.js";                                 
import { computeConvexHull } from "./collisionGeometry.js";                        
import { groupOfPart, groupBit, groupMask, CollisionGroupEvents } from "./collisionGroups.js";
import { createConstraintController } from "./physicsConstraints.js";

export const PhysicsEvents = Object.freeze({
  Touched: "physics:touched",
  TouchEnded: "physics:touchEnded",
});

const FIXED_DT = 1 / 60;                          
const MAX_SUBSTEPS = 3;
const MAX_BODIES = 1500;                                            
const MAX_CONSTRAINTS = 10000;
const MAX_LINEAR_VEL = 4000;                                      
const MAX_ANGULAR_VEL = 500;         
const MAX_IMPULSE = 1e9;                                       
const TOUCH_THROTTLE_MS = 100;                    
const KILL_Y = -500;                                        
const GRAVITY_MAX = 100000;


const REBUILD_CLASSES = new Set([
  "Weld", "WeldConstraint", "Snap",
  "HingeConstraint", "RopeConstraint", "SpringConstraint",
  "PrismaticConstraint", "BallSocketConstraint", "Attachment",
  "BodyVelocity", "BodyAngularVelocity", "BodyForce", "BodyThrust",
  "BodyPosition", "BodyGyro", "LinearVelocity", "AngularVelocity",
  "VectorForce", "Torque", "AlignPosition", "AlignOrientation",
]);


const STRUCTURE_PROPS = new Set([
  "Anchored", "CanCollide", "Size", "Shape", "Material", "Massless",
  "CollisionGroup", "CustomPhysicalProperties", "CustomDensity",
  "CustomFriction", "CustomElasticity", "CustomFrictionWeight",
  "CustomElasticityWeight",
  "CollisionFidelity", "MeshId",                                 
]);

const RIGID_JOINTS = new Set(["Weld", "WeldConstraint", "Snap"]);

let enginePromise = null;


export function loadPhysicsEngine() {
  if (!enginePromise) {
    enginePromise = import("./engine/index.js").catch((err) => {
      enginePromise = null;                                          
      throw err;
    });
  }
  return enginePromise;
}

function isPhysicalPart(inst) {
  return (
    inst && inst.__isInstance === true &&
    typeof inst.hasProperty === "function" &&
    inst.hasProperty("Size") && inst.hasProperty("Position") &&
    inst.hasProperty("Rotation") && inst.hasProperty("Anchored")
  );
}

function alive(inst) {
  return inst && (typeof inst.isDestroyed !== "function" || !inst.isDestroyed());
}

function pairKey(a, b) {
  return a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id;
}


export async function createPhysicsWorld({ dataModel, getWorkspace, logger }) {
  const ENGINE = await loadPhysicsEngine();

  const workspace = typeof getWorkspace === "function"
    ? getWorkspace()
    : dataModel && dataModel.findFirstChild ? dataModel.findFirstChild("Workspace") : null;
  if (!workspace) throw new Error("Workspace n\u00e3o encontrado para a simula\u00e7\u00e3o.");

  function log(level, msg) {
    if (logger && logger[level]) logger[level](`[F\u00edsica] ${msg}`);
  }

  const world = new ENGINE.World();
  world.broadphase = new ENGINE.SAPBroadphase(world);                         
  world.allowSleep = true;                                    
  world.solver.iterations = 10;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.3;


  let disposed = false;
  let dirty = false;
  let squelch = false;                                                     
  let accumulator = 0;
  let warnedBodyLimit = false;
  const partInfo = new Map();                                                                          
  const bodyParts = new Map();                          
  const shapeOwner = new Map();                    
  let bodies = [];
  const bodyFloats = new Map();                                                   
  let waterField = null;                                        
  let buoyancyStats = { bodiesInWater: 0, samples: 0 };                      
  const touching = new Map();                       


  const touchFireAt = new Map();                                               
  const matCache = new Map();                                                 
  const contactPairs = new Set();
  const killLogged = new Set();
  const subs = [];

  const constraintsCtl = createConstraintController({
    ENGINE,
    world,
    logger,
    maxConstraints: MAX_CONSTRAINTS,
    getPartInfo: (part) => (part && partInfo.get(part.id)) || null,
  });

  function setGravity(value) {
    const g = Math.max(0, Math.min(GRAVITY_MAX, sanitizeNum(value, 196.2)));
    world.gravity.set(0, -g, 0);                      
    for (const b of bodies) b.wakeUp();                                   
  }
  setGravity(workspace.hasProperty("Gravity") ? workspace.getProperty("Gravity") : 196.2);


  let terrainBodies = [];
  let terrainDirty = false;

  function clearTerrain() {
    for (const b of terrainBodies) {
      try { world.removeBody(b); } catch (_e) {                   }
    }
    terrainBodies = [];
  }

  function rebuildTerrain() {
    terrainDirty = false;
    clearTerrain();


    let tdForBodies = null;
    try { tdForBodies = terrainStore.getData(); } catch (_e) { tdForBodies = null; }
    terrainBodies = tdForBodies ? buildTerrainBodies(ENGINE, tdForBodies) : [];
    for (const b of terrainBodies) world.addBody(b);

    try {
      waterField = buildWaterField(terrainStore.getData());
    } catch (_e) {
      waterField = null;
    }


    for (const b of bodies) {
      if (b.type === ENGINE.Body.DYNAMIC) b.wakeUp();
    }
  }


  function materialFor(parts) {

    let f = 0, e = 0, fw = 0, ew = 0, total = 0;
    for (const part of parts) {
      const props = getPhysicalProperties(part);
      const m = Math.max(0.001, getPartMass(part) || 0.001);
      f += props.friction * m;
      e += props.elasticity * m;
      fw += props.frictionWeight * m;
      ew += props.elasticityWeight * m;
      total += m;
    }
    f /= total; e /= total; fw /= total; ew /= total;
    const key = f.toFixed(2) + "|" + e.toFixed(2) + "|" + fw.toFixed(1) + "|" + ew.toFixed(1);
    let mat = matCache.get(key);
    if (!mat) {
      mat = new ENGINE.Material("rsw-" + key);
      mat.__meta = { f, e, fw, ew };


      for (const other of matCache.values()) {
        addPair(mat, other);
      }
      addPair(mat, mat);
      matCache.set(key, mat);
    }
    return mat;
  }

  function addPair(a, b) {
    const key = a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id;
    if (contactPairs.has(key)) return;
    contactPairs.add(key);
    const ma = a.__meta, mb = b.__meta;
    const friction = (ma.f * ma.fw + mb.f * mb.fw) / Math.max(0.001, ma.fw + mb.fw);
    const restitution = (ma.e * ma.ew + mb.e * mb.ew) / Math.max(0.001, ma.ew + mb.ew);
    world.addContactMaterial(new ENGINE.ContactMaterial(a, b, { friction, restitution }));
  }


  function makeShape(part) {
    const size = sanitizeVec(part.getProperty("Size"), { x: 1, y: 1, z: 1 });
    const hx = Math.max(0.025, Math.abs(size.x) / 2);
    const hy = Math.max(0.025, Math.abs(size.y) / 2);
    const hz = Math.max(0.025, Math.abs(size.z) / 2);


    if (part.className === "MeshPart") {
      return makeMeshPartShape(part, hx, hy, hz);
    }

    if (part.className === "UnionOperation") {
      return makeUnionShape(part, hx, hy, hz);
    }
    const shape = part.hasProperty("Shape") ? part.getProperty("Shape") : "Block";
    if (shape === "Ball") {
      return { shape: new ENGINE.Sphere(Math.min(hx, hy, hz)), extraQuat: null };
    }
    if (shape === "Cylinder") {

      const r = Math.min(hy, hz);
      const cyl = new ENGINE.Cylinder(r, r, hx * 2, 12);
      const s = Math.sin(-Math.PI / 4), c = Math.cos(-Math.PI / 4);
      return { shape: cyl, extraQuat: { x: 0, y: 0, z: s, w: c } };
    }
    if (shape === "Wedge") {

      const v = (x, y, z) => new ENGINE.Vec3(x, y, z);
      const vertices = [
        v(-hx, -hy, -hz), v(-hx, -hy, hz), v(-hx, hy, -hz),
        v(hx, -hy, -hz), v(hx, -hy, hz), v(hx, hy, -hz),
      ];
      const faces = [
        [0, 1, 2],      
        [3, 5, 4],      
        [0, 3, 4, 1],             
        [0, 2, 5, 3],                      
        [1, 4, 5, 2],         
      ];
      return { shape: new ENGINE.ConvexPolyhedron({ vertices, faces }), extraQuat: null };
    }


    return { shape: new ENGINE.Box(new ENGINE.Vec3(hx, hy, hz)), extraQuat: null };
  }


  function makeMeshPartShape(part, hx, hy, hz) {
    const fidelity = part.hasProperty("CollisionFidelity")
      ? part.getProperty("CollisionFidelity")
      : "Default";
    if (fidelity === "Box") {
      return { shape: new ENGINE.Box(new ENGINE.Vec3(hx, hy, hz)), extraQuat: null };
    }
    const meshId = part.hasProperty("MeshId") ? part.getProperty("MeshId") : "";
    const info = meshId ? meshRegistry.get(meshId) : null;
    if (!info || !info.extents) {

      return { shape: new ENGINE.Box(new ENGINE.Vec3(hx, hy, hz)), extraQuat: null };
    }


    const col = info.collision || null;
    if (col) {
      const sx = hx * 2, sy = hy * 2, sz = hz * 2;
      const wantDecomp = fidelity === "Default" || fidelity === "PreciseConvexDecomposition";
      if (wantDecomp && col.boxes && col.boxes.length) {
        return {
          subShapes: col.boxes.map((b) => ({
            shape: new ENGINE.Box(
              new ENGINE.Vec3(
                Math.max(0.025, b.h.x * sx),
                Math.max(0.025, b.h.y * sy),
                Math.max(0.025, b.h.z * sz),
              ),
            ),
            center: { x: b.c.x * sx, y: b.c.y * sy, z: b.c.z * sz },
          })),
          extraQuat: null,
        };
      }
      if (col.hull) {

        try {
          const verts = col.hull.vertices.map((v) => ({ x: v.x * sx, y: v.y * sy, z: v.z * sz }));
          return {
            shape: new ENGINE.ConvexPolyhedron({ vertices: verts, faces: col.hull.faces }),
            extraQuat: null,
          };
        } catch (_) {

        }
      }
    }


    const ex = info.extents;
    const tighten = fidelity === "Hull" ? 0.92 : 1.0;
    const cx = Math.max(0.025, hx * Math.min(1, Math.abs(ex.x)) * tighten);
    const cy = Math.max(0.025, hy * Math.min(1, Math.abs(ex.y)) * tighten);
    const cz = Math.max(0.025, hz * Math.min(1, Math.abs(ex.z)) * tighten);
    return { shape: new ENGINE.Box(new ENGINE.Vec3(cx, cy, cz)), extraQuat: null };
  }

  function unionRayCrossCount(verts, ox, oy, oz, dx, dy, dz) {
    let count = 0;
    for (let i = 0; i + 8 < verts.length; i += 9) {
      const ax = verts[i], ay = verts[i + 1], az = verts[i + 2];
      const e1x = verts[i + 3] - ax, e1y = verts[i + 4] - ay, e1z = verts[i + 5] - az;
      const e2x = verts[i + 6] - ax, e2y = verts[i + 7] - ay, e2z = verts[i + 8] - az;
      const pvx = dy * e2z - dz * e2y;
      const pvy = dz * e2x - dx * e2z;
      const pvz = dx * e2y - dy * e2x;
      const det = e1x * pvx + e1y * pvy + e1z * pvz;
      if (det > -1e-9 && det < 1e-9) continue;
      const inv = 1 / det;
      const tx = ox - ax, ty = oy - ay, tz = oz - az;
      const u = (tx * pvx + ty * pvy + tz * pvz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y;
      const qy = tz * e1x - tx * e1z;
      const qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-6) count++;
    }
    return count;
  }

  function unionInside(verts, px, py, pz) {
    let votes = 0;
    if (unionRayCrossCount(verts, px, py, pz, 1, 0, 0) % 2 === 1) votes++;
    if (unionRayCrossCount(verts, px, py, pz, 0, 1, 0) % 2 === 1) votes++;
    if (unionRayCrossCount(verts, px, py, pz, 0, 0, 1) % 2 === 1) votes++;
    return votes >= 2;
  }

  function buildUnionBoxes(positions, sx, sy, sz) {
    const n = positions.length;
    if (n < 9) return null;
    const verts = new Array(n);
    let loX = Infinity, loY = Infinity, loZ = Infinity;
    let hiX = -Infinity, hiY = -Infinity, hiZ = -Infinity;
    for (let i = 0; i + 2 < n; i += 3) {
      const x = positions[i] * sx, y = positions[i + 1] * sy, z = positions[i + 2] * sz;
      verts[i] = x; verts[i + 1] = y; verts[i + 2] = z;
      if (x < loX) loX = x; if (y < loY) loY = y; if (z < loZ) loZ = z;
      if (x > hiX) hiX = x; if (y > hiY) hiY = y; if (z > hiZ) hiZ = z;
    }
    const ex = hiX - loX, ey = hiY - loY, ez = hiZ - loZ;
    if (!(ex > 0) || !(ey > 0) || !(ez > 0)) return null;
    const TARGET = 1.0;
    const MAX_AXIS = 16;
    const nx = Math.min(MAX_AXIS, Math.max(1, Math.round(ex / TARGET)));
    const ny = Math.min(MAX_AXIS, Math.max(1, Math.round(ey / TARGET)));
    const nz = Math.min(MAX_AXIS, Math.max(1, Math.round(ez / TARGET)));
    const cx = ex / nx, cy = ey / ny, cz = ez / nz;
    const hxC = cx / 2, hyC = cy / 2, hzC = cz / 2;
    const MAX_BOXES = 600;
    const boxes = [];
    for (let iz = 0; iz < nz; iz++) {
      const pz = loZ + (iz + 0.5) * cz;
      for (let iy = 0; iy < ny; iy++) {
        const py = loY + (iy + 0.5) * cy;
        let runStart = -1;
        for (let ix = 0; ix < nx; ix++) {
          const inside = unionInside(verts, loX + (ix + 0.5) * cx, py, pz);
          if (inside && runStart < 0) runStart = ix;
          if ((!inside || ix === nx - 1) && runStart >= 0) {
            const runEnd = inside ? ix : ix - 1;
            const len = runEnd - runStart + 1;
            boxes.push({
              hx: hxC * len,
              hy: hyC,
              hz: hzC,
              cx: loX + ((runStart + runEnd + 1) / 2) * cx,
              cy: py,
              cz: pz,
            });
            runStart = -1;
            if (boxes.length > MAX_BOXES) return null;
          }
        }
      }
    }
    return boxes.length ? boxes : null;
  }


  function makeImportedHullShapes(solid, hx, hy, hz) {
    try {
      const hulls = solid.hulls;
      const base =
        solid.baseSize && solid.baseSize.x > 0 && solid.baseSize.y > 0 && solid.baseSize.z > 0
          ? solid.baseSize
          : { x: hx * 2, y: hy * 2, z: hz * 2 };
      const sx = base.x > 0 ? (hx * 2) / base.x : 1;
      const sy = base.y > 0 ? (hy * 2) / base.y : 1;
      const sz = base.z > 0 ? (hz * 2) / base.z : 1;
      const maxHulls =
        SOLID_LIMITS && Number.isFinite(SOLID_LIMITS.maxHulls) ? SOLID_LIMITS.maxHulls : 512;
      const subShapes = [];
      for (let i = 0; i < hulls.length && subShapes.length < maxHulls; i++) {
        const hull = hulls[i];
        const srcVerts = hull && Array.isArray(hull.vertices) ? hull.vertices : null;
        const faces = hull && Array.isArray(hull.faces) ? hull.faces : null;
        if (!srcVerts || srcVerts.length < 4 || !faces || faces.length < 4) continue;              
        const vertices = [];
        let ok = true;
        let loX = Infinity, loY = Infinity, loZ = Infinity;
        let hiX = -Infinity, hiY = -Infinity, hiZ = -Infinity;
        for (const v of srcVerts) {
          const x = Number(v && v.x) * sx;
          const y = Number(v && v.y) * sy;
          const z = Number(v && v.z) * sz;
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { ok = false; break; }
          vertices.push(new ENGINE.Vec3(x, y, z));
          if (x < loX) loX = x; if (y < loY) loY = y; if (z < loZ) loZ = z;
          if (x > hiX) hiX = x; if (y > hiY) hiY = y; if (z > hiZ) hiZ = z;
        }


        if (!ok || !(hiX - loX > 1e-6) || !(hiY - loY > 1e-6) || !(hiZ - loZ > 1e-6)) continue;
        for (const f of faces) {
          if (!Array.isArray(f) || f.length < 3) { ok = false; break; }
          for (const idx of f) {
            if (!Number.isInteger(idx) || idx < 0 || idx >= vertices.length) { ok = false; break; }
          }
          if (!ok) break;
        }
        if (!ok) continue;
        subShapes.push({
          shape: new ENGINE.ConvexPolyhedron({ vertices, faces: faces.map((f) => f.slice()) }),
          center: { x: 0, y: 0, z: 0 },
        });
      }
      return subShapes.length ? { subShapes, extraQuat: null } : null;
    } catch (_) {
      return null;                                                   
    }
  }


  function makeUnionShape(part, hx, hy, hz) {
    const fidelity = part.hasProperty("CollisionFidelity")
      ? part.getProperty("CollisionFidelity")
      : "Default";
    const boxShape = () => ({ shape: new ENGINE.Box(new ENGINE.Vec3(hx, hy, hz)), extraQuat: null });
    if (fidelity === "Box") return boxShape();


    const hasRecipe = Array.isArray(part._sourceParts) && part._sourceParts.length > 0;
    const importedSolid =
      !hasRecipe && part._importedSolid && typeof part._importedSolid === "object"
        ? part._importedSolid
        : null;
    if (importedSolid) {
      if (importedSolid.boxOnly === true) return boxShape();
      if (fidelity !== "Hull" && Array.isArray(importedSolid.hulls) && importedSolid.hulls.length) {
        const made = makeImportedHullShapes(importedSolid, hx, hy, hz);
        if (made) return made;

      }
    }

    const csg = part._csgMesh;
    const positions = csg && Array.isArray(csg.positions) ? csg.positions : null;
    if (!positions || positions.length < 9) return boxShape();

    const base = csg.baseSize || { x: hx * 2, y: hy * 2, z: hz * 2 };
    const sx = base.x > 0 ? (hx * 2) / base.x : 1;
    const sy = base.y > 0 ? (hy * 2) / base.y : 1;
    const sz = base.z > 0 ? (hz * 2) / base.z : 1;

    if (fidelity === "Hull") {


      try {
        const triCount = Math.floor(positions.length / 9);
        const strideTris = Math.max(1, Math.ceil(triCount / 1000));
        const pts = [];
        for (let t = 0; t < triCount; t += strideTris) {
          const base = t * 9;
          for (let k = 0; k < 9; k += 3) {
            pts.push({
              x: positions[base + k] * sx,
              y: positions[base + k + 1] * sy,
              z: positions[base + k + 2] * sz,
            });
          }
        }
        const hull = computeConvexHull(pts, 48);
        if (hull) {
          return {
            shape: new ENGINE.ConvexPolyhedron({ vertices: hull.vertices, faces: hull.faces }),
            extraQuat: null,
          };
        }
      } catch (_) {

      }
      let loX = Infinity, loY = Infinity, loZ = Infinity;
      let hiX = -Infinity, hiY = -Infinity, hiZ = -Infinity;
      for (let i = 0; i + 2 < positions.length; i += 3) {
        const x = positions[i] * sx, y = positions[i + 1] * sy, z = positions[i + 2] * sz;
        if (x < loX) loX = x; if (y < loY) loY = y; if (z < loZ) loZ = z;
        if (x > hiX) hiX = x; if (y > hiY) hiY = y; if (z > hiZ) hiZ = z;
      }
      const ax = Math.max(0.025, (hiX - loX) / 2);
      const ay = Math.max(0.025, (hiY - loY) / 2);
      const az = Math.max(0.025, (hiZ - loZ) / 2);
      return { shape: new ENGINE.Box(new ENGINE.Vec3(ax, ay, az)), extraQuat: null };
    }

    try {
      const boxes = buildUnionBoxes(positions, sx, sy, sz);
      if (boxes && boxes.length) {
        return {
          subShapes: boxes.map((b) => ({
            shape: new ENGINE.Box(new ENGINE.Vec3(b.hx, b.hy, b.hz)),
            center: { x: b.cx, y: b.cy, z: b.cz },
          })),
          extraQuat: null,
        };
      }
    } catch (_) {
      return boxShape();
    }
    return boxShape();
  }


  function collectSceneBuckets(root) {
    const descendants = root.getDescendants();
    const parts = [];
    const rigidJoints = [];
    for (const inst of descendants) {
      if (!alive(inst)) continue;
      if (isPhysicalPart(inst)) {
        if (parts.length >= MAX_BODIES) {
          if (!warnedBodyLimit) {
            warnedBodyLimit = true;
            log("warn", `Limite de ${MAX_BODIES} Parts simuladas atingido; extras ignoradas.`);
          }
          continue;
        }
        parts.push(inst);
        continue;
      }
      if (RIGID_JOINTS.has(inst.className)) rigidJoints.push(inst);
    }
    return { descendants, parts, rigidJoints };
  }

  function buildAssemblies(parts, rigidJoints) {
    const index = new Map();                     
    parts.forEach((p, i) => index.set(p.id, i));
    const parent = parts.map((_p, i) => i);
    const find = (i) => {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    };
    const union = (a, b) => { parent[find(a)] = find(b); };

    for (const inst of rigidJoints) {
      if (inst.hasProperty("Enabled") && inst.getProperty("Enabled") === false) continue;
      const p0 = inst.getProperty("Part0");
      const p1 = inst.getProperty("Part1");
      if (!p0 || !p1 || !index.has(p0.id) || !index.has(p1.id)) continue;
      union(index.get(p0.id), index.get(p1.id));
    }
    const groups = new Map();
    parts.forEach((p, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(p);
    });
    return [...groups.values()];
  }

  function clearWorld() {
    constraintsCtl.clear();
    for (const b of bodies) {
      try { world.removeBody(b); } catch (_e) {                   }
    }
    bodies = [];
    partInfo.clear();
    bodyParts.clear();
    shapeOwner.clear();
    bodyFloats.clear();
  }

  function rebuild() {
    dirty = false;
    clearWorld();
    const scene = collectSceneBuckets(workspace);
    const assemblies = buildAssemblies(scene.parts, scene.rigidJoints);
    for (const group of assemblies) {
      buildBody(group);
    }
    constraintsCtl.build(scene.descendants);
  }

  function buildBody(group) {

    const anchored = group.some((p) => p.getProperty("Anchored") === true);

    let totalMass = 0;
    const com = { x: 0, y: 0, z: 0 };
    const poses = new Map();
    for (const p of group) {
      const pos = sanitizeVec(p.getProperty("Position"));
      const m = getPartMass(p);
      poses.set(p.id, pos);
      totalMass += m;
      com.x += pos.x * (m || 0.001);
      com.y += pos.y * (m || 0.001);
      com.z += pos.z * (m || 0.001);
    }
    const weight = Math.max(0.001, totalMass || group.length * 0.001);
    com.x /= weight; com.y /= weight; com.z /= weight;
    if (!anchored && totalMass <= 0) totalMass = 0.001;                          

    const body = new ENGINE.Body({
      mass: anchored ? 0 : Math.max(0.001, totalMass),
      type: anchored ? ENGINE.Body.STATIC : ENGINE.Body.DYNAMIC,
      position: new ENGINE.Vec3(com.x, com.y, com.z),
      material: materialFor(group),
      allowSleep: true,
    });
    body.sleepSpeedLimit = 0.4;
    body.sleepTimeLimit = 0.8;
    body.linearDamping = 0.01;
    body.angularDamping = 0.01;


    const g = groupOfPart(group[0]);
    body.collisionFilterGroup = groupBit(g);
    body.collisionFilterMask = groupMask(g);

    const list = [];
    const floats = [];                                                   
    for (const p of group) {
      const pos = poses.get(p.id);
      const rot = sanitizeVec(p.getProperty("Rotation"));
      const q = eulerDegToQuat(rot.x, rot.y, rot.z);
      const made = makeShape(p);

      const canCollide = p.getProperty("CanCollide") !== false;
      const offset = { x: pos.x - com.x, y: pos.y - com.y, z: pos.z - com.z };
      if (made.subShapes && made.subShapes.length) {
        for (const sub of made.subShapes) {
          const sub3 = sub.shape;
          sub3.collisionResponse = canCollide;
          const rc = rotateVecByQuat(sub.center, q);
          body.addShape(
            sub3,
            new ENGINE.Vec3(offset.x + rc.x, offset.y + rc.y, offset.z + rc.z),
            new ENGINE.Quaternion(q.x, q.y, q.z, q.w),
          );
          shapeOwner.set(sub3.id, p);
        }
      } else {
        const shape = made.shape;
        shape.collisionResponse = canCollide;
        const shapeQuat = made.extraQuat ? quatMultiply(q, made.extraQuat) : q;
        body.addShape(
          shape,
          new ENGINE.Vec3(offset.x, offset.y, offset.z),
          new ENGINE.Quaternion(shapeQuat.x, shapeQuat.y, shapeQuat.z, shapeQuat.w),
        );
        shapeOwner.set(shape.id, p);
      }
      partInfo.set(p.id, {
        part: p,
        body,
        localOffset: offset,
        localQuat: q,
        lastVel: { x: 0, y: 0, z: 0 },
        lastAngVel: { x: 0, y: 0, z: 0 },
      });


      const floatSize = sanitizeVec(p.getProperty("Size"), { x: 1, y: 1, z: 1 });
      floats.push({
        volume: Math.max(0, getPartVolume(p) || 0),
        half: {
          x: Math.max(0.025, Math.abs(floatSize.x) / 2),
          y: Math.max(0.025, Math.abs(floatSize.y) / 2),
          z: Math.max(0.025, Math.abs(floatSize.z) / 2),
        },
        offset,
        quat: q,
      });
      list.push(p);
    }

    if (!anchored) {
      const v0 = sanitizeVec(group[0].hasProperty("AssemblyLinearVelocity") ? group[0].getProperty("AssemblyLinearVelocity") : null);
      const w0 = sanitizeVec(group[0].hasProperty("AssemblyAngularVelocity") ? group[0].getProperty("AssemblyAngularVelocity") : null);
      if (vecLength(v0) > 0) body.velocity.set(v0.x, v0.y, v0.z);
      if (vecLength(w0) > 0) body.angularVelocity.set(w0.x, w0.y, w0.z);
    }
    bodyParts.set(body.id, list);
    bodyFloats.set(body.id, floats);
    bodies.push(body);
    world.addBody(body);
  }


  function syncToDataModel() {
    squelch = true;
    try {
      for (const body of bodies) {
        if (body.type !== ENGINE.Body.DYNAMIC) continue;


        let justSlept = false;
        if (body.sleepState === ENGINE.Body.SLEEPING) {
          if (body.__syncedAsleep) continue;
          body.__syncedAsleep = true;
          justSlept = true;
        } else if (body.__syncedAsleep) {
          body.__syncedAsleep = false;
        }
        const parts = bodyParts.get(body.id) || [];
        const bq = { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w };
        for (const p of parts) {
          const info = partInfo.get(p.id);
          if (!info || !alive(p)) continue;
          const off = rotateVecByQuat(info.localOffset, bq);
          const wq = quatMultiply(bq, info.localQuat);
          const e = quatToEulerDeg(wq);
          p.setProperty("Position", makeVector3(
            body.position.x + off.x,
            body.position.y + off.y,
            body.position.z + off.z,
          ));
          p.setProperty("Rotation", makeVector3(e.x, e.y, e.z));

          if (p.hasProperty("AssemblyLinearVelocity")) {
            const v = body.velocity;
            const lv = info.lastVel;
            if ((justSlept && (lv.x !== 0 || lv.y !== 0 || lv.z !== 0)) ||
              Math.abs(v.x - lv.x) + Math.abs(v.y - lv.y) + Math.abs(v.z - lv.z) > 0.05) {
              info.lastVel = { x: v.x, y: v.y, z: v.z };
              p.setProperty("AssemblyLinearVelocity", makeVector3(v.x, v.y, v.z));
            }
            const w = body.angularVelocity;
            const lw = info.lastAngVel;
            if ((justSlept && (lw.x !== 0 || lw.y !== 0 || lw.z !== 0)) ||
              Math.abs(w.x - lw.x) + Math.abs(w.y - lw.y) + Math.abs(w.z - lw.z) > 0.05) {
              info.lastAngVel = { x: w.x, y: w.y, z: w.z };
              p.setProperty("AssemblyAngularVelocity", makeVector3(w.x, w.y, w.z));
            }
          }
        }
      }
    } finally {
      squelch = false;
    }
  }


  function teleportFromPart(part) {
    const info = partInfo.get(part.id);
    if (!info) return;
    const pos = sanitizeVec(part.getProperty("Position"));
    const rot = sanitizeVec(part.getProperty("Rotation"));
    const pq = eulerDegToQuat(rot.x, rot.y, rot.z);


    const bq = quatMultiply(pq, quatConjugate(info.localQuat));
    const off = rotateVecByQuat(info.localOffset, bq);
    info.body.position.set(pos.x - off.x, pos.y - off.y, pos.z - off.z);
    info.body.quaternion.set(bq.x, bq.y, bq.z, bq.w);
    info.body.wakeUp();
  }

  function onPropertyChanged(e) {
    if (squelch || disposed || !e || !e.instance) return;
    const inst = e.instance;
    const prop = e.property;
    if (inst.className === "Workspace" && prop === "Gravity") {
      setGravity(e.value);
      return;
    }
    const info = partInfo.get(inst.id);
    if (info) {
      if (prop === "Position" || prop === "Rotation") {
        teleportFromPart(inst);
        return;
      }
      if (prop === "AssemblyLinearVelocity" || prop === "Velocity") {
        const v = sanitizeVec(e.value);
        const m = Math.min(1, MAX_LINEAR_VEL / Math.max(1e-6, vecLength(v)));
        info.body.velocity.set(v.x * m, v.y * m, v.z * m);
        info.body.wakeUp();
        return;
      }
      if (prop === "AssemblyAngularVelocity" || prop === "RotVelocity") {
        const v = sanitizeVec(e.value);
        const m = Math.min(1, MAX_ANGULAR_VEL / Math.max(1e-6, vecLength(v)));
        info.body.angularVelocity.set(v.x * m, v.y * m, v.z * m);
        info.body.wakeUp();
        return;
      }
      if (STRUCTURE_PROPS.has(prop)) {
        dirty = true;
        return;
      }
    }
    if (REBUILD_CLASSES.has(inst.className)) dirty = true;
  }

  function onTreeChanged(e) {
    if (squelch || disposed || !e) return;
    const child = e.child || e.instance;
    if (!child) return;
    if (isPhysicalPart(child) || REBUILD_CLASSES.has(child.className)) dirty = true;
  }

  subs.push(bus.on(Events.PropertyChanged, onPropertyChanged));
  subs.push(bus.on(Events.ChildAdded, onTreeChanged));
  subs.push(bus.on(Events.ChildRemoved, onTreeChanged));
  subs.push(bus.on(Events.Destroying, onTreeChanged));
  subs.push(bus.on(CollisionGroupEvents.Changed, () => { dirty = true; }));


  subs.push(bus.on(TerrainEvents.Changed, () => { terrainDirty = true; }));


  const EXPLOSION_JOINT_CLASSES = new Set([
    "WeldConstraint", "Weld", "Snap", "Motor6D",
    "RopeConstraint", "RodConstraint", "SpringConstraint",
    "HingeConstraint", "PrismaticConstraint", "BallSocketConstraint",
    "UniversalConstraint", "AlignPosition", "AlignOrientation",
  ]);
  subs.push(bus.on("effects:explosionBlast", (e) => {
    if (!e || !world) return;
    const radius = Math.min(1000, Math.max(0, Number(e.radius) || 0));
    const pressure = Math.min(1e6, Math.max(0, Number(e.pressure) || 0));
    const jointR = radius * Math.min(1, Math.max(0, Number(e.jointPercent) || 0));
    const cx = Number(e.x) || 0;
    const cy = Number(e.y) || 0;
    const cz = Number(e.z) || 0;
    if (radius <= 0) return;
    for (const info of partInfo.values()) {
      const body = info.body;
      const part = info.part;
      if (!body || !part || part.isDestroyed()) continue;


      const ro = body.quaternion.vmult(
        new ENGINE.Vec3(info.localOffset.x, info.localOffset.y, info.localOffset.z),
        new ENGINE.Vec3(),
      );
      const px = body.position.x + ro.x;
      const py = body.position.y + ro.y;
      const pz = body.position.z + ro.z;
      const dx = px - cx;
      const dy = py - cy;
      const dz = pz - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > radius) continue;

      bus.emit("effects:explosionHit", { partId: part.id, distance: dist });
      if (pressure > 0 && body.mass > 0 && part.getProperty("Anchored") !== true) {
        const falloff = 1 - dist / Math.max(0.001, radius);
        const mag = Math.min(250, (pressure / 4000) * Math.max(0.15, falloff));
        let nx = 0; let ny = 1; let nz = 0;
        if (dist > 0.001) { nx = dx / dist; ny = dy / dist; nz = dz / dist; }


        body.applyImpulse(new ENGINE.Vec3(nx * mag, (ny + 0.35) * mag, nz * mag), new ENGINE.Vec3(px, py, pz));
        body.wakeUp();
      }
      if (jointR > 0 && dist <= jointR) {
        for (const ch of part.getChildren().slice()) {
          if (EXPLOSION_JOINT_CLASSES.has(ch.className)) {
            try { ch.destroy(); } catch (_err) {            }
          }
        }
      }
    }
  }));


  function canTouch(part) {
    return !(part.hasProperty("CanTouch") && part.getProperty("CanTouch") === false);
  }

  function processContacts() {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const current = new Map();
    for (const eq of world.contacts) {
      const a = shapeOwner.get(eq.si.id);
      const b = shapeOwner.get(eq.sj.id);
      if (!a || !b || a === b || !alive(a) || !alive(b)) continue;
      current.set(pairKey(a, b), { a, b });
    }

    for (const [key, pair] of current) {
      if (!touching.has(key)) {


        const last = touchFireAt.get(key) || 0;
        touching.set(key, { a: pair.a, b: pair.b });
        if (now - last >= TOUCH_THROTTLE_MS && canTouch(pair.a) && canTouch(pair.b)) {
          touchFireAt.set(key, now);
          bus.emit(PhysicsEvents.Touched, { a: pair.a, b: pair.b });
        }
      }
    }


    if (touchFireAt.size > 4096) {
      for (const [key, ts] of touchFireAt) {
        if (now - ts > 10 * TOUCH_THROTTLE_MS) touchFireAt.delete(key);
      }
    }

    for (const [key, pair] of touching) {
      if (current.has(key)) continue;
      touching.delete(key);
      if (alive(pair.a) && alive(pair.b) && canTouch(pair.a) && canTouch(pair.b)) {
        bus.emit(PhysicsEvents.TouchEnded, { a: pair.a, b: pair.b });
      }
    }
  }

  function clampVelocities() {
    for (const body of bodies) {
      if (body.type !== ENGINE.Body.DYNAMIC) continue;
      const v = body.velocity;
      const lv = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (!Number.isFinite(lv)) { v.set(0, 0, 0); continue; }
      if (lv > MAX_LINEAR_VEL) { const s = MAX_LINEAR_VEL / lv; v.scale(s, v); }
      const w = body.angularVelocity;
      const lw = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
      if (!Number.isFinite(lw)) { w.set(0, 0, 0); continue; }
      if (lw > MAX_ANGULAR_VEL) { const s = MAX_ANGULAR_VEL / lw; w.scale(s, w); }
    }
  }

  function killPlane() {


    let killY = KILL_Y;
    if (workspace && workspace.hasProperty && workspace.hasProperty("FallenPartsDestroyHeight")) {
      const fh = sanitizeNum(workspace.getProperty("FallenPartsDestroyHeight"), KILL_Y);
      if (Number.isFinite(fh)) killY = fh;
    }
    let toDestroy = null;
    for (const body of bodies) {
      if (body.type !== ENGINE.Body.DYNAMIC) continue;
      if (body.position.y > killY) continue;
      for (const p of bodyParts.get(body.id) || []) {
        if (!alive(p)) continue;
        if (!toDestroy) toDestroy = [];
        toDestroy.push(p);
      }
    }
    if (!toDestroy) return;
    for (const p of toDestroy) {
      if (!killLogged.has(p.id)) {
        killLogged.add(p.id);
        log("info", `"${p.name}" caiu para fora do mundo e foi removida.`);
      }
      try { p.destroy(); } catch (_e) {                    }
    }
    dirty = true;
  }


  function applyFluidForces() {
    const wind = getCachedWind();
    if (wind.x * wind.x + wind.y * wind.y + wind.z * wind.z < 0.0001) return;
    for (const [, info] of partInfo) {
      const part = info.part;
      if (!part || (part.isDestroyed && part.isDestroyed())) continue;
      if (part.getProperty("EnableFluidForces") !== true) continue;
      if (part.getProperty("Anchored") === true) continue;
      const body = info.body;
      if (!body || !body.force || body.mass <= 0) continue;


      const pm = getPartMass(part);
      if (!(pm > 0)) continue;
      const k = pm * 0.35;
      body.applyForce(new ENGINE.Vec3(wind.x * k, wind.y * k, wind.z * k), body.position);
    }
  }


  function waterWaveState() {
    const inst = terrainStore.getTerrainInstance ? terrainStore.getTerrainInstance() : null;


    return waveStateFromTerrain(inst, waveClock.time);
  }

  function applyWaterBuoyancy(dt) {
    if (!waterField || !waterField.hasWater) {
      buoyancyStats.bodiesInWater = 0;
      return;
    }
    buoyancyStats = applyBuoyancy(waterField, {
      bodies,
      getFloats: (b) => bodyFloats.get(b.id) || null,
      gravityY: world.gravity.y,
      dt,
      waves: waterWaveState(),                                              
    });
  }

  function step(dt) {
    if (disposed) return;
    if (terrainDirty) rebuildTerrain();
    if (dirty) rebuild();
    accumulator += Math.min(Math.max(0, sanitizeNum(dt, FIXED_DT)), 0.25);
    let sub = 0;
    while (accumulator >= FIXED_DT && sub < MAX_SUBSTEPS) {
      constraintsCtl.preStep(FIXED_DT);
      applyFluidForces();
      applyWaterBuoyancy(FIXED_DT);                                        
      world.step(FIXED_DT);                          
      clampVelocities();
      accumulator -= FIXED_DT;
      sub += 1;
    }
    if (accumulator >= FIXED_DT) accumulator = accumulator % FIXED_DT;                   
    processContacts();
    syncToDataModel();
    killPlane();
  }

  function rejectIfExtreme(v3, what) {
    const v = sanitizeVec(v3);
    if (Math.abs(v.x) > MAX_IMPULSE || Math.abs(v.y) > MAX_IMPULSE ||
      Math.abs(v.z) > MAX_IMPULSE || vecLength(v) > MAX_IMPULSE) {
      log("warn", `${what} rejeitado: magnitude acima de 1e9 (anti-exploit).`);
      return null;
    }
    return v;
  }

  function applyImpulse(part, impulse) {
    const info = part && partInfo.get(part.id);
    if (!info || info.body.type !== ENGINE.Body.DYNAMIC) return false;
    const v = rejectIfExtreme(impulse, "ApplyImpulse");
    if (!v) return false;
    info.body.applyImpulse(new ENGINE.Vec3(v.x, v.y, v.z), info.body.position);
    info.body.wakeUp();
    return true;
  }

  function applyImpulseAtPosition(part, impulse, worldPos) {
    const info = part && partInfo.get(part.id);
    if (!info || info.body.type !== ENGINE.Body.DYNAMIC) return false;
    const v = rejectIfExtreme(impulse, "ApplyImpulseAtPosition");
    if (!v) return false;
    const p = sanitizeVec(worldPos);
    info.body.applyImpulse(new ENGINE.Vec3(v.x, v.y, v.z), new ENGINE.Vec3(p.x, p.y, p.z));
    info.body.wakeUp();
    return true;
  }

  function applyAngularImpulse(part, impulse) {
    const info = part && partInfo.get(part.id);
    if (!info || info.body.type !== ENGINE.Body.DYNAMIC) return false;
    const v = rejectIfExtreme(impulse, "ApplyAngularImpulse");
    if (!v) return false;
    const body = info.body;

    const L = new ENGINE.Vec3(v.x, v.y, v.z);
    const dw = new ENGINE.Vec3();
    body.invInertiaWorld.vmult(L, dw);
    body.angularVelocity.x += dw.x;
    body.angularVelocity.y += dw.y;
    body.angularVelocity.z += dw.z;
    body.wakeUp();
    return true;
  }


  function getDebugSnapshot() {
    const assemblies = [];
    for (const body of bodies) {
      assemblies.push({
        com: { x: body.position.x, y: body.position.y, z: body.position.z },
        velocity: { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z },
        sleeping: body.sleepState === ENGINE.Body.SLEEPING,
        dynamic: body.type === ENGINE.Body.DYNAMIC,
      });
    }
    const contacts = [];
    for (const eq of world.contacts) {
      contacts.push({
        x: eq.bi.position.x + eq.ri.x,
        y: eq.bi.position.y + eq.ri.y,
        z: eq.bi.position.z + eq.ri.z,
      });
    }
    return { assemblies, contacts };
  }

  function getStats() {
    return {
      bodies: bodies.length,
      constraints: constraintsCtl.count(),

      buoyancy: {
        bodiesInWater: buoyancyStats.bodiesInWater,
        samples: buoyancyStats.samples,
      },
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const off of subs) {
      try { off(); } catch (_e) {          }
    }
    subs.length = 0;
    clearWorld();
    clearTerrain();
    touching.clear();
    touchFireAt.clear();
    killLogged.clear();
  }

  rebuildTerrain();
  rebuild();

  return {
    step,
    dispose,
    applyImpulse,
    applyImpulseAtPosition,
    applyAngularImpulse,
    getDebugSnapshot,
    getStats,


    constraintState: (inst) => constraintsCtl.getState(inst),
  };
}
