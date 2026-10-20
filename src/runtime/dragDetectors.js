import { bus } from "../core/eventBus.js";

import { registerFrameCallback } from "../core/frameDriver.js";

import { createListenerScope } from "../core/listenerScope.js";
import { logger as baseLogger } from "../core/logger.js";
import { getProjection } from "../viewport/projection.js";
import { raycastWorkspace } from "../physics/raycast.js";
import { makeVector3 } from "../datamodel/types.js";
import { engine } from "./engine.js";
import { streaming } from "./streaming.js";

const HOVER_HZ = 30;
const CONTINUE_HZ = 30;
const FORCE_CAP = 100000;
const TORQUE_CAP = 100000;
const SPRING = 14;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let active = false;
let dm = null;
let getChar = null;
let getPlayer = null;
let log = baseLogger;
let unregisterFrameCallback = null;


const pointerListeners = createListenerScope("dragDetectors");
let mouse = { x: 0, y: 0 };
let mouseMoved = false;
let lastHoverAt = 0;
let hoverDD = null;
let drag = null;
let cursorHost = null;
let savedCursor = "";

function workspace() {
  if (!dm) return null;
  return dm.getChildren().find((c) => c.className === "Workspace") || null;
}

function isInst(x) {
  return !!(x && typeof x.isDestroyed === "function" && !x.isDestroyed());
}

function isBasePart(inst) {
  return !!(inst && inst.hasProperty && inst.hasProperty("Size") && inst.hasProperty("Anchored"));
}

function fire(inst, type, args) {
  bus.emit("gameplay:event", { instance: inst, type, args: args || [] });
}

function findDragDetector(inst) {
  let cur = inst;
  let depth = 0;
  while (cur && depth < 6) {
    if (cur.getChildren) {
      const dd = cur.getChildren().find((c) => c.className === "DragDetector" && !c.isDestroyed());
      if (dd && isBasePart(cur)) return { detector: dd, host: cur };
    }
    cur = cur.getParent ? cur.getParent() : null;
    depth += 1;
  }
  return null;
}

function usable(dd) {
  if (!isInst(dd)) return false;
  if (dd.getProperty("Enabled") !== true) return false;
  if (String(dd.getProperty("PermissionPolicy")) === "Nobody") return false;
  return true;
}


function isStreamedIn(inst) {
  try {
    return streaming.isLoadedForActive(inst);
  } catch (_e) {
    return true;
  }
}

function screenRay() {
  const proj = getProjection();
  if (!proj || typeof proj.screenToRay !== "function") return null;
  return proj.screenToRay(mouse.x, mouse.y);
}

function castFromMouse() {
  const ray = screenRay();
  const ws = workspace();
  if (!ray || !ws) return null;
  const char = getChar && getChar();
  const params = { filterType: "Exclude", filterList: char ? [char] : [], ignoreWater: true };
  return raycastWorkspace(ws, ray.origin, ray.dir, params);
}

function setCursor(style) {
  const proj = getProjection();
  const host = proj && proj.container;
  if (!host) return;
  if (cursorHost !== host) {
    cursorHost = host;
    savedCursor = host.style.cursor || "";
  }
  host.style.cursor = style && style.startsWith("rbxasset") ? "grab" : (style || savedCursor || "");
}

function vec(v, fb) {
  if (v && Number.isFinite(v.x)) return { x: v.x, y: v.y, z: v.z };
  return fb;
}

function normalize(v) {
  const m = Math.hypot(v.x, v.y, v.z);
  if (m < 1e-8) return { x: 0, y: 1, z: 0 };
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function mul(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function len(a) { return Math.hypot(a.x, a.y, a.z); }

function rayPlane(ray, planePoint, planeNormal) {
  const denom = dot(ray.dir, planeNormal);
  if (Math.abs(denom) < 1e-6) return null;
  const t = dot(sub(planePoint, ray.origin), planeNormal) / denom;
  if (t < 0) return null;
  return add(ray.origin, mul(ray.dir, t));
}

function rayLineClosest(ray, linePoint, lineDir) {
  const w0 = sub(ray.origin, linePoint);
  const a = dot(ray.dir, ray.dir);
  const b = dot(ray.dir, lineDir);
  const c = dot(lineDir, lineDir);
  const d = dot(ray.dir, w0);
  const e = dot(lineDir, w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-8) return linePoint;
  const s = (a * e - b * d) / denom;
  return add(linePoint, mul(lineDir, s));
}

function resolveStyle(dd) {
  const s = String(dd.getProperty("DragStyle") || "TranslatePlaneOrLine");
  return s === "BestForDevice" ? "TranslatePlaneOrLine" : s;
}

function dragAxis(dd) {
  const ref = dd.getProperty("ReferenceInstance");
  const axis = normalize(vec(dd.getProperty("Axis"), { x: 0, y: 1, z: 0 }));
  if (isInst(ref) && isBasePart(ref)) {
    const rot = vec(ref.getProperty("Rotation"), { x: 0, y: 0, z: 0 });
    const rx = (rot.x * Math.PI) / 180, ry = (rot.y * Math.PI) / 180, rz = (rot.z * Math.PI) / 180;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    const m = [
      [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
      [cx * sz, cx * cz, -sx],
      [-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
    ];
    return normalize({
      x: m[0][0] * axis.x + m[0][1] * axis.y + m[0][2] * axis.z,
      y: m[1][0] * axis.x + m[1][1] * axis.y + m[1][2] * axis.z,
      z: m[2][0] * axis.x + m[2][1] * axis.y + m[2][2] * axis.z,
    });
  }
  return axis;
}

function rayArgs(ray) {
  return [makeVector3(ray.origin.x, ray.origin.y, ray.origin.z), makeVector3(ray.dir.x, ray.dir.y, ray.dir.z)];
}

function updateHover() {
  const t = now();
  if (drag || t - lastHoverAt < 1000 / HOVER_HZ || !mouseMoved) return;
  lastHoverAt = t;
  mouseMoved = false;
  const player = getPlayer && getPlayer();
  let found = null;
  const hit = castFromMouse();
  if (hit && hit.instance) {
    const res = findDragDetector(hit.instance);
    if (res && usable(res.detector) && isStreamedIn(res.host)) found = res.detector;
  }
  if (hoverDD && isInst(hoverDD) && !isStreamedIn(hoverDD)) {
    fire(hoverDD, "MouseHoverLeave", [player]);
    hoverDD = null;
    setCursor("");
  }
  if (found === hoverDD) return;
  if (hoverDD && isInst(hoverDD)) fire(hoverDD, "MouseHoverLeave", [player]);
  hoverDD = found;
  setCursor(found ? String(found.getProperty("CursorIcon") || "") || "grab" : "");
  if (hoverDD) fire(hoverDD, "MouseHoverEnter", [player]);
}

function beginDrag(e) {
  const hit = castFromMouse();
  if (!hit || !hit.instance) return;
  const res = findDragDetector(hit.instance);
  if (!res || !usable(res.detector) || !isStreamedIn(res.host)) return;
  const dd = res.detector;
  const part = res.host;
  const ray = screenRay();
  if (!ray) return;
  const style = resolveStyle(dd);
  const scriptOnly =
    String(dd.getProperty("PermissionPolicy")) === "Scriptable" ||
    String(dd.getProperty("ResponseStyle")) === "Custom" ||
    style === "Scriptable";
  const startPos = vec(part.getProperty("Position"), { x: 0, y: 0, z: 0 });
  const startRot = vec(part.getProperty("Rotation"), { x: 0, y: 0, z: 0 });
  const axis = dragAxis(dd);
  const proj = getProjection();
  const camFwd = proj && typeof proj.cameraForward === "function" ? normalize(proj.cameraForward()) : normalize(ray.dir);
  drag = {
    dd, part, style, scriptOnly,
    startPos, startRot,
    grabOffset: sub(hit.position, startPos),
    planePoint: { ...hit.position },
    axis,
    camNormal: camFwd,
    lastContinueAt: 0,
    startMouse: { x: e.clientX, y: e.clientY },
    angleApplied: 0,
    useLine: style === "TranslateLine" || (style === "TranslatePlaneOrLine" && e.shiftKey === true),
  };
  setCursor(String(dd.getProperty("ActivatedCursorIcon") || dd.getProperty("CursorIcon") || "") || "grabbing");
  fire(dd, "DragStart", [getPlayer && getPlayer(), ...rayArgs(ray)]);
}

function planeNormalFor(d) {
  if (d.style === "TranslateViewPlane") return d.camNormal;
  return d.axis;
}

function applyTranslate(d, target) {
  let desired = sub(target, d.grabOffset);
  const maxT = num(d.dd.getProperty("MaxDragTranslation"), 0);
  if (maxT > 0) {
    const off = sub(desired, d.startPos);
    const dist = len(off);
    if (dist > maxT) desired = add(d.startPos, mul(off, maxT / dist));
  }
  const response = String(d.dd.getProperty("ResponseStyle") || "Geometric");
  if (response === "Physical") {
    const pw = engine.getPhysics && engine.getPhysics();
    if (pw && typeof pw.applyImpulse === "function") {
      const cur = vec(d.part.getProperty("Position"), d.startPos);


      const tImp = now();
      const dtImp = d.lastImpulseAt ? clampN((tImp - d.lastImpulseAt) / 1000, 0, 1 / 30) : 1 / 60;
      d.lastImpulseAt = tImp;
      const wanted = mul(sub(desired, cur), SPRING * 60 * dtImp);
      const maxF = clampN(num(d.dd.getProperty("MaxForce"), 10000), 0, FORCE_CAP);
      const mag = len(wanted);
      const capImp = maxF * dtImp;
      const impulse = mag > capImp ? mul(wanted, capImp / mag) : wanted;
      const v3 = makeVector3(impulse.x, impulse.y, impulse.z);
      if (d.dd.getProperty("ApplyAtCenterOfMass") === true || typeof pw.applyImpulseAtPosition !== "function") {
        pw.applyImpulse(d.part, v3);
      } else {
        const at = add(vec(d.part.getProperty("Position"), d.startPos), d.grabOffset);
        pw.applyImpulseAtPosition(d.part, v3, makeVector3(at.x, at.y, at.z));
      }
      return;
    }
  }
  d.part.setProperty("Position", makeVector3(desired.x, desired.y, desired.z));
}

function applyRotate(d, e) {
  const dx = (e.clientX - d.startMouse.x) * 0.5;
  const dy = (e.clientY - d.startMouse.y) * 0.5;
  const maxA = num(d.dd.getProperty("MaxDragAngle"), 0);
  const response = String(d.dd.getProperty("ResponseStyle") || "Geometric");
  if (d.style === "RotateAxis") {
    let angle = dx;
    if (maxA > 0) angle = clampN(angle, -Math.abs(maxA), Math.abs(maxA));
    if (response === "Physical") {
      const pw = engine.getPhysics && engine.getPhysics();
      if (pw && typeof pw.applyAngularImpulse === "function") {
        const delta = angle - d.angleApplied;


        const tImp = now();
        const dtImp = d.lastImpulseAt ? clampN((tImp - d.lastImpulseAt) / 1000, 0, 1 / 30) : 1 / 60;
        d.lastImpulseAt = tImp;
        const maxTq = clampN(num(d.dd.getProperty("MaxTorque"), 10000), 0, TORQUE_CAP);
        const capTq = maxTq * dtImp;
        const tq = clampN(delta * 2, -capTq, capTq);
        pw.applyAngularImpulse(d.part, makeVector3(d.axis.x * tq, d.axis.y * tq, d.axis.z * tq));
        d.angleApplied = angle;
        return;
      }
    }
    const rot = { ...d.startRot };
    rot.x += d.axis.x * angle;
    rot.y += d.axis.y * angle;
    rot.z += d.axis.z * angle;
    d.part.setProperty("Rotation", makeVector3(rot.x, rot.y, rot.z));
  } else {
    let yaw = dx;
    let pitch = dy;
    if (maxA > 0) {
      yaw = clampN(yaw, -Math.abs(maxA), Math.abs(maxA));
      pitch = clampN(pitch, -Math.abs(maxA), Math.abs(maxA));
    }
    d.part.setProperty(
      "Rotation",
      makeVector3(d.startRot.x + pitch, d.startRot.y + yaw, d.startRot.z),
    );
  }
}

function moveDrag(e) {
  if (!drag) return;
  const d = drag;
  if (!isInst(d.dd) || !isInst(d.part)) {
    drag = null;
    setCursor("");
    return;
  }
  if (!isStreamedIn(d.part)) {
    endDrag();
    return;
  }
  const ray = screenRay();
  if (!ray) return;
  if (!d.scriptOnly) {
    if (d.style === "RotateAxis" || d.style === "RotateTrackball") {
      applyRotate(d, e);
    } else {
      let target = null;
      if (d.useLine) {
        target = rayLineClosest(ray, d.planePoint, d.axis);
      } else {
        target = rayPlane(ray, d.planePoint, planeNormalFor(d));
      }
      if (target) applyTranslate(d, target);
    }
  }
  const t = now();
  if (t - d.lastContinueAt >= 1000 / CONTINUE_HZ) {
    d.lastContinueAt = t;
    fire(d.dd, "DragContinue", [getPlayer && getPlayer(), ...rayArgs(ray)]);
  }
}

function endDrag() {
  if (!drag) return;
  const dd = drag.dd;
  drag = null;
  setCursor("");
  if (isInst(dd)) fire(dd, "DragEnd", [getPlayer && getPlayer()]);
}

function onPointerMove(e) {
  mouse = { x: e.clientX, y: e.clientY };
  mouseMoved = true;
  if (drag) moveDrag(e);
}

function onPointerDown(e) {
  if (e.button !== 0 || drag) return;
  mouse = { x: e.clientX, y: e.clientY };
  beginDrag(e);
  if (drag) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function onPointerUp(e) {
  if (e.button !== 0) return;
  endDrag();
}

function tick() {
  if (!active) return;
  if (drag && (!isInst(drag.part) || !isStreamedIn(drag.part))) endDrag();
  if (!drag && hoverDD && isInst(hoverDD) && !isStreamedIn(hoverDD)) {
    fire(hoverDD, "MouseHoverLeave", [getPlayer && getPlayer()]);
    hoverDD = null;
    setCursor("");
  }
  updateHover();
}

export const dragDetectors = {
  start(opts = {}) {
    if (active) this.stop();
    active = true;
    dm = opts.dataModel || null;
    getChar = opts.getCharacter || null;
    getPlayer = opts.getLocalPlayer || null;
    log = opts.logger || baseLogger;
    hoverDD = null;
    drag = null;
    if (typeof window !== "undefined") {
      pointerListeners.add(window, "pointermove", onPointerMove, true);
      pointerListeners.add(window, "pointerdown", onPointerDown, true);
      pointerListeners.add(window, "pointerup", onPointerUp, true);
    }
    unregisterFrameCallback = registerFrameCallback("input", tick, "dragDetectors:hoverAndDrag");
  },

  stop() {
    if (!active) return;
    active = false;
    if (unregisterFrameCallback) {
      unregisterFrameCallback();
      unregisterFrameCallback = null;
    }
    pointerListeners.disposeAll();
    endDrag();
    if (hoverDD && isInst(hoverDD)) fire(hoverDD, "MouseHoverLeave", [getPlayer && getPlayer()]);
    hoverDD = null;
    setCursor("");
    dm = null;
    getChar = null;
    getPlayer = null;
  },
};
