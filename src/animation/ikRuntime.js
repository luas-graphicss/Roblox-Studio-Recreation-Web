import { logger } from "../core/logger.js";
import { sanitizeBoneTransform } from "../assets/skinRegistry.js";


import {
  composeBoneCF,
  isIdentityQuat,
  mulBoneCF,
  quatConj,
  quatFromEulerDeg,
  quatMul,
  rotateVec,
} from "./boneCFrame.js";
import { makeVector3 } from "../datamodel/index.js";
import {
  clampWeight,
  clampSmoothTime,
  clampPriority,
  smoothFactor,
  solveChain,
  lookAtConeAngles,
  vDist,
  IK_MAX_CHAIN,
  IK_MAX_CONTROLS,
  IK_LOD_SKIP_DISTANCE,
  IK_LOD_SLOW_DISTANCE,
} from "./ikSolver.js";

const RAD2DEG = 180 / Math.PI;


const SCAN_MS = 400;

let scanAt = 0;
let excludedRig = null;                                             
let scanList = [];
let lastTs = 0;
let frameNo = 0;
let applying = false;
const smoothState = new Map();                         
const warned = new Set();

const pointsScratch = [];

function live(inst) {
  return !!(
    inst &&
    inst.__isInstance === true &&
    !(typeof inst.isDestroyed === "function" && inst.isDestroyed())
  );
}

function isBone(inst) {
  return live(inst) && inst.className === "Bone";
}

function isBasePart(inst) {
  return live(inst) && typeof inst.hasProperty === "function" && inst.hasProperty("Anchored");
}

function getVec(inst, prop) {
  let v = null;
  try {
    v = inst.getProperty(prop);
  } catch (_) {
    v = null;
  }
  v = v || {};
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}

function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  try {
    logger.warn(msg, { source: "IKControl" });
  } catch (_) {

  }
}


export function isIKApplying() {
  return applying;
}


export function setIKExcludedRig(rig) {
  excludedRig = rig || null;
}

function hostPartOf(node) {
  let n = node;
  let g = 0;
  while (n && !isBasePart(n) && g < 64) {
    n = n.getParent ? n.getParent() : null;
    g += 1;
  }
  return isBasePart(n) ? n : null;
}

function partScale(part) {
  if (!part || !part.hasProperty || !part.hasProperty("MeshSize")) return { x: 1, y: 1, z: 1 };
  const size = getVec(part, "Size");
  const ms = getVec(part, "MeshSize");
  return {
    x: ms.x > 1e-6 ? size.x / ms.x : 1,
    y: ms.y > 1e-6 ? size.y / ms.y : 1,
    z: ms.z > 1e-6 ? size.z / ms.z : 1,
  };
}


function boneLocalPose(n) {
  const t = sanitizeBoneTransform(n.getProperty("Transform"));
  return { t, q: quatMul(quatFromEulerDeg(getVec(n, "TransformRotation")), t) };
}


export function ikWorldCFOf(inst) {
  if (!live(inst)) return null;
  if (isBasePart(inst)) return composeBoneCF(getVec(inst, "Position"), null);
  if (!inst.hasProperty || !inst.hasProperty("Position")) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  let acc = null;
  let rotated = false;
  let n = inst;
  let g = 0;
  while (n && !isBasePart(n) && g < 64) {
    let px = 0;
    let py = 0;
    let pz = 0;
    let q = null;
    if (n.hasProperty && n.hasProperty("Position")) {
      const p = getVec(n, "Position");
      x += p.x;
      y += p.y;
      z += p.z;
      px = p.x;
      py = p.y;
      pz = p.z;
    }
    if (n.className === "Bone") {
      const local = boneLocalPose(n);
      x += local.t.x;
      y += local.t.y;
      z += local.t.z;
      px += local.t.x;
      py += local.t.y;
      pz += local.t.z;
      q = local.q;
      if (!rotated && !isIdentityQuat(q)) rotated = true;
    }
    const cf = composeBoneCF({ x: px, y: py, z: pz }, q);
    acc = acc ? mulBoneCF(cf, acc) : cf;
    n = n.getParent ? n.getParent() : null;
    g += 1;
  }
  if (!acc) acc = composeBoneCF({ x: 0, y: 0, z: 0 }, null);
  const fx = rotated ? acc.x : x;
  const fy = rotated ? acc.y : y;
  const fz = rotated ? acc.z : z;
  if (!isBasePart(n)) {
    return { x: fx, y: fy, z: fz, qx: acc.qx, qy: acc.qy, qz: acc.qz, qw: acc.qw };
  }
  const s = partScale(n);
  const pp = getVec(n, "Position");
  return {
    x: pp.x + fx * s.x,
    y: pp.y + fy * s.y,
    z: pp.z + fz * s.z,
    qx: acc.qx,
    qy: acc.qy,
    qz: acc.qz,
    qw: acc.qw,
  };
}


export function ikWorldPosOf(inst) {
  const cf = ikWorldCFOf(inst);
  return cf ? { x: cf.x, y: cf.y, z: cf.z } : null;
}

function isAncestorOf(anc, node) {
  let n = node;
  let g = 0;
  while (n && g < 128) {
    if (n === anc) return true;
    n = n.getParent ? n.getParent() : null;
    g += 1;
  }
  return false;
}


export function buildBoneChain(ctl) {
  const eff = ctl.getProperty("EndEffector");
  if (!isBone(eff)) return null;
  const root = ctl.getProperty("ChainRoot");
  const rootIsBone = isBone(root);
  const rootIsPart = !rootIsBone && isBasePart(root);
  const chain = [eff];
  let n = eff;
  let g = 0;
  while (g <= IK_MAX_CHAIN + 1) {
    if (rootIsBone && n === root) break;
    const p = n.getParent ? n.getParent() : null;
    if (!isBone(p)) break;
    chain.unshift(p);
    n = p;
    g += 1;
  }
  if (rootIsBone && chain[0] !== root) return { invalid: true };
  if (rootIsPart && !isAncestorOf(root, eff)) return { invalid: true };
  if (chain.length > IK_MAX_CHAIN) return { invalid: true };
  if (chain.length < 2) return null;
  return { chain };
}

function smoothedTarget(ctl, targetPos, effPos, dt) {
  const st = clampSmoothTime(ctl.getProperty("SmoothTime"));
  const f = smoothFactor(st, dt);
  const id = String(ctl.id || "");
  let sm = smoothState.get(id);
  if (!sm) {
    sm = {
      x: effPos ? effPos.x : targetPos.x,
      y: effPos ? effPos.y : targetPos.y,
      z: effPos ? effPos.z : targetPos.z,
    };
    smoothState.set(id, sm);
  }
  sm.x += (targetPos.x - sm.x) * f;
  sm.y += (targetPos.y - sm.y) * f;
  sm.z += (targetPos.z - sm.z) * f;
  return sm;
}

function normDeg(a) {
  let r = a;
  while (r > 180) r -= 360;
  while (r < -180) r += 360;
  return r;
}

function applyLookAt(eff, tp, weight) {
  const effPos = ikWorldPosOf(eff);
  if (!effPos) return;
  const dx = tp.x - effPos.x;
  const dy = tp.y - effPos.y;
  const dz = tp.z - effPos.z;
  const horiz = Math.hypot(dx, dz);

  const host = hostPartOf(eff);
  const hostYaw = host ? getVec(host, "Rotation").y : 0;
  let yawDeg = normDeg(Math.atan2(dx, dz) * RAD2DEG - hostYaw);
  let pitchDeg = Math.atan2(dy, Math.max(horiz, 1e-6)) * RAD2DEG;


  const cone = lookAtConeAngles(yawDeg, pitchDeg);
  yawDeg = cone.yaw;
  pitchDeg = cone.pitch;
  const old = getVec(eff, "TransformRotation");


  eff._setInternal("TransformRotation", makeVector3(
    old.x + normDeg(-pitchDeg - old.x) * weight,
    old.y + normDeg(yawDeg - old.y) * weight,
    old.z + normDeg(0 - old.z) * weight,
  ));
}

function applyRotationTo(eff, target, weight) {
  if (!target || !target.hasProperty) return;

  const prop = target.hasProperty("Orientation") ? "Orientation" : target.hasProperty("Rotation") ? "Rotation" : null;
  if (!prop) return;
  const to = getVec(target, prop);
  const old = getVec(eff, "TransformRotation");


  eff._setInternal("TransformRotation", makeVector3(
    old.x + normDeg(to.x - old.x) * weight,
    old.y + normDeg(to.y - old.y) * weight,
    old.z + normDeg(to.z - old.z) * weight,
  ));
}

function processControl(ctl, dt) {
  applying = true;
  try {
    processControlInner(ctl, dt);
  } finally {
    applying = false;
  }
}

function processControlInner(ctl, dt) {
  if (ctl.getProperty("Enabled") === false) return;
  const weight = clampWeight(ctl.getProperty("Weight"));
  if (weight <= 0) return;                
  const target = ctl.getProperty("Target");
  if (!live(target)) return;                                            
  const eff = ctl.getProperty("EndEffector");
  if (!live(eff)) return;

  const typeName = String(ctl.getProperty("Type") || "Transform");
  const rawTarget = ikWorldPosOf(target);
  if (!rawTarget) return;
  const off = getVec(ctl, "Offset");
  const tpRaw = { x: rawTarget.x + off.x, y: rawTarget.y + off.y, z: rawTarget.z + off.z };
  const effPosNow = ikWorldPosOf(eff);
  const tp = smoothedTarget(ctl, tpRaw, effPosNow, dt);

  if (typeName === "LookAt") {
    if (isBone(eff)) applyLookAt(eff, tp, weight);
    return;
  }
  if (typeName === "Rotation") {
    if (isBone(eff)) applyRotationTo(eff, target, weight);
    return;
  }


  const built = buildBoneChain(ctl);
  if (!built) return;                                                     
  if (built.invalid) {
    warnOnce(
      "chain:" + String(ctl.id),
      "IKControl: EndEffector nao e descendente do ChainRoot (ou cadeia acima de " + IK_MAX_CHAIN + " elos) - controle desativado.",
    );
    return;
  }
  const chain = built.chain;
  const host = hostPartOf(chain[0]);
  if (!host) return;

  pointsScratch.length = 0;
  for (const b of chain) {
    const wp = ikWorldPosOf(b);
    if (!wp) return;
    pointsScratch.push(wp);
  }

  const pole = ctl.getProperty("Pole");
  const polePos = live(pole) ? ikWorldPosOf(pole) : null;
  solveChain(pointsScratch, tp, polePos);


  const s = partScale(host);
  const hp = getVec(host, "Position");
  let prevSx = (pointsScratch[0].x - hp.x) / (s.x || 1);
  let prevSy = (pointsScratch[0].y - hp.y) / (s.y || 1);
  let prevSz = (pointsScratch[0].z - hp.z) / (s.z || 1);
  for (let i = 1; i < chain.length; i += 1) {
    const bone = chain[i];
    const sx = (pointsScratch[i].x - hp.x) / (s.x || 1);
    const sy = (pointsScratch[i].y - hp.y) / (s.y || 1);
    const sz = (pointsScratch[i].z - hp.z) / (s.z || 1);


    const parentCF = ikWorldCFOf(chain[i - 1]);
    const d = parentCF && !isIdentityQuat(parentCF)
      ? rotateVec(quatConj(parentCF), { x: sx - prevSx, y: sy - prevSy, z: sz - prevSz })
      : { x: sx - prevSx, y: sy - prevSy, z: sz - prevSz };
    const rest = getVec(bone, "Position");
    const desired = { x: d.x - rest.x, y: d.y - rest.y, z: d.z - rest.z };
    const old = sanitizeBoneTransform(bone.getProperty("Transform"));


    bone._setInternal("Transform", sanitizeBoneTransform({
      x: old.x + (desired.x - old.x) * weight,
      y: old.y + (desired.y - old.y) * weight,
      z: old.z + (desired.z - old.z) * weight,
      qx: old.qx,
      qy: old.qy,
      qz: old.qz,
      qw: old.qw,
    }));
    prevSx = sx;
    prevSy = sy;
    prevSz = sz;
  }


  if (typeName === "Transform" && isBone(eff)) applyRotationTo(eff, target, weight);
}

function validParentOf(ctl) {
  const p = ctl.getParent ? ctl.getParent() : null;
  return !!(p && (p.className === "Humanoid" || p.className === "Animator"));
}


export function collectIKControls(rootInst) {
  if (!rootInst || typeof rootInst.getDescendants !== "function") return [];
  const all = rootInst.getDescendants().filter((d) => d.className === "IKControl" && validParentOf(d));


  all.sort((a, b) => clampPriority(a.getProperty("Priority")) - clampPriority(b.getProperty("Priority")));

  const byRig = new Map();
  const kept = [];
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const ctl = all[i];


    const par = ctl.getParent();
    const rigNode = par && par.className === "Animator" && par.getParent ? par.getParent() || par : par;
    const rigKey = String((rigNode && rigNode.id) || "rig");
    const cnt = byRig.get(rigKey) || 0;
    if (cnt >= IK_MAX_CONTROLS) {
      warnOnce("cap:" + rigKey, `IKControl: limite de ${IK_MAX_CONTROLS} controles ativos por rig atingido - os de menor Priority foram ignorados.`);
      continue;
    }
    byRig.set(rigKey, cnt + 1);
    kept.push(ctl);
  }
  kept.reverse();
  return kept;
}


export function updateIK(opts) {
  const dataModel = opts && opts.dataModel;
  if (!dataModel || typeof dataModel.findFirstChild !== "function") return;
  const now = Date.now();
  const dt = lastTs ? Math.min(Math.max((now - lastTs) / 1000, 0.001), 0.1) : 1 / 60;
  lastTs = now;
  frameNo += 1;

  if (now - scanAt > SCAN_MS) {
    scanAt = now;
    const ws = dataModel.findFirstChild("Workspace");
    scanList = ws ? collectIKControls(ws) : [];
    if (smoothState.size > 512) smoothState.clear();                           
  }
  if (!scanList.length) return;

  const camPos = opts.cameraPos || null;
  let camDir = null;
  if (camPos && opts.cameraTarget) {
    const dx = opts.cameraTarget.x - camPos.x;
    const dy = opts.cameraTarget.y - camPos.y;
    const dz = opts.cameraTarget.z - camPos.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    camDir = { x: dx / l, y: dy / l, z: dz / l };
  }

  for (const ctl of scanList) {
    if (!live(ctl)) continue;
    if (excludedRig && isAncestorOf(excludedRig, ctl)) continue;                 
    let effDt = dt;
    if (camPos) {
      const eff = ctl.getProperty("EndEffector");
      const ep = live(eff) ? ikWorldPosOf(eff) : null;
      if (ep) {
        const dist = vDist(camPos, ep);
        if (dist > IK_LOD_SKIP_DISTANCE) continue;                       
        if (camDir && dist > 8) {
          const dot =
            (ep.x - camPos.x) * camDir.x +
            (ep.y - camPos.y) * camDir.y +
            (ep.z - camPos.z) * camDir.z;
          if (dot < 0) continue;                                     
        }
        if (dist > IK_LOD_SLOW_DISTANCE) {
          if (frameNo % 3 !== 0) continue;                     


          effDt = dt * 3;
        }
      }
    }
    try {
      processControl(ctl, effDt);
    } catch (_) {

    }
  }
}


export function updateIKForRig(rigInst, dt) {
  const list = collectIKControls(rigInst);
  for (const ctl of list) {
    try {
      processControl(ctl, Number.isFinite(dt) && dt > 0 ? dt : 1 / 30);
    } catch (_) {

    }
  }
  return list.length;
}

export function clearIKState() {
  smoothState.clear();
  scanList = [];
  scanAt = 0;
  lastTs = 0;
  frameNo = 0;
}
