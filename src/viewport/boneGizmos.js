import { store } from "../core/state.js";
import { selection } from "../core/selection.js";
import { sanitizeBoneTransform } from "../assets/skinRegistry.js";
import { resolveBoneWorld } from "./skinning.js";


import {
  composeBoneCF,
  isIdentityQuat,
  mulBoneCF,
  quatFromEulerDeg,
  quatMul,
} from "../animation/boneCFrame.js";

const SCAN_MS = 600;
const MAX_GIZMO_BONES = 512;
const SPHERE_RADIUS = 0.11;
const LINK_RADIUS = 0.07;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function live(inst) {
  return Boolean(inst && (typeof inst.isDestroyed !== "function" || !inst.isDestroyed()));
}


function boneWorldPos(bone) {
  let x = 0;
  let y = 0;
  let z = 0;
  let acc = null;
  let rotated = false;
  let node = bone;
  let guard = 0;
  while (
    node &&
    typeof node.hasProperty === "function" &&
    !node.hasProperty("Anchored") &&
    guard < 64
  ) {
    guard += 1;
    let px = 0;
    let py = 0;
    let pz = 0;
    let q = null;
    if (node.hasProperty("Position")) {
      const p = node.getProperty("Position") || {};
      x += num(p.x);
      y += num(p.y);
      z += num(p.z);
      px = num(p.x);
      py = num(p.y);
      pz = num(p.z);
    }
    if (node.className === "Bone") {
      const t = sanitizeBoneTransform(node.getProperty("Transform"));
      x += t.x;
      y += t.y;
      z += t.z;
      px += t.x;
      py += t.y;
      pz += t.z;
      const rr = (node.hasProperty("TransformRotation") && node.getProperty("TransformRotation")) || {};
      q = quatMul(quatFromEulerDeg({ x: num(rr.x), y: num(rr.y), z: num(rr.z) }), t);
      if (!rotated && !isIdentityQuat(q)) rotated = true;
    }
    const cf = composeBoneCF({ x: px, y: py, z: pz }, q);
    acc = acc ? mulBoneCF(cf, acc) : cf;
    node = typeof node.getParent === "function" ? node.getParent() : null;
  }

  if (rotated && acc) {
    x = acc.x;
    y = acc.y;
    z = acc.z;
  }
  if (node && typeof node.hasProperty === "function" && node.hasProperty("Position")) {
    if (node.className === "MeshPart" && node.hasProperty("MeshSize")) {
      const ms = node.getProperty("MeshSize") || {};
      const sz = node.getProperty("Size") || {};
      x *= num(sz.x) / Math.max(1e-3, num(ms.x));
      y *= num(sz.y) / Math.max(1e-3, num(ms.y));
      z *= num(sz.z) / Math.max(1e-3, num(ms.z));
    }
    const pp = node.getProperty("Position") || {};
    x += num(pp.x);
    y += num(pp.y);
    z += num(pp.z);
  }
  return { x, y, z };
}

export function initBoneGizmos(opts) {
  const THREE = opts && opts.THREE;
  const scene = opts && opts.scene;
  const camera = opts && opts.camera;
  const host = opts && opts.host;
  const requestRender = (opts && opts.requestRender) || (() => {});
  if (!THREE || !scene || !camera) return null;

  const group = new THREE.Group();
  group.name = "rswBoneGizmos";
  group.visible = false;
  scene.add(group);

  const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 10, 8);
  const linkGeo = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
  const matBone = new THREE.MeshBasicMaterial({ color: 0xe8b64c, depthTest: false, transparent: true, opacity: 0.95 });
  const matSel = new THREE.MeshBasicMaterial({ color: 0x4c8bf5, depthTest: false, transparent: true, opacity: 1 });
  const matLink = new THREE.MeshBasicMaterial({ color: 0xc98f2e, depthTest: false, transparent: true, opacity: 0.55 });

  const spheres = [];
  const links = [];
  let bones = [];
  let lastScan = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const ndc = new THREE.Vector2();
  let raycaster = null;

  function scan() {
    bones = [];
    let dm = null;
    try {
      dm = store.getDataModel();
    } catch (_) {
      dm = null;
    }
    if (!dm || typeof dm.findFirstChild !== "function") return;
    const ws = dm.findFirstChild("Workspace");
    if (!ws || typeof ws.getDescendants !== "function") return;
    try {
      for (const d of ws.getDescendants()) {
        if (d && d.className === "Bone" && live(d)) {
          bones.push(d);
          if (bones.length >= MAX_GIZMO_BONES) break;
        }
      }
    } catch (_) {

    }
  }

  function sphereAt(i) {
    let m = spheres[i];
    if (!m) {
      m = new THREE.Mesh(sphereGeo, matBone);
      m.renderOrder = 999;
      m.userData.rswBoneGizmo = true;
      spheres[i] = m;
      group.add(m);
    }
    m.visible = true;
    return m;
  }

  function linkAt(i) {
    let m = links[i];
    if (!m) {
      m = new THREE.Mesh(linkGeo, matLink);
      m.renderOrder = 998;
      links[i] = m;
      group.add(m);
    }
    m.visible = true;
    return m;
  }

  function update() {
    const show = store.getViewOption("showGizmos") !== false;
    if (!show) {
      if (group.visible) {
        group.visible = false;
        requestRender();
      }
      return;
    }
    const now = Date.now();
    if (now - lastScan >= SCAN_MS) {
      lastScan = now;
      scan();
    }
    if (!bones.length) {
      if (group.visible) {
        group.visible = false;
        requestRender();
      }
      return;
    }
    group.visible = true;
    let selectedIds = [];
    try {
      selectedIds = selection.ids() || [];
    } catch (_) {
      selectedIds = [];
    }
    const sel = new Set(selectedIds);
    const pos = new Map();
    let si = 0;
    let li = 0;
    for (const bone of bones) {
      if (!live(bone)) continue;


      const skinned = resolveBoneWorld(bone);
      const w = skinned ? skinned.position : boneWorldPos(bone);
      pos.set(bone.id, w);
      const m = sphereAt(si);
      si += 1;
      m.position.set(w.x, w.y, w.z);
      m.material = sel.has(bone.id) ? matSel : matBone;
      m.userData.boneInst = bone;
    }
    for (const bone of bones) {
      if (!live(bone)) continue;
      const parent = typeof bone.getParent === "function" ? bone.getParent() : null;
      if (!parent || parent.className !== "Bone") continue;
      const a = pos.get(parent.id);
      const b = pos.get(bone.id);
      if (!a || !b) continue;
      dir.set(b.x - a.x, b.y - a.y, b.z - a.z);
      const len = dir.length();
      if (len < 1e-4) continue;
      const m = linkAt(li);
      li += 1;
      m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      m.scale.set(LINK_RADIUS, len, LINK_RADIUS);
      dir.normalize();
      m.quaternion.setFromUnitVectors(up, dir);
    }
    for (let i = si; i < spheres.length; i += 1) if (spheres[i]) spheres[i].visible = false;
    for (let i = li; i < links.length; i += 1) if (links[i]) links[i].visible = false;
  }

  function onPointerDown(e) {
    if (!group.visible || e.button !== 0 || !host) return;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (!raycaster) raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const targets = spheres.filter((s) => s && s.visible);
    if (!targets.length) return;
    const hits = raycaster.intersectObjects(targets, false);
    const hit = hits && hits[0];
    const inst = hit && hit.object && hit.object.userData && hit.object.userData.boneInst;
    if (!live(inst)) return;
    try {
      selection.set([inst]);
    } catch (_) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    lastScan = 0;
    requestRender();
  }

  if (host) host.addEventListener("pointerdown", onPointerDown, true);

  function dispose() {
    if (host) host.removeEventListener("pointerdown", onPointerDown, true);
    scene.remove(group);
    sphereGeo.dispose();
    linkGeo.dispose();
    matBone.dispose();
    matSel.dispose();
    matLink.dispose();
    spheres.length = 0;
    links.length = 0;
    bones = [];
  }

  return { update, dispose, refresh: () => { lastScan = 0; } };
}
