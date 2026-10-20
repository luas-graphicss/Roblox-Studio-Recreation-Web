import {
  sanitizeNum,
  eulerDegToQuat,
  quatToEulerDeg,
  quatMultiply,
  quatConjugate,
  rotateVecByQuat,
} from "../physics/mathUtils.js";


export {
  eulerDegToQuat,
  quatToEulerDeg,
  quatMultiply,
  quatConjugate,
  rotateVecByQuat,
};

const RAD2DEG = 180 / Math.PI;

export const QUAT_IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });


function vSan(v, fb = { x: 0, y: 0, z: 0 }) {
  if (!v || typeof v !== "object") return { ...fb };
  return {
    x: sanitizeNum(Number(v.x), fb.x),
    y: sanitizeNum(Number(v.y), fb.y),
    z: sanitizeNum(Number(v.z), fb.z),
  };
}
function vLen(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function vNormOrNull(v) {
  const l = vLen(v);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : null;
}
function vCross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function vDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}


export function sanitizeQuat(q) {
  if (!q || typeof q !== "object") return { ...QUAT_IDENTITY };
  const x = Number(q.x);
  const y = Number(q.y);
  const z = Number(q.z);
  const w = q.w == null ? 1 : Number(q.w);
  if (
    !Number.isFinite(x) || !Number.isFinite(y) ||
    !Number.isFinite(z) || !Number.isFinite(w)
  ) {
    return { ...QUAT_IDENTITY };
  }
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  if (!(len > 1e-12)) return { ...QUAT_IDENTITY };
  return { x: x / len, y: y / len, z: z / len, w: w / len };
}


export function quatFromEulerXYZ(rx, ry, rz) {
  return sanitizeQuat(eulerDegToQuat(
    sanitizeNum(Number(rx)) * RAD2DEG,
    sanitizeNum(Number(ry)) * RAD2DEG,
    sanitizeNum(Number(rz)) * RAD2DEG,
  ));
}

function axisHalfQuat(ax, ay, az, angle) {
  const h = sanitizeNum(Number(angle)) / 2;
  const s = Math.sin(h);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(h) };
}


export function quatFromEulerYXZ(rx, ry, rz) {
  const qy = axisHalfQuat(0, 1, 0, ry);
  const qx = axisHalfQuat(1, 0, 0, rx);
  const qz = axisHalfQuat(0, 0, 1, rz);
  return sanitizeQuat(quatMultiply(quatMultiply(qy, qx), qz));
}


export function quatToEulerXYZ(q) {
  const e = quatToEulerDeg(sanitizeQuat(q));
  return { x: e.x / RAD2DEG, y: e.y / RAD2DEG, z: e.z / RAD2DEG };
}


export function quatToEulerYXZ(q0) {
  const q = sanitizeQuat(q0);
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const m11 = 1 - 2 * (y * y + z * z);
  const m13 = 2 * (x * z + y * w);
  const m21 = 2 * (x * y + z * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m31 = 2 * (x * z - y * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ex = Math.asin(-Math.max(-1, Math.min(1, m23)));
  let ey;
  let ez;
  if (Math.abs(m23) < 0.9999999) {
    ey = Math.atan2(m13, m33);
    ez = Math.atan2(m21, m22);
  } else {
    ey = Math.atan2(-m31, m11);
    ez = 0;
  }
  return { x: ex, y: ey, z: ez };
}


export function quatFromAxisAngle(axis, angle) {
  const a = vSan(axis);
  const l = vLen(a);
  if (!(l > 1e-9)) return { ...QUAT_IDENTITY };
  const h = sanitizeNum(Number(angle)) / 2;
  const s = Math.sin(h) / l;
  return sanitizeQuat({ x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(h) });
}


export function quatToMatrix(q0) {
  const q = sanitizeQuat(q0);
  const x = q.x, y = q.y, z = q.z, w = q.w;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}


export function quatFromMatrixRows(m) {
  const m11 = m[0], m12 = m[1], m13 = m[2];
  const m21 = m[3], m22 = m[4], m23 = m[5];
  const m31 = m[6], m32 = m[7], m33 = m[8];
  const tr = m11 + m22 + m33;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = { w: s / 4, x: (m32 - m23) / s, y: (m13 - m31) / s, z: (m21 - m12) / s };
  } else if (m11 > m22 && m11 > m33) {
    const s = Math.sqrt(1 + m11 - m22 - m33) * 2;
    q = { w: (m32 - m23) / s, x: s / 4, y: (m12 + m21) / s, z: (m13 + m31) / s };
  } else if (m22 > m33) {
    const s = Math.sqrt(1 + m22 - m11 - m33) * 2;
    q = { w: (m13 - m31) / s, x: (m12 + m21) / s, y: s / 4, z: (m23 + m32) / s };
  } else {
    const s = Math.sqrt(1 + m33 - m11 - m22) * 2;
    q = { w: (m21 - m12) / s, x: (m13 + m31) / s, y: (m23 + m32) / s, z: s / 4 };
  }
  return sanitizeQuat(q);
}


export function quatFromBasis(xv, yv, zv) {
  const x = vNormOrNull(vSan(xv)) || { x: 1, y: 0, z: 0 };
  const yIn = vSan(yv, { x: 0, y: 1, z: 0 });
  const dy = vDot(yIn, x);
  let y = vNormOrNull({ x: yIn.x - dy * x.x, y: yIn.y - dy * x.y, z: yIn.z - dy * x.z });
  if (!y) {
    const t = Math.abs(x.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    const dt = vDot(t, x);
    y = vNormOrNull({ x: t.x - dt * x.x, y: t.y - dt * x.y, z: t.z - dt * x.z }) ||
      { x: 0, y: 1, z: 0 };
  }
  const z = (zv ? vNormOrNull(vSan(zv)) : null) || vCross(x, y);
  return quatFromMatrixRows([x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z]);
}


export function quatLookRotation(dir, upArg) {
  const d = vSan(dir);
  const len = vLen(d);
  if (!(len > 1e-9)) return { ...QUAT_IDENTITY };
  const z = { x: -d.x / len, y: -d.y / len, z: -d.z / len };
  const candidates = [];
  if (upArg) candidates.push(vSan(upArg));
  candidates.push({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 });
  let x = null;
  for (const up of candidates) {
    x = vNormOrNull(vCross(up, z));
    if (x) break;
  }
  if (!x) return { ...QUAT_IDENTITY };
  const y = vCross(z, x);
  return quatFromMatrixRows([x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z]);
}


export function quatToAxisAngle(q0) {
  let q = sanitizeQuat(q0);
  if (q.w < 0) q = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  const s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
  if (s < 1e-9) return { axis: { x: 1, y: 0, z: 0 }, angle: 0 };
  return {
    axis: { x: q.x / s, y: q.y / s, z: q.z / s },
    angle: 2 * Math.acos(Math.min(1, q.w)),
  };
}


export function quatSlerp(qa, qb, t0) {
  const a = sanitizeQuat(qa);
  let b = sanitizeQuat(qb);
  const t = sanitizeNum(Number(t0));
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  if (dot < 0) {
    b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    dot = -dot;
  }
  if (dot > 0.9995) {
    return sanitizeQuat({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      w: a.w + (b.w - a.w) * t,
    });
  }
  const th = Math.acos(Math.min(1, dot));
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return sanitizeQuat({
    x: a.x * wa + b.x * wb,
    y: a.y * wa + b.y * wb,
    z: a.z * wa + b.z * wb,
    w: a.w * wa + b.w * wb,
  });
}
