import {
  quatFromEulerYXZ,
  quatToEulerYXZ,
  quatMultiply,
  quatConjugate,
  rotateVecByQuat,
} from "../runtime/cframeMath.js";

export const BONE_CF_VERSION = "bone-cframe-1";
export const BONE_EULER_ORDER = "YXZ";
export const BONE_QUAT_EPS = 1e-6;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;


function toXYZW(q) {
  return { x: q.qx, y: q.qy, z: q.qz, w: q.qw };
}
function fromXYZW(q) {
  return { qx: q.x, qy: q.y, qz: q.z, qw: q.w };
}


export function quatIdentity() {
  return { qx: 0, qy: 0, qz: 0, qw: 1 };
}


export function sanitizeQuat(q) {
  if (!q || typeof q !== "object") return quatIdentity();
  const qx = Number(q.qx);
  const qy = Number(q.qy);
  const qz = Number(q.qz);
  const qw = Number(q.qw);
  if (
    !Number.isFinite(qx) || !Number.isFinite(qy) ||
    !Number.isFinite(qz) || !Number.isFinite(qw)
  ) {
    return quatIdentity();
  }
  const len = Math.hypot(qx, qy, qz, qw);
  if (!Number.isFinite(len) || len < BONE_QUAT_EPS) return quatIdentity();
  const s = (qw < 0 ? -1 : 1) / len;
  return { qx: qx * s, qy: qy * s, qz: qz * s, qw: qw * s };
}


export function quatFromEulerDeg(e) {
  const src = e && typeof e === "object" ? e : {};
  const q = quatFromEulerYXZ(
    Number(src.x) * DEG2RAD,
    Number(src.y) * DEG2RAD,
    Number(src.z) * DEG2RAD,
  );
  return sanitizeQuat(fromXYZW(q));
}


export function eulerDegFromQuat(q) {
  const e = quatToEulerYXZ(toXYZW(sanitizeQuat(q)));
  return { x: e.x * RAD2DEG, y: e.y * RAD2DEG, z: e.z * RAD2DEG };
}


export function quatMul(a, b) {
  return fromXYZW(quatMultiply(toXYZW(a), toXYZW(b)));
}


export function quatConj(q) {
  return fromXYZW(quatConjugate(toXYZW(q)));
}


export function rotateVec(q, v) {
  return rotateVecByQuat(v, toXYZW(q));
}


export function isIdentityQuat(q, eps = BONE_QUAT_EPS) {
  const s = sanitizeQuat(q);
  return (
    Math.abs(s.qx) <= eps &&
    Math.abs(s.qy) <= eps &&
    Math.abs(s.qz) <= eps &&
    Math.abs(s.qw - 1) <= eps
  );
}


export function composeBoneCF(pos, quat) {
  const p = pos && typeof pos === "object" ? pos : {};
  const px = Number(p.x);
  const py = Number(p.y);
  const pz = Number(p.z);
  const q = sanitizeQuat(quat);
  return {
    x: Number.isFinite(px) ? px : 0,
    y: Number.isFinite(py) ? py : 0,
    z: Number.isFinite(pz) ? pz : 0,
    qx: q.qx, qy: q.qy, qz: q.qz, qw: q.qw,
  };
}


export function mulBoneCF(a, b) {
  const qa = toXYZW(a);
  const p = rotateVecByQuat({ x: b.x, y: b.y, z: b.z }, qa);
  const q = quatMultiply(qa, toXYZW(b));
  return {
    x: a.x + p.x,
    y: a.y + p.y,
    z: a.z + p.z,
    qx: q.x, qy: q.y, qz: q.z, qw: q.w,
  };
}


export function invBoneCF(a) {
  const qc = quatConjugate(toXYZW(a));
  const p = rotateVecByQuat({ x: -a.x, y: -a.y, z: -a.z }, qc);
  return { x: p.x, y: p.y, z: p.z, qx: qc.x, qy: qc.y, qz: qc.z, qw: qc.w };
}
