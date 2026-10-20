import { bus } from "../core/eventBus.js";
import { spherecast, raycastWorkspace } from "../physics/raycast.js";
import { makeCFrame, makeVector2 } from "../datamodel/index.js";


import { rotateVecByQuat } from "../physics/mathUtils.js";


import { sanitizeQuat } from "./cframeMath.js";

const SHAKE_MAX_MAGNITUDE = 5;
const SHAKE_MAX_DURATION = 10;
const SHAKE_MAX_ACTIVE = 8;
const INVISICAM_LTM = 0.75;
const INVISICAM_MAX_PARTS = 6;
const OCCLUSION_RAY_MAX = 500;
const SCRIPTED_TYPES = new Set(["Fixed", "Scriptable", "Attach", "Watch", "Track"]);

function finite(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}


function poseQuat(pose) {
  if (!pose || pose.qw == null) return null;
  const q = sanitizeQuat({ x: pose.qx, y: pose.qy, z: pose.qz, w: pose.qw });
  if (Math.abs(q.x) < 1e-7 && Math.abs(q.y) < 1e-7 && Math.abs(q.z) < 1e-7) return null;
  return q;
}

function viewportRect() {
  if (typeof document === "undefined") return { w: 1280, h: 720 };
  const c = document.querySelector(".rsw-viewport__canvas");
  const r = c ? c.getBoundingClientRect() : null;
  return {
    w: r && r.width > 0 ? r.width : 1280,
    h: r && r.height > 0 ? r.height : 720,
  };
}

export function clampFov(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 70;
  return Math.min(120, Math.max(1, n));
}


export function toVerticalFov(fov, mode, w, h) {
  const f = (clampFov(fov) * Math.PI) / 180;
  const aspectW = Math.max(1, w);
  const aspectH = Math.max(1, h);
  let vf = f;
  if (mode === "Diagonal") {
    const diag = Math.hypot(aspectW, aspectH);
    vf = 2 * Math.atan(Math.tan(f / 2) * (aspectH / diag));
  } else if (mode === "MaxAxis" && aspectW > aspectH) {
    vf = 2 * Math.atan(Math.tan(f / 2) * (aspectH / aspectW));
  }
  return Math.min(120, Math.max(1, (vf * 180) / Math.PI));
}


export function fromVerticalFov(verticalFov, mode, w, h) {
  const f = (clampFov(verticalFov) * Math.PI) / 180;
  const aspectW = Math.max(1, w);
  const aspectH = Math.max(1, h);
  let out = f;
  if (mode === "Diagonal") {
    const diag = Math.hypot(aspectW, aspectH);
    out = 2 * Math.atan(Math.tan(f / 2) * (diag / aspectH));
  } else if (mode === "MaxAxis" && aspectW > aspectH) {
    out = 2 * Math.atan(Math.tan(f / 2) * (aspectW / aspectH));
  }
  return (out * 180) / Math.PI;
}

function cameraBasis(pose) {
  let fx = pose.tx - pose.px;
  let fy = pose.ty - pose.py;
  let fz = pose.tz - pose.pz;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-4) {

    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  return { fx, fy, fz, rx, ry: 0, rz, ux, uy, uz };
}


let sessionActive = false;
let shakes = [];
let invisicamApplied = new Set();
let scriptedState = { prevType: "", watchPos: null, trackOffset: null, trackDir: null };
let renderFov = 70;
let lastViewport = { w: 1280, h: 720 };
let offExplosion = null;
let lastSyncKey = "";

const scriptedPose = { px: 0, py: 20, pz: 20, tx: 0, ty: 0, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
const renderPose = { px: 0, py: 20, pz: 20, tx: 0, ty: 0, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
let lastBasePose = null;
const invisicamCache = { x: 0, y: 0, z: 0, valid: false };

function resolveSubjectInstance(camInst) {
  if (!camInst || typeof camInst.getProperty !== "function") return null;
  let subj = null;
  try { subj = camInst.getProperty("CameraSubject"); } catch (_) { subj = null; }
  if (!subj || subj.__isInstance !== true) return null;
  if (subj.isDestroyed && subj.isDestroyed()) return null;
  return subj;
}

function partPosition(inst) {
  try {
    const p = inst.getProperty("Position");
    if (p && Number.isFinite(p.x)) return { x: p.x, y: p.y, z: p.z };
  } catch (_) {            }
  return null;
}

export const cameraSys = {
  startSession() {
    this.endSession();
    sessionActive = true;
    shakes = [];
    scriptedState = { prevType: "", watchPos: null, trackOffset: null, trackDir: null };
    renderFov = 70;
    lastBasePose = null;
    lastSyncKey = "";
    invisicamCache.valid = false;

    offExplosion = bus.on("effects:explosionBlast", (p) => {
      if (!sessionActive || !lastBasePose || !p) return;
      const dx = finite(p.x, 0) - lastBasePose.px;
      const dy = finite(p.y, 0) - lastBasePose.py;
      const dz = finite(p.z, 0) - lastBasePose.pz;
      const dist = Math.hypot(dx, dy, dz);
      const radius = Math.max(1, finite(p.radius, 4));
      const reach = radius * 4;
      if (dist > reach) return;
      const proximity = 1 - dist / reach;
      this.addShake({
        magnitude: 0.2 + proximity * 1.4,
        frequency: 14,
        duration: 0.5 + proximity * 0.5,
        rolloff: 2,
      });
    });
  },

  endSession() {
    sessionActive = false;
    if (offExplosion) { try { offExplosion(); } catch (_) {            } offExplosion = null; }
    this.clearInvisicam();
    shakes = [];
    lastBasePose = null;
    renderFov = 70;
  },


  cameraTypeOf(camInst) {
    if (!camInst) return "Custom";
    let t = "Custom";
    try { t = String(camInst.getProperty("CameraType") || "Custom"); } catch (_) { t = "Custom"; }
    return t;
  },

  isScriptedType(camType) {
    return SCRIPTED_TYPES.has(camType);
  },


  subjectPosition(camInst, character, rootPos) {
    const subj = resolveSubjectInstance(camInst);
    if (subj) {
      if (subj.className === "Humanoid") {
        const model = typeof subj.getParent === "function" ? subj.getParent() : null;
        if (model && typeof model.findFirstChild === "function") {
          const root = model.findFirstChild("HumanoidRootPart") || model.findFirstChild("Torso");
          const p = root ? partPosition(root) : null;
          if (p) return p;
        }
      } else {
        const p = partPosition(subj);
        if (p) return p;
      }
    }
    return { x: rootPos.x, y: rootPos.y, z: rootPos.z };
  },


  updateScriptedPose(ctx) {
    const { camInst, camType } = ctx;
    if (scriptedState.prevType !== camType) {
      const seed = lastBasePose || ctx.rigPose;
      if (camType === "Fixed" || camType === "Scriptable") {


        let cf = null;
        let fo = null;
        try { cf = camInst.getProperty("CFrame"); } catch (_) { cf = null; }
        try { fo = camInst.getProperty("Focus"); } catch (_) { fo = null; }
        const atDefaults =
          cf && Math.abs(cf.x) < 1e-6 && Math.abs(cf.y - 20) < 1e-6 && Math.abs(cf.z - 20) < 1e-6 &&
          fo && Math.abs(fo.x) < 1e-6 && Math.abs(fo.y) < 1e-6 && Math.abs(fo.z) < 1e-6;
        if (atDefaults) this.writeCameraProps(camInst, seed, true);
      } else if (camType === "Watch") {
        scriptedState.watchPos = { x: seed.px, y: seed.py, z: seed.pz };
      } else if (camType === "Track") {
        const subj = this.subjectPosition(camInst, ctx.character, ctx.rootPos);
        scriptedState.trackOffset = { x: seed.px - subj.x, y: seed.py - subj.y, z: seed.pz - subj.z };
        const b = cameraBasis(seed);
        scriptedState.trackDir = { x: b.fx * 10, y: b.fy * 10, z: b.fz * 10 };
      }
      scriptedState.prevType = camType;
    }

    if (camType === "Fixed" || camType === "Scriptable") {
      let cf = null;
      let fo = null;
      try { cf = camInst.getProperty("CFrame"); } catch (_) { cf = null; }
      try { fo = camInst.getProperty("Focus"); } catch (_) { fo = null; }
      scriptedPose.px = finite(cf && cf.x, scriptedPose.px);
      scriptedPose.py = finite(cf && cf.y, scriptedPose.py);
      scriptedPose.pz = finite(cf && cf.z, scriptedPose.pz);


      const hasQuat = cf && cf.qw != null &&
        (Math.abs(cf.qx) > 1e-7 || Math.abs(cf.qy) > 1e-7 || Math.abs(cf.qz) > 1e-7);
      if (hasQuat) {
        const look = rotateVecByQuat(
          { x: 0, y: 0, z: -1 },
          { x: cf.qx, y: cf.qy, z: cf.qz, w: cf.qw },
        );
        scriptedPose.tx = scriptedPose.px + look.x * 10;
        scriptedPose.ty = scriptedPose.py + look.y * 10;
        scriptedPose.tz = scriptedPose.pz + look.z * 10;


        scriptedPose.qx = cf.qx;
        scriptedPose.qy = cf.qy;
        scriptedPose.qz = cf.qz;
        scriptedPose.qw = cf.qw;
      } else {
        scriptedPose.tx = finite(fo && fo.x, scriptedPose.tx);
        scriptedPose.ty = finite(fo && fo.y, scriptedPose.ty);
        scriptedPose.tz = finite(fo && fo.z, scriptedPose.tz);
        scriptedPose.qx = 0;
        scriptedPose.qy = 0;
        scriptedPose.qz = 0;
        scriptedPose.qw = 1;
      }
      return scriptedPose;
    }

    const subj = this.subjectPosition(camInst, ctx.character, ctx.rootPos);


    scriptedPose.qx = 0;
    scriptedPose.qy = 0;
    scriptedPose.qz = 0;
    scriptedPose.qw = 1;
    if (camType === "Attach") {
      const d = Math.max(4, finite(ctx.rigDistance, 12));
      const yaw = finite(ctx.yaw, 0);
      scriptedPose.px = subj.x - Math.sin(yaw) * d;
      scriptedPose.py = subj.y + 2 + d * 0.25;
      scriptedPose.pz = subj.z - Math.cos(yaw) * d;
      scriptedPose.tx = subj.x;
      scriptedPose.ty = subj.y + 1.5;
      scriptedPose.tz = subj.z;
    } else if (camType === "Watch") {
      const wp = scriptedState.watchPos || { x: scriptedPose.px, y: scriptedPose.py, z: scriptedPose.pz };
      scriptedPose.px = wp.x;
      scriptedPose.py = wp.y;
      scriptedPose.pz = wp.z;
      scriptedPose.tx = subj.x;
      scriptedPose.ty = subj.y + 1.5;
      scriptedPose.tz = subj.z;
    } else if (camType === "Track") {
      const off = scriptedState.trackOffset || { x: 0, y: 10, z: 10 };
      const dir = scriptedState.trackDir || { x: 0, y: -5, z: -8 };
      scriptedPose.px = subj.x + off.x;
      scriptedPose.py = subj.y + off.y;
      scriptedPose.pz = subj.z + off.z;
      scriptedPose.tx = scriptedPose.px + dir.x;
      scriptedPose.ty = scriptedPose.py + dir.y;
      scriptedPose.tz = scriptedPose.pz + dir.z;
    }
    this.writeCameraProps(camInst, scriptedPose, false);
    return scriptedPose;
  },

  getScriptedPose: () => scriptedPose,

  noteTypeForRig(camType) {


    if (scriptedState.prevType !== camType) scriptedState.prevType = camType;
  },


  writeCameraProps(camInst, pose, force) {
    if (!camInst || typeof camInst.setProperty !== "function") return;
    const q = poseQuat(pose);
    const key =
      (pose.px * 10 | 0) + "," + (pose.py * 10 | 0) + "," + (pose.pz * 10 | 0) + "|" +
      (pose.tx * 10 | 0) + "," + (pose.ty * 10 | 0) + "," + (pose.tz * 10 | 0) +
      (q ? "|" + (q.x * 1000 | 0) + "," + (q.y * 1000 | 0) + "," + (q.z * 1000 | 0) + "," + (q.w * 1000 | 0) : "");
    if (!force && key === lastSyncKey) return;
    lastSyncKey = key;
    try {
      if (camInst.hasProperty("CFrame")) {
        camInst.setProperty("CFrame", q
          ? makeCFrame(pose.px, pose.py, pose.pz, q.x, q.y, q.z, q.w)
          : makeCFrame(pose.px, pose.py, pose.pz));
      }
      if (camInst.hasProperty("Focus")) camInst.setProperty("Focus", makeCFrame(pose.tx, pose.ty, pose.tz));
    } catch (_) {            }
  },


  updateFov(camInst) {
    const vp = viewportRect();
    lastViewport = vp;
    let fov = 70;
    let mode = "Vertical";
    if (camInst) {
      try { fov = clampFov(camInst.getProperty("FieldOfView")); } catch (_) { fov = 70; }
      try { mode = String(camInst.getProperty("FieldOfViewMode") || "Vertical"); } catch (_) { mode = "Vertical"; }
      try {
        const cur = camInst.getProperty("ViewportSize");
        if (!cur || Math.abs(cur.x - vp.w) > 0.5 || Math.abs(cur.y - vp.h) > 0.5) {
          camInst._setInternal("ViewportSize", makeVector2(vp.w, vp.h));
        }
      } catch (_) {            }
    }
    renderFov = toVerticalFov(fov, mode, vp.w, vp.h);
    return renderFov;
  },

  getRenderFov: () => renderFov,
  getViewportSize: () => lastViewport,


  addShake(opts) {
    const o = opts || {};
    if (shakes.length >= SHAKE_MAX_ACTIVE) shakes.shift();
    shakes.push({
      magnitude: Math.min(SHAKE_MAX_MAGNITUDE, Math.max(0, finite(o.magnitude, 0.5))),
      frequency: Math.min(30, Math.max(1, finite(o.frequency, 10))),
      duration: Math.min(SHAKE_MAX_DURATION, Math.max(0.05, finite(o.duration, 0.5))),
      rolloff: Math.min(6, Math.max(0.25, finite(o.rolloff, 1))),
      start: Date.now(),
      sx: Math.random() * Math.PI * 2,
      sy: Math.random() * Math.PI * 2,
      sz: Math.random() * Math.PI * 2,
    });
  },

  hasShakes: () => shakes.length > 0,


  applyShake(base) {
    lastBasePose = base;
    if (!shakes.length) return base;
    const now = Date.now();
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let i = shakes.length - 1; i >= 0; i--) {
      const s = shakes[i];
      const t = (now - s.start) / 1000;
      if (t >= s.duration) { shakes.splice(i, 1); continue; }
      const env = Math.pow(1 - t / s.duration, s.rolloff);
      const w = t * s.frequency * Math.PI * 2;
      ox += Math.sin(w + s.sx) * s.magnitude * env;
      oy += Math.sin(w * 1.13 + s.sy) * s.magnitude * env * 0.6;
      oz += Math.cos(w * 0.91 + s.sz) * s.magnitude * env;
    }


    if (!shakes.length) return base;
    renderPose.px = base.px + ox;
    renderPose.py = base.py + oy;
    renderPose.pz = base.pz + oz;
    renderPose.tx = base.tx + ox;
    renderPose.ty = base.ty + oy;
    renderPose.tz = base.tz + oz;


    renderPose.qx = base.qx || 0;
    renderPose.qy = base.qy || 0;
    renderPose.qz = base.qz || 0;
    renderPose.qw = base.qw == null ? 1 : base.qw;
    return renderPose;
  },

  getLastRenderPose() {
    if (!lastBasePose) return null;
    return shakes.length ? renderPose : lastBasePose;
  },


  applyInvisicam(ws, character, pose) {
    if (!ws || !pose) return;

    if (
      invisicamCache.valid &&
      Math.abs(invisicamCache.x - pose.px) < 0.05 &&
      Math.abs(invisicamCache.y - pose.py) < 0.05 &&
      Math.abs(invisicamCache.z - pose.pz) < 0.05
    ) {
      return;
    }
    invisicamCache.x = pose.px;
    invisicamCache.y = pose.py;
    invisicamCache.z = pose.pz;
    invisicamCache.valid = true;

    const hits = new Set();
    const origin = { x: pose.tx, y: pose.ty, z: pose.tz };
    let dx = pose.px - origin.x;
    let dy = pose.py - origin.y;
    let dz = pose.pz - origin.z;
    const total = Math.min(Math.hypot(dx, dy, dz), OCCLUSION_RAY_MAX);
    if (total > 0.5) {
      const inv = 1 / (Math.hypot(dx, dy, dz) || 1);
      dx *= inv; dy *= inv; dz *= inv;
      const params = { filterType: "Exclude", filterList: character ? [character] : [] };
      let traveled = 0;
      for (let i = 0; i < INVISICAM_MAX_PARTS; i++) {
        const remaining = total - traveled;
        if (remaining <= 0.25) break;
        const from = {
          x: origin.x + dx * traveled,
          y: origin.y + dy * traveled,
          z: origin.z + dz * traveled,
        };
        let hit = null;
        try {
          hit = spherecast(ws, from, 0.35, { x: dx * remaining, y: dy * remaining, z: dz * remaining }, params);
        } catch (_) {
          hit = null;
        }
        if (!hit || !hit.instance) break;
        hits.add(hit.instance);
        params.filterList = params.filterList.concat([hit.instance]);
        traveled += Math.max(0.5, finite(hit.distance, remaining));
      }
    }

    for (const inst of hits) {
      if (!invisicamApplied.has(inst)) {
        try {
          if (inst.hasProperty && inst.hasProperty("LocalTransparencyModifier")) {
            inst.setProperty("LocalTransparencyModifier", INVISICAM_LTM);
            invisicamApplied.add(inst);
          }
        } catch (_) {            }
      }
    }
    for (const inst of [...invisicamApplied]) {
      if (hits.has(inst)) continue;
      invisicamApplied.delete(inst);
      try {
        if (inst.getParent && inst.getParent()) inst.setProperty("LocalTransparencyModifier", 0);
      } catch (_) {            }
    }
  },

  clearInvisicam() {
    for (const inst of invisicamApplied) {
      try {
        if (inst.getParent && inst.getParent()) inst.setProperty("LocalTransparencyModifier", 0);
      } catch (_) {            }
    }
    invisicamApplied.clear();
    invisicamCache.valid = false;
  },


  worldToScreenPoint(point) {
    const pose = this.getLastRenderPose();
    const vp = lastViewport;
    if (!pose) return { x: 0, y: 0, z: 0, visible: false };
    const b = cameraBasis(pose);
    const relX = finite(point.x, 0) - pose.px;
    const relY = finite(point.y, 0) - pose.py;
    const relZ = finite(point.z, 0) - pose.pz;
    const zCam = relX * b.fx + relY * b.fy + relZ * b.fz;
    const xCam = relX * b.rx + relY * b.ry + relZ * b.rz;
    const yCam = relX * b.ux + relY * b.uy + relZ * b.uz;
    const tanF = Math.tan(((renderFov * Math.PI) / 180) / 2);
    const aspect = vp.w / Math.max(1, vp.h);
    const safeZ = Math.abs(zCam) < 1e-6 ? 1e-6 : zCam;
    const sx = (xCam / (safeZ * tanF * aspect) * 0.5 + 0.5) * vp.w;
    const sy = (0.5 - yCam / (safeZ * tanF) * 0.5) * vp.h;
    const visible = zCam > 0 && sx >= 0 && sx <= vp.w && sy >= 0 && sy <= vp.h;
    return { x: sx, y: sy, z: zCam, visible };
  },

  screenPointToRay(x, y, depth) {
    const pose = this.getLastRenderPose();
    const vp = lastViewport;
    if (!pose) {
      return { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
    }
    const b = cameraBasis(pose);
    const ndcX = (finite(x, 0) / Math.max(1, vp.w)) * 2 - 1;
    const ndcY = -((finite(y, 0) / Math.max(1, vp.h)) * 2 - 1);
    const tanF = Math.tan(((renderFov * Math.PI) / 180) / 2);
    const aspect = vp.w / Math.max(1, vp.h);
    let dx = b.fx + b.rx * ndcX * tanF * aspect + b.ux * ndcY * tanF;
    let dy = b.fy + b.ry * ndcX * tanF * aspect + b.uy * ndcY * tanF;
    let dz = b.fz + b.rz * ndcX * tanF * aspect + b.uz * ndcY * tanF;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    const d = Math.max(0, finite(depth, 0));
    return {
      origin: { x: pose.px + dx * d, y: pose.py + dy * d, z: pose.pz + dz * d },
      direction: { x: dx, y: dy, z: dz },
    };
  },


  getPartsObscuringTarget(ws, castPoints, ignoreList) {
    const pose = this.getLastRenderPose();
    const out = [];
    if (!ws || !pose) return out;
    const seen = new Set();
    const baseIgnore = Array.isArray(ignoreList) ? ignoreList.slice(0, 32) : [];
    const points = castPoints.slice(0, 10);
    for (const pt of points) {
      let dx = finite(pt.x, 0) - pose.px;
      let dy = finite(pt.y, 0) - pose.py;
      let dz = finite(pt.z, 0) - pose.pz;
      const len = Math.min(Math.hypot(dx, dy, dz), OCCLUSION_RAY_MAX);
      if (len < 0.05) continue;
      const inv = 1 / (Math.hypot(dx, dy, dz) || 1);
      dx *= inv; dy *= inv; dz *= inv;
      const params = { filterType: "Exclude", filterList: baseIgnore.slice() };
      let traveled = 0;
      for (let i = 0; i < 8; i++) {
        const remaining = len - traveled;
        if (remaining <= 0.1) break;
        const from = {
          x: pose.px + dx * traveled,
          y: pose.py + dy * traveled,
          z: pose.pz + dz * traveled,
        };
        let hit = null;
        try {
          hit = raycastWorkspace(ws, from, { x: dx * remaining, y: dy * remaining, z: dz * remaining }, params);
        } catch (_) {
          hit = null;
        }
        if (!hit || !hit.instance) break;
        if (!seen.has(hit.instance)) {
          seen.add(hit.instance);
          out.push(hit.instance);
          if (out.length >= 50) return out;
        }
        params.filterList = params.filterList.concat([hit.instance]);
        traveled += Math.max(0.5, finite(hit.distance, remaining));
      }
    }
    return out;
  },


  zoomToExtents(camInst, center, size) {
    const pose = this.getLastRenderPose() || scriptedPose;
    const b = cameraBasis(pose);
    const maxAxis = Math.max(finite(size.x, 1), finite(size.y, 1), finite(size.z, 1), 0.5);
    const tanF = Math.tan(((renderFov * Math.PI) / 180) / 2);
    const dist = (maxAxis / 2) / Math.max(0.05, tanF) * 1.2 + maxAxis / 2;
    const target = {
      px: finite(center.x, 0) - b.fx * dist,
      py: finite(center.y, 0) - b.fy * dist,
      pz: finite(center.z, 0) - b.fz * dist,
      tx: finite(center.x, 0),
      ty: finite(center.y, 0),
      tz: finite(center.z, 0),
    };
    this.writeCameraProps(camInst, target, true);
    scriptedPose.px = target.px; scriptedPose.py = target.py; scriptedPose.pz = target.pz;
    scriptedPose.tx = target.tx; scriptedPose.ty = target.ty; scriptedPose.tz = target.tz;

    scriptedPose.qx = 0; scriptedPose.qy = 0; scriptedPose.qz = 0; scriptedPose.qw = 1;
    return target;
  },
};
