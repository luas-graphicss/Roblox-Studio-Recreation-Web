import { store } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { settings } from "../config/settings.js";
import { tools, TRANSFORM_TOOLS } from "./tools.js";
import { createTransformSession } from "./transformController.js";
import { isPivotEditing } from "./pivotEditor.js";

const AXIS_COLORS = { x: 0xff4d4d, y: 0x4dff6a, z: 0x4d8bff };
const AXIS_HOVER = { x: 0xffd24d, y: 0xfff04d, z: 0x4dd2ff };
const PLANE_COLOR = 0xffffff;
const AXES = ["x", "y", "z"];
const AXIS_INDEX = { x: 0, y: 1, z: 2 };


function snapSteps() {
  return {
    move: settings.get("moveSnapEnabled") === true ? Number(settings.get("moveSnap")) || 0 : 0,
    rotate: settings.get("rotateSnapEnabled") === true ? Number(settings.get("rotateSnap")) || 0 : 0,
    scale: 0,
  };
}


function readPivotOffset(inst) {
  const v = inst && typeof inst.getProperty === "function" ? inst.getProperty("PivotOffset") : null;
  if (!v || typeof v !== "object") return { x: 0, y: 0, z: 0 };
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}

function safePivotEditing() {
  try { return isPivotEditing(); } catch (_) { return false; }
}


export function buildGizmos({ THREE, host, camera, getSelectedRecords, requestRender }) {
  const overlay = new THREE.Scene();
  const root = new THREE.Group();
  root.visible = false;
  overlay.add(root);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();


  const groups = {
    move: buildMoveGizmo(THREE),
    rotate: buildRotateGizmo(THREE),
    scale: buildScaleGizmo(THREE),
  };
  for (const key of Object.keys(groups)) {
    groups[key].group.visible = false;
    root.add(groups[key].group);


    for (const h of groups[key].handles) h.userData.gizmoMode = key;
  }

  let currentMode = null;                                                    
  let hovered = null;                      
  let drag = null;                                  
  let gizmoScale = 1;                                       


  function modesForTool(tool) {
    if (tool === "transform") return ["move", "rotate", "scale"];
    if (TRANSFORM_TOOLS.includes(tool)) return [tool];
    return [];
  }

  function activeHandles() {
    if (!currentMode) return [];
    const out = [];
    for (const m of modesForTool(currentMode)) out.push(...groups[m].handles);
    return out;
  }


  function selectionPivot(records) {
    let x = 0, y = 0, z = 0, n = 0;
    for (const r of records) {
      if (!r || !r.position) continue;
      x += r.position.x; y += r.position.y; z += r.position.z; n++;
    }
    if (!n) return null;
    return new THREE.Vector3(x / n, y / n, z / n);
  }


  const ringViewTmp = new THREE.Vector3();
  const ringQuatTmp = new THREE.Quaternion();
  let ghostIds = [];                                                               


  function updateGizmoScale(pivot) {
    const d = camera.position.distanceTo(pivot);
    gizmoScale = Math.max(0.0001, d * 0.15);
    root.scale.setScalar(gizmoScale);
  }


  function update() {
    const tool = tools.get();
    const records = (getSelectedRecords() || []).filter((r) => r && (r.kind === "part" || r.kind === "bone"));
    const boneOnly = records.length > 0 && records.every((r) => r.kind === "bone");


    if (safePivotEditing() && records.length > 0) {
      const primary = records[0];
      const off = readPivotOffset(primary.instance);
      const marker = new THREE.Vector3(
        primary.position.x + off.x,
        primary.position.y + off.y,
        primary.position.z + off.z,
      );
      currentMode = "move";
      for (const key of Object.keys(groups)) {
        groups[key].group.visible = key === "move";
      }
      root.visible = true;
      root.position.copy(marker);
      root.quaternion.set(0, 0, 0, 1);                                    
      updateGizmoScale(marker);
      return;
    }

    const show = TRANSFORM_TOOLS.includes(tool) && records.length > 0 && !(boneOnly && tool === "scale");
    currentMode = show ? tool : null;

    const visibleModes = show ? modesForTool(tool).filter((m) => !(boneOnly && m === "scale")) : [];
    for (const key of Object.keys(groups)) {
      groups[key].group.visible = visibleModes.includes(key);
    }
    root.visible = show;
    if (!show) { clearHover(); return; }

    const pivot = selectionPivot(records);
    if (!pivot) { root.visible = false; return; }
    root.position.copy(pivot);


    const sq = spaceQuaternion(records);
    if (sq) root.quaternion.copy(sq);
    else root.quaternion.set(0, 0, 0, 1);
    updateGizmoScale(pivot);


    if (groups.rotate.group.visible) {
      for (const h of groups.rotate.handles) {
        const ring = h.children[0];
        if (!ring) continue;
        ringViewTmp.copy(camera.position).sub(pivot);
        ringQuatTmp.copy(root.quaternion).multiply(h.quaternion).invert();
        ringViewTmp.applyQuaternion(ringQuatTmp);
        const planar = ringViewTmp.x * ringViewTmp.x + ringViewTmp.y * ringViewTmp.y;
        if (planar > 1e-10) {
          ring.rotation.z = Math.atan2(ringViewTmp.y, ringViewTmp.x) - Math.PI / 2;
        }
      }
    }
  }


  function clearHover() {
    if (hovered) { setHandleColor(hovered, false); hovered = null; requestRender(); }
  }
  function setHover(handle) {
    if (hovered === handle) return;
    if (hovered) setHandleColor(hovered, false);
    hovered = handle || null;
    if (hovered) setHandleColor(hovered, true);
    requestRender();
  }
  function setHandleColor(handle, isHover) {
    const base = handle.userData.baseColor;
    const hover = handle.userData.hoverColor;
    handle.traverse((n) => {
      if (n.material && n.material.color) n.material.color.setHex(isHover ? hover : base);
      if (n.material) n.material.opacity = isHover ? 1 : (n.userData.baseOpacity ?? 1);
    });
  }

  function pointerToNdc(e) {
    const rect = host.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
  }

  function pickHandle(e) {
    if (!currentMode || !root.visible) return null;
    pointerToNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(activeHandles(), true);
    for (const hit of hits) {

      let obj = hit.object;
      while (obj && !obj.userData.isHandle && obj.parent) obj = obj.parent;
      if (!obj || !obj.userData.isHandle) continue;


      return obj;
    }
    return null;
  }


  function axisWorldDir(axis) {
    if (axis === "x") return new THREE.Vector3(1, 0, 0);
    if (axis === "y") return new THREE.Vector3(0, 1, 0);
    return new THREE.Vector3(0, 0, 1);
  }


  function spaceQuaternion(records) {


    const boneRec = (records || []).find((r) => r && r.kind === "bone" && r.boneInfo);
    if (boneRec) {
      const q = boneRec.boneInfo.parentQuat;
      return new THREE.Quaternion(q.x, q.y, q.z, q.w);
    }
    const space = typeof store.getViewOption === "function" ? store.getViewOption("axesSpace") : "world";
    if (space !== "local" && space !== "lastObject") return null;
    const recs = (records || []).filter((r) => r && r.kind === "part");
    if (!recs.length) return null;
    const rec = space === "lastObject" ? recs[recs.length - 1] : recs[0];
    const rot = rec.rotation || { x: 0, y: 0, z: 0 };
    const k = Math.PI / 180;
    return new THREE.Quaternion().setFromEuler(
      new THREE.Euler((rot.x || 0) * k, (rot.y || 0) * k, (rot.z || 0) * k),
    );
  }


  function axisSpaceDir(axis, records) {
    const dir = axisWorldDir(axis);
    const q = spaceQuaternion(records);
    if (q) dir.applyQuaternion(q);
    return dir;
  }


  function pointOnAxis(e, origin, dir) {
    pointerToNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;

    const p1 = origin, d1 = dir.clone().normalize();
    const p2 = ray.origin, d2 = ray.direction.clone().normalize();
    const r = new THREE.Vector3().subVectors(p1, p2);
    const a = d1.dot(d1), b = d1.dot(d2), c = d2.dot(d2), d = d1.dot(r), eedot = d2.dot(r);
    const denom = a * c - b * b;
    let s = 0;
    if (Math.abs(denom) > 1e-6) s = (b * eedot - c * d) / denom;
    return p1.clone().addScaledVector(d1, s);
  }


  function pointOnPlane(e, planeNormal, planePoint) {
    pointerToNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal.clone().normalize(), planePoint);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  }


  function screenAngle(e, pivot) {
    const rect = host.getBoundingClientRect();
    const p = pivot.clone().project(camera);
    const cx = rect.left + (p.x * 0.5 + 0.5) * rect.width;
    const cy = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
    return Math.atan2(e.clientY - cy, e.clientX - cx);
  }


  function onPointerMove(e) {
    if (drag) { continueDrag(e); return; }
    if (!currentMode || !root.visible) { clearHover(); return; }
    const handle = pickHandle(e);
    setHover(handle);
    host.style.cursor = handle ? "grab" : "";
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;                                     
    if (!currentMode || !root.visible) return;
    const handle = pickHandle(e);
    if (!handle) return;                                                                           
    e.preventDefault();
    e.stopPropagation();
    beginDrag(e, handle);
  }

  function beginDrag(e, handle) {
    const all = (getSelectedRecords() || []).filter((r) => r && (r.kind === "part" || r.kind === "bone"));
    const boneRecords = all.filter((r) => r.kind === "bone");
    const records = boneRecords.length ? boneRecords : all;
    const instances = records.map((r) => r.instance).filter(Boolean);
    if (!instances.length) return;

    const ud = handle.userData;
    const editingPivot = safePivotEditing();

    let pivot, mode, session;
    if (editingPivot) {


      const primary = records[0];
      const off = readPivotOffset(primary.instance);
      pivot = new THREE.Vector3(
        primary.position.x + off.x,
        primary.position.y + off.y,
        primary.position.z + off.z,
      );
      mode = "move";
      session = createTransformSession({ mode, instances: [primary.instance], steps: snapSteps(), prop: "PivotOffset" });
    } else {
      pivot = selectionPivot(records);
      if (!pivot) return;

      mode = currentMode === "transform" ? (ud.gizmoMode || "move") : currentMode;
      if (boneRecords.length) {


        if (mode === "scale") return;
        const boneProp = mode === "rotate" ? "TransformRotation" : "Transform";
        session = createTransformSession({ mode, instances, steps: snapSteps(), prop: boneProp });
      } else {
        session = createTransformSession({ mode, instances, steps: snapSteps() });
      }
    }
    if (!session.isActive()) return;

    drag = { handle, session, pivot, mode, kind: ud.kind, axis: ud.axis, start: null, startAngle: 0 };
    if (!editingPivot && boneRecords.length && boneRecords[0].boneInfo) {
      const bi = boneRecords[0].boneInfo;
      const pq = new THREE.Quaternion(bi.parentQuat.x, bi.parentQuat.y, bi.parentQuat.z, bi.parentQuat.w);
      drag.boneFrame = { invQuat: pq.clone().invert(), scale: bi.parentScale };
      drag.facingDir = axisSpaceDir(ud.axis, records);
    }

    if (mode === "move") {
      if (ud.kind === "plane") {

        drag.normal = axisSpaceDir(ud.axis, records);                                     
        drag.start = pointOnPlane(e, drag.normal, pivot);
      } else {
        drag.dir = axisSpaceDir(ud.axis, records);
        drag.start = pointOnAxis(e, pivot, drag.dir);
      }
    } else if (mode === "scale") {
      drag.dir = axisSpaceDir(ud.kind === "uniform" ? "y" : ud.axis, records);
      drag.start = pointOnAxis(e, pivot, drag.dir);
    } else if (mode === "rotate") {
      drag.startAngle = screenAngle(e, pivot);
    }

    setHandleColor(handle, true);


    ghostIds = records.filter((r) => r && r.kind === "part" && r.id != null).map((r) => r.id);
    if (ghostIds.length) bus.emit("gizmo:ghost", { active: true, ids: ghostIds });
    host.style.cursor = "grabbing";
    host.setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", continueDrag, true);
    window.addEventListener("pointerup", endDrag, true);

    window.addEventListener("blur", cancelDrag, true);
    window.addEventListener("pointercancel", cancelDrag, true);
  }

  function continueDrag(e) {
    if (!drag) return;
    const ignoreSnap = e.altKey === true;                                     
    const pivot = drag.pivot;

    if (drag.mode === "move") {
      let delta;
      if (drag.kind === "plane") {
        const now = pointOnPlane(e, drag.normal, pivot);
        if (!now || !drag.start) return;
        const diff = now.clone().sub(drag.start);


        const n = drag.normal.clone().normalize();
        diff.addScaledVector(n, -diff.dot(n));
        delta = { x: diff.x, y: diff.y, z: diff.z };
      } else {
        const now = pointOnAxis(e, pivot, drag.dir);
        if (!now || !drag.start) return;
        const d = drag.dir.clone().normalize();
        const amt = now.clone().sub(drag.start).dot(d);


        delta = { x: d.x * amt, y: d.y * amt, z: d.z * amt };
      }
      if (drag.boneFrame) {


        const v = new THREE.Vector3(delta.x, delta.y, delta.z).applyQuaternion(drag.boneFrame.invQuat);
        delta = { x: v.x / drag.boneFrame.scale.x, y: v.y / drag.boneFrame.scale.y, z: v.z / drag.boneFrame.scale.z };
      }
      drag.session.update({ delta, ignoreSnap });
    } else if (drag.mode === "scale") {
      const now = pointOnAxis(e, pivot, drag.dir);
      if (!now || !drag.start) return;
      const amt = now.clone().sub(drag.start).dot(drag.dir.clone().normalize());
      let delta;
      if (drag.kind === "uniform") delta = { x: amt, y: amt, z: amt };
      else { delta = { x: 0, y: 0, z: 0 }; delta[drag.axis] = amt; }
      drag.session.update({ delta, ignoreSnap });
    } else if (drag.mode === "rotate") {
      const now = screenAngle(e, pivot);
      let deg = ((now - drag.startAngle) * 180) / Math.PI;



      const facing = (drag.facingDir || axisWorldDir(drag.axis)).dot(camera.position.clone().sub(pivot));





      if (facing > 0) deg = -deg;
      drag.session.update({ axis: AXIS_INDEX[drag.axis], deg, ignoreSnap });
    }
    requestRender();
  }

  function teardownDragListeners() {
    window.removeEventListener("pointermove", continueDrag, true);
    window.removeEventListener("pointerup", endDrag, true);
    window.removeEventListener("blur", cancelDrag, true);
    window.removeEventListener("pointercancel", cancelDrag, true);
  }

  function endDrag(e) {
    if (!drag) return;
    try { drag.session.commit(); }
    catch (err) { logger.error("Gizmo: erro ao finalizar transformação:", err); drag.session.cancel(); }
    finishDrag();
  }

  function cancelDrag() {
    if (!drag) return;
    try { drag.session.cancel(); } catch (_) {            }
    finishDrag();
  }

  function finishDrag() {
    teardownDragListeners();
    if (drag && drag.handle) setHandleColor(drag.handle, false);

    if (ghostIds.length) {
      bus.emit("gizmo:ghost", { active: false, ids: ghostIds });
      ghostIds = [];
    }
    drag = null;
    host.style.cursor = "";
    update();
    requestRender();
  }


  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerdown", onPointerDown);


  const offState = bus.on("state:changed", (p) => {
    if (p && p.change && (p.change.key === "activeTool" || p.change.key === "selection")) {
      update();
      requestRender();
    }
  });
  const offSelection = bus.on("selection:changed", () => { update(); requestRender(); });

  function dispose() {
    teardownDragListeners();
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerdown", onPointerDown);
    if (typeof offState === "function") offState();
    if (typeof offSelection === "function") offSelection();
  }

  return {
    overlay,
    update,


    isVisible: () => {
      if (root.visible) return true;
      for (const ch of overlay.children) {
        if (ch !== root && ch.visible) return true;
      }
      return false;
    },
    render(renderer) {


      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(overlay, camera);
      renderer.autoClear = prevAutoClear;
    },
    isDragging: () => !!drag,
    dispose,
  };
}


function makeAxisMaterial(THREE, color, opacity = 1) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false });
  return m;
}

function tagHandle(handle, kind, axis) {
  handle.userData.isHandle = true;
  handle.userData.kind = kind;                                         
  handle.userData.axis = axis;                                        
  handle.userData.baseColor = axis ? AXIS_COLORS[axis] : 0xffffff;
  handle.userData.hoverColor = axis ? AXIS_HOVER[axis] : 0xffe24d;
  handle.renderOrder = 1000;
  handle.traverse((n) => {
    if (n.material) {
      n.material.depthTest = false;
      n.userData.baseOpacity = n.material.opacity ?? 1;
    }
  });
  return handle;
}


function buildMoveGizmo(THREE) {
  const group = new THREE.Group();
  const handles = [];
  const L = 1.0;                                              

  for (const axis of AXES) {
    const h = new THREE.Group();
    const mat = makeAxisMaterial(THREE, AXIS_COLORS[axis]);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, L, 8), mat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 12), mat);
    shaft.position.y = L / 2;
    tip.position.y = L + 0.11;
    h.add(shaft, tip);
    orientToAxis(h, axis, THREE);
    tagHandle(h, "axis", axis);
    group.add(h);
    handles.push(h);
  }


  const planes = [
    { axis: "z", a: "x", b: "y" },
    { axis: "x", a: "y", b: "z" },
    { axis: "y", a: "z", b: "x" },
  ];
  for (const pl of planes) {
    const mat = makeAxisMaterial(THREE, PLANE_COLOR, 0.25);


    mat.side = THREE.DoubleSide;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), mat);
    quad.position[pl.a] = 0.28;
    quad.position[pl.b] = 0.28;
    orientPlane(quad, pl.axis, THREE);
    const h = new THREE.Group();
    h.add(quad);
    tagHandle(h, "plane", pl.axis);
    h.userData.baseColor = PLANE_COLOR;
    h.userData.hoverColor = 0xffe24d;
    group.add(h);
    handles.push(h);
  }
  return { group, handles };
}


function buildRotateGizmo(THREE) {
  const group = new THREE.Group();
  const handles = [];
  for (const axis of AXES) {
    const mat = makeAxisMaterial(THREE, AXIS_COLORS[axis]);


    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.02, 8, 48, Math.PI), mat);
    const h = new THREE.Group();
    h.add(ring);

    if (axis === "x") h.rotation.y = Math.PI / 2;
    else if (axis === "y") h.rotation.x = Math.PI / 2;
    tagHandle(h, "ring", axis);
    group.add(h);
    handles.push(h);
  }
  return { group, handles };
}


function buildScaleGizmo(THREE) {
  const group = new THREE.Group();
  const handles = [];
  const L = 1.0;
  for (const axis of AXES) {
    const h = new THREE.Group();
    const mat = makeAxisMaterial(THREE, AXIS_COLORS[axis]);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, L, 8), mat);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), mat);
    shaft.position.y = L / 2;
    knob.position.y = L + 0.07;
    h.add(shaft, knob);
    orientToAxis(h, axis, THREE);
    tagHandle(h, "axis", axis);
    group.add(h);
    handles.push(h);
  }

  const cmat = makeAxisMaterial(THREE, 0xdddddd);
  const center = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), cmat);
  const ch = new THREE.Group();
  ch.add(center);
  tagHandle(ch, "uniform", null);
  ch.userData.baseColor = 0xdddddd;
  ch.userData.hoverColor = 0xffe24d;
  group.add(ch);
  handles.push(ch);
  return { group, handles };
}


function orientToAxis(group, axis, THREE) {
  if (axis === "x") group.rotation.z = -Math.PI / 2;
  else if (axis === "z") group.rotation.x = Math.PI / 2;

}


function orientPlane(mesh, normalAxis, THREE) {
  if (normalAxis === "x") mesh.rotation.y = Math.PI / 2;
  else if (normalAxis === "y") mesh.rotation.x = Math.PI / 2;

}
