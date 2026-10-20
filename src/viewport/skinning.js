import { bus } from "../core/eventBus.js";
import { Events } from "../datamodel/instance.js";
import { makeVector3 } from "../datamodel/index.js";
import { MAX_SKIN_BONES, sanitizeBoneTransform, buildSkinCollision } from "../assets/skinRegistry.js";


import { BONE_EULER_ORDER, isIdentityQuat } from "../animation/boneCFrame.js";
import { meshRegistry } from "../assets/meshRegistry.js";
import { createBoneTree, hasBoneDescendant } from "../assets/skinnedMeshFactory.js";
import { getSkinnedGeoLods } from "./meshLod.js";

const DEG = Math.PI / 180;
const LOD_NEAR_DISTANCE = 250;
const LOD_FAR_DISTANCE = 600;
const POSE_INTERVAL_MID_MS = 133;
const POSE_INTERVAL_FAR_MS = 400;
const MAP_REFRESH_MS = 500;
const GEO_LOD_HYSTERESIS = 0.05;

let THREE = null;
let requestRender = null;
const entries = new Map();
const unsubs = [];
let tmpVec = null;
let tmpSphere = null;
let tmpMat4 = null;
let frustum = null;
let poseQr = null;
let poseQo = null;
let poseQt = null;
let poseEuler = null;
let lastBoneChangeAt = 0;


export function skinnedPoseAtRest(inst) {
  if (!inst || typeof inst.getChildren !== "function") return true;
  const stack = [];
  try {
    for (const c of inst.getChildren()) stack.push(c);
  } catch (_) {
    return true;
  }
  let visited = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (++visited > 4096) return false;
    if (node.className === "Bone") {
      let t = null;
      let rot = null;
      try {
        t = sanitizeBoneTransform(typeof node.getProperty === "function" ? node.getProperty("Transform") : null);
        rot = sanitizeBoneTransform(typeof node.getProperty === "function" ? node.getProperty("TransformRotation") : null);
      } catch (_) {
        t = { x: 0, y: 0, z: 0 };
        rot = { x: 0, y: 0, z: 0 };
      }
      if (t.x || t.y || t.z || !isIdentityQuat(t)) return false;
      if (rot.x || rot.y || rot.z) return false;
    }
    if (typeof node.getChildren === "function") {
      try {
        for (const c of node.getChildren()) stack.push(c);
      } catch (_) {

      }
    }
  }
  return true;
}

function live(inst) {
  return Boolean(inst && (typeof inst.isDestroyed !== "function" || !inst.isDestroyed()));
}

function markMapsDirty() {
  for (const entry of entries.values()) entry.mapAt = 0;
}

function poseIntervalFor(dist) {
  if (dist <= LOD_NEAR_DISTANCE) return 0;
  if (dist <= LOD_FAR_DISTANCE) return POSE_INTERVAL_MID_MS;
  return POSE_INTERVAL_FAR_MS;
}

function collectLodMeshes(rootObj) {
  if (!rootObj || typeof rootObj.traverse !== "function") return null;
  const out = [];
  rootObj.traverse((n) => {
    if (!n.isSkinnedMesh || !n.geometry) return;
    const geos = getSkinnedGeoLods(THREE, n.geometry);
    if (geos) out.push({ mesh: n, geos });
  });
  return out.length ? out : null;
}

function geoLevelFor(dist, d1, d2, cur) {
  const t1 = d1 * (cur >= 1 ? 1 - GEO_LOD_HYSTERESIS : 1 + GEO_LOD_HYSTERESIS);
  const t2 = d2 * (cur >= 2 ? 1 - GEO_LOD_HYSTERESIS : 1 + GEO_LOD_HYSTERESIS);
  if (dist >= t2) return 2;
  if (dist >= t1) return 1;
  return 0;
}

function applyGeoLevel(entry, lvl) {
  if (lvl === entry.geoLevel) return;
  entry.geoLevel = lvl;
  for (const lm of entry.lodMeshes) {
    const g = lm.geos[Math.min(lvl, lm.geos.length - 1)];
    if (g && lm.mesh.geometry !== g) lm.mesh.geometry = g;
  }
  if (typeof requestRender === "function") requestRender();
}

export function initSkinning(opts) {
  THREE = (opts && opts.THREE) || THREE;
  requestRender = (opts && opts.requestRender) || requestRender;
  if (!THREE) return;
  tmpVec = new THREE.Vector3();
  tmpSphere = new THREE.Sphere();
  tmpMat4 = new THREE.Matrix4();
  frustum = new THREE.Frustum();
  poseQr = new THREE.Quaternion();
  poseQo = new THREE.Quaternion();
  poseQt = new THREE.Quaternion();
  poseEuler = new THREE.Euler();
  if (unsubs.length) return;
  unsubs.push(
    bus.on(Events.PropertyChanged, (p) => {
      const inst = p && p.instance;
      if (!inst || inst.className !== "Bone") return;
      if (p.property !== "Transform" && p.property !== "TransformRotation" &&
          p.property !== "Position" && p.property !== "Orientation") return;
      lastBoneChangeAt = Date.now();
      if (entries.size && typeof requestRender === "function") requestRender();
    }),
    bus.on(Events.ParentChanged, (p) => {
      const inst = p && p.instance;
      if (inst && inst.className === "Bone") {
        markMapsDirty();
        lastBoneChangeAt = Date.now();
      }
    }),
    bus.on(Events.Destroying, (p) => {
      const inst = p && p.instance;
      if (inst && inst.className === "Bone") {
        markMapsDirty();
        lastBoneChangeAt = Date.now();
        if (entries.size && typeof requestRender === "function") requestRender();
      }
    }),
  );
}

function disposeSubtree(obj) {
  if (!obj || typeof obj.traverse !== "function") return;
  obj.traverse((n) => {
    if (n.userData && n.userData.__rswShared) return;
    if (n.geometry && !(n.geometry.userData && n.geometry.userData.__rswShared)) {
      try { n.geometry.dispose(); } catch (_) {            }
    }
    const m = n.material;
    if (Array.isArray(m)) m.forEach((x) => { try { if (x) x.dispose(); } catch (_) {            } });
    else if (m) { try { m.dispose(); } catch (_) {            } }
  });
}

function buildBones(skin) {
  const bones = [];
  const roots = [];
  for (const j of skin.joints) {
    const bone = new THREE.Bone();
    bone.name = j.name;
    bone.position.set(j.pos.x, j.pos.y, j.pos.z);
    bone.rotation.set(j.rot.x * DEG, j.rot.y * DEG, j.rot.z * DEG);
    bone.userData.__rest = {
      px: j.pos.x, py: j.pos.y, pz: j.pos.z,
      rx: j.rot.x * DEG, ry: j.rot.y * DEG, rz: j.rot.z * DEG,
    };
    bones.push(bone);
    if (j.parent >= 0 && bones[j.parent]) bones[j.parent].add(bone);
    else roots.push(bone);
  }
  return { bones, roots };
}

function buildGeometry(skin) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(skin.positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(skin.uvs, 2));
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skin.skinIndex, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skin.skinWeight, 4));
  if (skin.indices.length) geo.setIndex(skin.indices);
  let hasNormal = false;
  for (const v of skin.normals) { if (v) { hasNormal = true; break; } }
  if (hasNormal) geo.setAttribute("normal", new THREE.Float32BufferAttribute(skin.normals, 3));
  else geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}


export function bindSkinnedGroup(group, rec, skin) {
  if (!THREE || !group || !skin || !skin.boneCount) return false;
  if (group.userData && group.userData.__disposed) return false;
  unbindSkinnedGroup(rec && rec.id);

  for (const child of group.children.slice()) {
    group.remove(child);
    disposeSubtree(child);
  }
  group.userData.__placeholder = null;

  const geo = buildGeometry(skin);
  const { bones, roots } = buildBones(skin);
  const solid = new THREE.SkinnedMesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0xb9c0c9 }),
  );
  solid.name = "rswSkinnedMesh";
  solid.userData.rswMeshChild = true;
  solid.frustumCulled = false;
  for (const r of roots) solid.add(r);
  solid.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  solid.bind(skeleton);

  const wire = new THREE.SkinnedMesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x39424e,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    }),
  );
  wire.name = "rswSkinnedWire";
  wire.frustumCulled = false;
  wire.bind(skeleton, solid.bindMatrix);

  const maxDim = Math.max(skin.size.x, skin.size.y, skin.size.z, 1e-3);
  const s = 1 / maxDim;
  const wrapper = new THREE.Group();
  wrapper.scale.setScalar(s);
  wrapper.position.set(-skin.center.x * s, -skin.center.y * s, -skin.center.z * s);
  wrapper.add(solid, wire);
  group.add(wrapper);
  group.userData.__meshLoaded = true;
  group.userData.__meshContent = wrapper;
  try {


    meshRegistry.register(skin.meshId, {
      size: skin.size,
      triangles: skin.triangles,
      collision: buildSkinCollision(skin),
    });
  } catch (_) {

  }

  const inst = rec && rec.instance;
  if (live(inst) && typeof inst._setInternal === "function") {
    try {
      inst._setInternal("HasSkinnedMesh", true);
      inst._setInternal("MeshSize", makeVector3(skin.size.x, skin.size.y, skin.size.z));
      if (!hasBoneDescendant(inst)) createBoneTree(inst, skin.joints);
    } catch (_) {                            }
  }

  const byName = new Map();
  for (const b of bones) if (!byName.has(b.name)) byName.set(b.name, b);
  entries.set(String(rec.id), {
    recId: String(rec.id),
    inst: inst || null,
    group,
    mesh: solid,
    skeleton,
    threeByName: byName,
    boneMap: new Map(),
    mapAt: 0,
    poseAt: 0,
    culled: false,
    lodMeshes: collectLodMeshes(wrapper),
    geoLevel: 0,
  });
  if (typeof requestRender === "function") requestRender();
  return true;
}

export function unbindSkinnedGroup(recId) {
  if (recId == null) return;
  const entry = entries.get(String(recId));
  if (entry && entry.lodMeshes) {
    for (const lm of entry.lodMeshes) {
      if (lm.mesh && lm.geos[0] && lm.mesh.geometry !== lm.geos[0]) {
        lm.mesh.geometry = lm.geos[0];
      }
    }
  }
  entries.delete(String(recId));
}


export function bindLoadedSkinnedScene(group, rec, root) {
  if (!THREE || !group || !rec || !root || typeof root.traverse !== "function") return false;
  if (group.userData && group.userData.__disposed) return false;
  unbindSkinnedGroup(rec.id);

  const collected = [];
  const seen = new Set();
  let firstMesh = null;
  root.traverse((n) => {
    if (n.isSkinnedMesh && n.skeleton) {
      if (!firstMesh) firstMesh = n;
      for (const b of n.skeleton.bones || []) {
        if (b && b.isBone && !seen.has(b)) {
          seen.add(b);
          collected.push(b);
        }
      }
    }
  });
  if (!firstMesh || !collected.length) return false;


  const bones = [];
  const placed = new Set();
  const visit = (b) => {
    if (!b || placed.has(b)) return;
    if (b.parent && seen.has(b.parent)) visit(b.parent);
    placed.add(b);
    bones.push(b);
  };
  for (const b of collected) visit(b);
  if (bones.length > MAX_SKIN_BONES) bones.length = MAX_SKIN_BONES;

  const byName = new Map();
  for (const b of bones) {
    b.userData.__rest = {
      px: b.position.x, py: b.position.y, pz: b.position.z,
      rx: b.rotation.x, ry: b.rotation.y, rz: b.rotation.z,
    };
    if (!byName.has(b.name)) byName.set(b.name, b);
  }

  const inst = rec && rec.instance;
  if (live(inst) && typeof inst._setInternal === "function") {
    try {
      inst._setInternal("HasSkinnedMesh", true);
      if (!hasBoneDescendant(inst)) {
        const idx = new Map();
        bones.forEach((b, i) => idx.set(b, i));
        const joints = bones.map((b, i) => ({
          name: b.name || `Bone${i}`,
          parent: b.parent && idx.has(b.parent) ? idx.get(b.parent) : -1,
          pos: { x: b.position.x, y: b.position.y, z: b.position.z },
          rot: {
            x: (b.rotation.x * 180) / Math.PI,
            y: (b.rotation.y * 180) / Math.PI,
            z: (b.rotation.z * 180) / Math.PI,
          },
        }));
        createBoneTree(inst, joints);
      }
    } catch (_) {                            }
  }

  entries.set(String(rec.id), {
    recId: String(rec.id),
    inst: inst || null,
    group,
    mesh: firstMesh,
    skeleton: firstMesh.skeleton,
    threeByName: byName,
    boneMap: new Map(),
    mapAt: 0,
    poseAt: 0,
    culled: false,
    lodMeshes: collectLodMeshes(root),
    geoLevel: 0,
  });
  if (typeof requestRender === "function") requestRender();
  return true;
}

export function hasSkinnedEntry(recId) {
  return entries.has(String(recId));
}


export function collectBonePoseOffsets(root) {
  const map = new Map();
  if (!root || typeof root.getChildren !== "function") return map;
  const stack = [root];
  let visited = 0;
  while (stack.length) {
    const node = stack.pop();
    visited += 1;
    if (visited > 4096) return map;                                                   
    if (node !== root && node && node.className === "Bone" && live(node)) {
      const name = typeof node.name === "string" ? node.name : "";
      if (name && !map.has(name)) {
        let t = null;
        let rot = null;
        try {
          t = sanitizeBoneTransform(node.getProperty("Transform"));
          rot = sanitizeBoneTransform(node.getProperty("TransformRotation"));
        } catch (_) {
          t = { x: 0, y: 0, z: 0 };
          rot = { x: 0, y: 0, z: 0 };
        }
        const hasEuler = !!(rot.x || rot.y || rot.z);
        const hasQuat = !isIdentityQuat(t);
        if (t.x || t.y || t.z || hasEuler || hasQuat) {
          map.set(name, {
            px: t.x,
            py: t.y,
            pz: t.z,
            ex: rot.x,
            ey: rot.y,
            ez: rot.z,
            qx: hasQuat ? t.qx : 0,
            qy: hasQuat ? t.qy : 0,
            qz: hasQuat ? t.qz : 0,
            qw: hasQuat ? t.qw : 1,
            hasEuler,
            hasQuat,
          });
        }
      }
    }
    let kids = null;
    try {
      kids = typeof node.getChildren === "function" ? node.getChildren() : null;
    } catch (_) {
      kids = null;
    }
    if (Array.isArray(kids)) {
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
  }
  return map;
}

function restPose(entry) {
  for (const bone of entry.threeByName.values()) {
    const r = bone.userData.__rest;
    if (!r) continue;
    bone.position.set(r.px, r.py, r.pz);
    bone.rotation.set(r.rx, r.ry, r.rz);
  }
}

function refreshBoneMap(entry, now) {
  if (now - entry.mapAt < MAP_REFRESH_MS) return;
  entry.mapAt = now;
  entry.boneMap.clear();
  const inst = entry.inst;
  if (!live(inst) || typeof inst.getDescendants !== "function") return;
  try {
    for (const d of inst.getDescendants()) {
      if (d && d.className === "Bone" && live(d) && !entry.boneMap.has(d.name)) {
        entry.boneMap.set(d.name, d);
      }
    }
  } catch (_) {                                                   }
}

function applyPose(entry) {
  for (const [name, bone] of entry.threeByName) {
    const r = bone.userData.__rest;
    if (!r) continue;
    const boneInst = entry.boneMap.get(name);
    if (!live(boneInst)) {
      bone.position.set(r.px, r.py, r.pz);
      bone.rotation.set(r.rx, r.ry, r.rz);
      continue;
    }
    let t = null;
    let rot = null;
    try {
      t = sanitizeBoneTransform(boneInst.getProperty("Transform"));
      rot = sanitizeBoneTransform(boneInst.getProperty("TransformRotation"));
    } catch (_) {
      t = { x: 0, y: 0, z: 0 };
      rot = { x: 0, y: 0, z: 0 };
    }
    bone.position.set(r.px + t.x, r.py + t.y, r.pz + t.z);


    const hasEuler = !!(rot.x || rot.y || rot.z);
    const hasQuat = !!poseQt && !isIdentityQuat(t);
    if (!poseQr || (!hasEuler && !hasQuat)) {


      bone.rotation.set(r.rx, r.ry, r.rz);
    } else {







      poseEuler.set(r.rx, r.ry, r.rz, bone.rotation.order);
      poseQr.setFromEuler(poseEuler);
      poseEuler.set(rot.x * DEG, rot.y * DEG, rot.z * DEG, BONE_EULER_ORDER);
      poseQo.setFromEuler(poseEuler);
      if (hasQuat) {
        poseQt.set(t.qx, t.qy, t.qz, t.qw);
        poseQo.multiply(poseQt);
      }
      bone.quaternion.copy(poseQo).multiply(poseQr);
    }
  }
}


export function updateSkinning(camera) {
  if (!THREE || !camera || !entries.size) return false;
  const now = Date.now();
  let posedAny = false;
  tmpMat4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(tmpMat4);
  for (const entry of entries.values()) {
    const group = entry.group;
    if (!group || (group.userData && group.userData.__disposed) || !group.parent) {
      entries.delete(entry.recId);
      continue;
    }
    group.getWorldPosition(tmpVec);
    const radius = Math.max(group.scale.x, group.scale.y, group.scale.z, 0.5) * 0.9;
    tmpSphere.set(tmpVec, radius);
    if (!frustum.intersectsSphere(tmpSphere)) {
      entry.culled = true;
      continue;
    }
    if (!live(entry.inst)) {
      restPose(entry);
      posedAny = true;
      continue;
    }
    const dist = camera.position.distanceTo(tmpVec);
    if (entry.lodMeshes) {
      const d1 = Math.max(60, radius * 12);
      applyGeoLevel(entry, geoLevelFor(dist, d1, Math.max(d1 * 2.5, 150), entry.geoLevel));
    }
    const interval = poseIntervalFor(dist);
    const force = entry.culled;
    entry.culled = false;
    if (!force && interval > 0 && now - entry.poseAt < interval) {
      if (lastBoneChangeAt >= entry.poseAt && typeof requestRender === "function") {
        requestRender();
      }
      continue;
    }
    entry.poseAt = now;
    refreshBoneMap(entry, now);
    applyPose(entry);
    posedAny = true;
  }
  return posedAny;
}

export function getSkinnedEntries() {
  return entries;
}


export function resolveBoneWorld(boneInst) {
  if (!THREE || !boneInst || boneInst.className !== "Bone") return null;
  let entry = null;
  let node = boneInst;
  let guard = 0;
  while (node && guard < 64 && !entry) {
    guard += 1;
    for (const e of entries.values()) {
      if (e.inst === node) { entry = e; break; }
    }
    if (!entry) node = typeof node.getParent === "function" ? node.getParent() : null;
  }
  if (!entry || !entry.threeByName) return null;
  const tb = entry.threeByName.get(boneInst.name);
  if (!tb) return null;
  try { tb.updateWorldMatrix(true, false); } catch (_) { return null; }
  const wp = new THREE.Vector3();
  tb.getWorldPosition(wp);
  const parent = tb.parent || entry.group;
  const pq = new THREE.Quaternion();
  const ps = new THREE.Vector3(1, 1, 1);
  const pv = new THREE.Vector3();
  if (parent && parent.matrixWorld) parent.matrixWorld.decompose(pv, pq, ps);
  return {
    position: { x: wp.x, y: wp.y, z: wp.z },
    parentQuat: { x: pq.x, y: pq.y, z: pq.z, w: pq.w },
    parentScale: {
      x: Math.abs(ps.x) > 1e-6 ? ps.x : 1,
      y: Math.abs(ps.y) > 1e-6 ? ps.y : 1,
      z: Math.abs(ps.z) > 1e-6 ? ps.z : 1,
    },
  };
}

export function disposeSkinning() {
  entries.clear();
  for (const off of unsubs.splice(0)) {
    try { if (typeof off === "function") off(); } catch (_) {            }
  }
}
