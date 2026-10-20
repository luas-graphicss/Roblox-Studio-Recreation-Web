import {
  sanitizeQuat,
  quatMultiply,
  quatConjugate,
  rotateVecByQuat,
  quatToMatrix,
  quatFromMatrixRows,
} from "./cframeMath.js";

export const GRIP_VERSION = "tool-grip-1";

export const GRIP_DEFAULTS = Object.freeze({
  pos: Object.freeze({ x: 0, y: 0, z: 0 }),
  forward: Object.freeze({ x: 0, y: 0, z: -1 }),
  right: Object.freeze({ x: 1, y: 0, z: 0 }),
  up: Object.freeze({ x: 0, y: 1, z: 0 }),
});


const FIX_TOL = 1e-6;

const LEN_EPS = 1e-9;


const isFin = (n) => typeof n === "number" && Number.isFinite(n);
const isFinVec = (v) =>
  !!v && typeof v === "object" && isFin(v.x) && isFin(v.y) && isFin(v.z);
const vClone = (v) => ({ x: v.x, y: v.y, z: v.z });
const vDot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const vCross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const vScale = (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s });
const vSub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vAdd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vLen = (v) => Math.hypot(v.x, v.y, v.z);
const vNormOrNull = (v) => {
  const l = vLen(v);
  return l > LEN_EPS ? vScale(v, 1 / l) : null;
};
const vMaxDiff = (a, b) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));

const sanVec3 = (o) => ({
  x: isFin(o && o.x) ? o.x : 0,
  y: isFin(o && o.y) ? o.y : 0,
  z: isFin(o && o.z) ? o.z : 0,
});

function defaultsFixed() {
  return {
    forward: vClone(GRIP_DEFAULTS.forward),
    right: vClone(GRIP_DEFAULTS.right),
    up: vClone(GRIP_DEFAULTS.up),
    fixed: true,
  };
}


const cfQuat = (cf) =>
  sanitizeQuat(cf ? { x: cf.qx, y: cf.qy, z: cf.qz, w: cf.qw } : null);
const packCF = (pos, q) => ({
  x: pos.x,
  y: pos.y,
  z: pos.z,
  qx: q.x,
  qy: q.y,
  qz: q.z,
  qw: q.w,
});


export function orthonormalizeGrip(grip) {
  const g = grip || {};
  if (!isFinVec(g.right) || !isFinVec(g.up) || !isFinVec(g.forward)) {
    return defaultsFixed();
  }
  const right = vNormOrNull(g.right);
  if (!right) return defaultsFixed();
  const up = vNormOrNull(vSub(g.up, vScale(right, vDot(g.up, right))));
  if (!up) return defaultsFixed();
  const forward = vScale(vCross(right, up), -1);
  const fixed =
    vMaxDiff(right, g.right) > FIX_TOL ||
    vMaxDiff(up, g.up) > FIX_TOL ||
    vMaxDiff(forward, g.forward) > FIX_TOL;
  return { forward, right, up, fixed };
}


export function gripToCFrame(grip) {
  const g = grip || {};
  const b = orthonormalizeGrip(g);
  const pos = sanVec3(g.pos);

  let q = quatFromMatrixRows([
    b.right.x, b.up.x, -b.forward.x,
    b.right.y, b.up.y, -b.forward.y,
    b.right.z, b.up.z, -b.forward.z,
  ]);

  if (q.w < 0) q = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  return packCF(pos, q);
}


export function cframeToGrip(cf) {
  const q = cfQuat(cf);
  const m = quatToMatrix(q);
  return {
    pos: sanVec3(cf),
    forward: { x: -m[2], y: -m[5], z: -m[8] },
    right: { x: m[0], y: m[3], z: m[6] },
    up: { x: m[1], y: m[4], z: m[7] },
  };
}


function cfInverse(cf) {
  const qi = quatConjugate(cfQuat(cf));
  const p = sanVec3(cf);
  return packCF(rotateVecByQuat({ x: -p.x, y: -p.y, z: -p.z }, qi), qi);
}

function cfCompose(a, b) {
  const qa = cfQuat(a);
  const pa = sanVec3(a);
  const pb = sanVec3(b);
  return packCF(
    vAdd(pa, rotateVecByQuat(pb, qa)),
    sanitizeQuat(quatMultiply(qa, cfQuat(b))),
  );
}


export function handlePose(handCF, gripCF) {
  return cfCompose(handCF, cfInverse(gripCF));
}


export function rigidMove(partCF, oldHandleCF, newHandleCF) {
  return cfCompose(cfCompose(newHandleCF, cfInverse(oldHandleCF)), partCF);
}
