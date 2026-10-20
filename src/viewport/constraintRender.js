import * as THREE from "three";
import { bus } from "../core/eventBus.js";
import { settings } from "../config/settings.js";
import { Events } from "../datamodel/index.js";
import { store } from "../core/state.js";
import { engine, RuntimeEvents } from "../runtime/engine.js";

import { registerFrameCallback } from "../core/frameDriver.js";
import { isConstraintDetailsVisible, isWeldsVisible } from "../core/modelOps.js";
import {
  sanitizeVec,
  eulerDegToQuat,
  quatMultiply,
  rotateVecByQuat,
  vecLength,
} from "../physics/mathUtils.js";

const MAX_DRAWN = 200;                                             
const MAX_DEBUG_ITEMS = 300;

const COLORS = {
  attachment: 0x4caf50,
  weld: 0xff9800,
  hinge: 0xffd54f,
  rope: 0x8d6e63,
  spring: 0x90caf9,
  ballsocket: 0xce93d8,
  prismatic: 0x80cbc4,
  velocity: 0xffeb3b,
  contact: 0xff5252,
  com: 0xe040fb,
  wireframe: 0x00e5ff,
};

const CONSTRAINT_CLASSES = new Set([
  "Weld", "WeldConstraint", "HingeConstraint", "RopeConstraint",
  "SpringConstraint", "PrismaticConstraint", "BallSocketConstraint",
]);

function enabledOf(inst) {
  return !(inst.hasProperty("Enabled") && inst.getProperty("Enabled") === false);
}

function partPose(part) {
  const pos = sanitizeVec(part.getProperty("Position"));
  const rot = sanitizeVec(part.getProperty("Rotation"));
  return { pos, quat: eulerDegToQuat(rot.x, rot.y, rot.z) };
}


function attachmentWorld(att) {
  const part = att.getParent ? att.getParent() : null;
  if (!part || !part.hasProperty || !part.hasProperty("Position")) return null;
  const { pos, quat } = partPose(part);
  const local = sanitizeVec(att.getProperty("Position"));
  const o = sanitizeVec(att.hasProperty("Orientation") ? att.getProperty("Orientation") : null);
  const qAtt = quatMultiply(quat, eulerDegToQuat(o.x, o.y, o.z));
  const r = rotateVecByQuat(local, quat);
  return {
    pos: { x: pos.x + r.x, y: pos.y + r.y, z: pos.z + r.z },
    quat: qAtt,
  };
}

export function initConstraintRenderer({ scene, requestRender }) {

  if (!scene || typeof scene.add !== "function") return { dispose() {} };
  if (typeof requestRender !== "function") requestRender = () => {};
  const group = new THREE.Group();
  group.name = "rswConstraintOverlay";
  scene.add(group);
  const debugGroup = new THREE.Group();
  debugGroup.name = "rswPhysicsDebug";
  scene.add(debugGroup);


  const wireframeGroup = new THREE.Group();
  wireframeGroup.name = "rswPhysicsWireframe";
  scene.add(wireframeGroup);

  let disposed = false;
  let dirty = true;
  const subs = [];

  function markDirty() { dirty = true; }

  subs.push(bus.on("constraints:detailsChanged", markDirty));
  subs.push(bus.on("constraints:showWeldsChanged", markDirty));
  subs.push(bus.on(RuntimeEvents.ModeChanged, markDirty));
  subs.push(bus.on(Events.PropertyChanged, markDirty));
  subs.push(bus.on(Events.ChildAdded, markDirty));
  subs.push(bus.on(Events.ChildRemoved, markDirty));
  subs.push(bus.on(Events.Destroying, markDirty));
  subs.push(bus.on("settings:changed", (e) => {
    if (e && typeof e.key === "string" && e.key.startsWith("physics")) dirty = true;
  }));

  function clearGroup(g) {
    for (let i = g.children.length - 1; i >= 0; i--) {
      const child = g.children[i];
      g.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }

  function lineMat(color, dim, dashed) {
    const Mat = dashed ? THREE.LineDashedMaterial : THREE.LineBasicMaterial;
    const m = new Mat({
      color,
      transparent: true,
      opacity: dim ? 0.22 : 0.95,
      depthTest: false,
    });
    if (dashed) { m.dashSize = 0.4; m.gapSize = 0.25; }
    return m;
  }

  function addLine(g, points, color, dim, dashed) {
    const geo = new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    );
    const line = new THREE.Line(geo, lineMat(color, dim, dashed));
    if (dashed) line.computeLineDistances();
    line.renderOrder = 999;
    g.add(line);
    return line;
  }

  function addCross(g, pos, size, color, dim) {
    const s = size;
    const pts = [
      { x: pos.x - s, y: pos.y, z: pos.z }, { x: pos.x + s, y: pos.y, z: pos.z },
      { x: pos.x, y: pos.y - s, z: pos.z }, { x: pos.x, y: pos.y + s, z: pos.z },
      { x: pos.x, y: pos.y, z: pos.z - s }, { x: pos.x, y: pos.y, z: pos.z + s },
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(
      pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    );
    const seg = new THREE.LineSegments(geo, lineMat(color, dim, false));
    seg.renderOrder = 999;
    g.add(seg);
  }

  function addBoxMarker(g, pos, size, color, dim) {
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: dim ? 0.2 : 0.8, depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.renderOrder = 998;
    g.add(mesh);
  }

  function addSphere(g, pos, radius, color, opacity) {
    const geo = new THREE.SphereGeometry(radius, 12, 8);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.renderOrder = 997;
    g.add(mesh);
  }


  function addRing(g, center, axisQuat, radius, color, dim) {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;

      const local = { x: 0, y: Math.cos(a) * radius, z: Math.sin(a) * radius };
      const r = rotateVecByQuat(local, axisQuat);
      pts.push({ x: center.x + r.x, y: center.y + r.y, z: center.z + r.z });
    }
    addLine(g, pts, color, dim, false);

    const ax = rotateVecByQuat({ x: radius * 2, y: 0, z: 0 }, axisQuat);
    addLine(g, [center, { x: center.x + ax.x, y: center.y + ax.y, z: center.z + ax.z }], color, dim, false);
  }

  function addZigzag(g, a, b, color, dim, coils) {


    const cRaw = Number(coils);
    const c = Number.isFinite(cRaw) && cRaw > 0 ? Math.max(1, Math.min(16, Math.round(cRaw))) : 3;
    const segs = c * 4;
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const len = vecLength(d) || 1;
    const n = { x: d.x / len, y: d.y / len, z: d.z / len };

    let perp = { x: -n.y, y: n.x, z: 0 };
    if (vecLength(perp) < 0.01) perp = { x: 0, y: -n.z, z: n.y };
    const pl = vecLength(perp) || 1;
    perp = { x: perp.x / pl, y: perp.y / pl, z: perp.z / pl };
    const amp = Math.min(0.5, len * 0.08);
    const pts = [a];
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const side = i % 2 === 0 ? 1 : -1;
      pts.push({
        x: a.x + d.x * t + perp.x * amp * side,
        y: a.y + d.y * t + perp.y * amp * side,
        z: a.z + d.z * t + perp.z * amp * side,
      });
    }
    pts.push(b);
    addLine(g, pts, color, dim, false);
  }

  function getWorkspace() {
    const dm = store.getDataModel();
    return dm && dm.findFirstChild ? dm.findFirstChild("Workspace") : null;
  }

  function rebuildOverlay() {
    clearGroup(group);

    const details = isConstraintDetailsVisible();
    const weldsOnly = isWeldsVisible();
    if (!details && !weldsOnly) return;
    const ws = getWorkspace();
    if (!ws) return;
    let drawn = 0;
    for (const inst of ws.getDescendants()) {
      if (drawn >= MAX_DRAWN) break;
      if (typeof inst.isDestroyed === "function" && inst.isDestroyed()) continue;
      const cls = inst.className;
      if (cls === "Attachment") {
        if (!details) continue;
        const w = attachmentWorld(inst);
        if (w) { addCross(group, w.pos, 0.4, COLORS.attachment, false); drawn += 1; }
        continue;
      }
      if (!CONSTRAINT_CLASSES.has(cls)) continue;
      const dim = !enabledOf(inst);
      if (cls === "Weld" || cls === "WeldConstraint") {
        const p0 = inst.getProperty("Part0");
        const p1 = inst.getProperty("Part1");
        if (!p0 || !p1 || !p0.hasProperty || !p1.hasProperty) continue;
        if (!p0.hasProperty("Position") || !p1.hasProperty("Position")) continue;
        const a = sanitizeVec(p0.getProperty("Position"));
        const b = sanitizeVec(p1.getProperty("Position"));
        addBoxMarker(group, a, 0.35, COLORS.weld, dim);
        addBoxMarker(group, b, 0.35, COLORS.weld, dim);
        addLine(group, [a, b], COLORS.weld, dim, false);
        drawn += 1;
        continue;
      }
      if (!details) continue;                                                 
      const a0 = inst.getProperty("Attachment0");
      const a1 = inst.getProperty("Attachment1");
      const w0 = a0 && a0.className === "Attachment" ? attachmentWorld(a0) : null;
      const w1 = a1 && a1.className === "Attachment" ? attachmentWorld(a1) : null;
      if (!w0) continue;
      if (cls === "HingeConstraint") {
        addRing(group, w0.pos, w0.quat, 0.8, COLORS.hinge, dim);
        if (w1) addLine(group, [w0.pos, w1.pos], COLORS.hinge, true, false);
      } else if (cls === "RopeConstraint" && w1) {
        addLine(group, [w0.pos, w1.pos], COLORS.rope, dim, true);
      } else if (cls === "SpringConstraint" && w1) {

        addZigzag(group, w0.pos, w1.pos, COLORS.spring, dim, inst.getProperty("Coils"));
      } else if (cls === "BallSocketConstraint") {
        addSphere(group, w0.pos, 0.6, COLORS.ballsocket, dim ? 0.08 : 0.3);
      } else if (cls === "PrismaticConstraint" && w1) {
        addLine(group, [w0.pos, w1.pos], COLORS.prismatic, dim, false);
        addCross(group, w0.pos, 0.3, COLORS.prismatic, dim);
        addCross(group, w1.pos, 0.3, COLORS.prismatic, dim);
      }
      drawn += 1;
    }
  }


  const unitBoxEdgesGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const wireframeMaterial = lineMat(COLORS.wireframe, false, false);
  const wireframeSegmentPool = [];
  let usedWireframeSegmentCount = 0;

  function takeWireframeSegment() {
    let segment = wireframeSegmentPool[usedWireframeSegmentCount];
    if (!segment) {
      segment = new THREE.LineSegments(unitBoxEdgesGeometry, wireframeMaterial);
      segment.renderOrder = 996;
      wireframeSegmentPool.push(segment);
      wireframeGroup.add(segment);
    }
    usedWireframeSegmentCount += 1;
    segment.visible = true;
    return segment;
  }

  function hideUnusedWireframeSegments() {
    for (let i = usedWireframeSegmentCount; i < wireframeSegmentPool.length; i += 1) {
      wireframeSegmentPool[i].visible = false;
    }
  }

  function hideWireframe() {
    usedWireframeSegmentCount = 0;
    hideUnusedWireframeSegments();
  }

  function rebuildWireframe() {
    usedWireframeSegmentCount = 0;
    const ws = getWorkspace();
    if (ws) {
      for (const inst of ws.getDescendants()) {
        if (usedWireframeSegmentCount >= MAX_DEBUG_ITEMS) break;
        if (!inst.hasProperty || !inst.hasProperty("Size") || !inst.hasProperty("Anchored")) continue;
        if (typeof inst.isDestroyed === "function" && inst.isDestroyed()) continue;
        const size = sanitizeVec(inst.getProperty("Size"), { x: 1, y: 1, z: 1 });
        const { pos, quat } = partPose(inst);
        const segment = takeWireframeSegment();
        segment.scale.set(size.x, size.y, size.z);
        segment.position.set(pos.x, pos.y, pos.z);
        segment.quaternion.set(quat.x, quat.y, quat.z, quat.w);
      }
    }
    hideUnusedWireframeSegments();
  }

  function rebuildDebug() {
    clearGroup(debugGroup);
    const playing = engine.mode !== "edit";
    if (!playing) { hideWireframe(); return; }
    const showWire = settings.get("physicsShowWireframe") === true;
    const showVel = settings.get("physicsShowVelocities") === true;
    const showContacts = settings.get("physicsShowContacts") === true;
    const showCom = settings.get("physicsShowCenterOfMass") === true;
    if (!showWire && !showVel && !showContacts && !showCom) { hideWireframe(); return; }

    if (showWire) rebuildWireframe();
    else hideWireframe();

    const physics = typeof engine.getPhysics === "function" ? engine.getPhysics() : null;
    if (!physics) return;
    const snap = physics.getDebugSnapshot();
    if (showVel || showCom) {
      let n = 0;
      for (const a of snap.assemblies) {
        if (n >= MAX_DEBUG_ITEMS) break;
        if (showCom) addSphere(debugGroup, a.com, 0.25, COLORS.com, a.sleeping ? 0.3 : 0.9);
        if (showVel && a.dynamic) {
          const v = a.velocity;
          const m = vecLength(v);
          if (m > 0.1) {
            const scale = Math.min(10, m * 0.1) / m;
            addLine(debugGroup, [a.com, {
              x: a.com.x + v.x * scale,
              y: a.com.y + v.y * scale,
              z: a.com.z + v.z * scale,
            }], COLORS.velocity, false, false);
          }
        }
        n += 1;
      }
    }
    if (showContacts) {
      let n = 0;
      for (const c of snap.contacts) {
        if (n >= MAX_DEBUG_ITEMS) break;
        addSphere(debugGroup, c, 0.15, COLORS.contact, 0.9);
        n += 1;
      }
    }
  }


  const PLAY_REBUILD_INTERVAL_MS = 100;                                        
  let lastPlayRebuildAtMs = 0;

  function tick(frameTimestampMs) {
    if (disposed) return;
    const timestampMs = typeof frameTimestampMs === "number" ? frameTimestampMs : 0;
    const playing = engine.mode !== "edit";
    const shouldFollowPlayback =
      playing && timestampMs - lastPlayRebuildAtMs >= PLAY_REBUILD_INTERVAL_MS;
    if (!dirty && !shouldFollowPlayback) return;
    if (shouldFollowPlayback) lastPlayRebuildAtMs = timestampMs;
    dirty = false;
    rebuildOverlay();
    rebuildDebug();
    requestRender();
  }

  const unregisterFrameCallback = registerFrameCallback(
    "overlay",
    tick,
    "constraintRender:overlay",
  );

  return {
    dispose() {
      disposed = true;
      unregisterFrameCallback();
      for (const off of subs) {
        try { off(); } catch (_e) {          }
      }
      clearGroup(group);
      clearGroup(debugGroup);
      for (const segment of wireframeSegmentPool) wireframeGroup.remove(segment);
      wireframeSegmentPool.length = 0;
      usedWireframeSegmentCount = 0;
      unitBoxEdgesGeometry.dispose();
      wireframeMaterial.dispose();
      scene.remove(group);
      scene.remove(debugGroup);
      scene.remove(wireframeGroup);
    },
  };
}
