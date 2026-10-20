const DEG = Math.PI / 180;

export function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

export function sanitizeNum(v, fallback = 0) {
  return isFiniteNum(v) ? v : fallback;
}


export function sanitizeVec(v, fb = { x: 0, y: 0, z: 0 }) {
  if (!v || typeof v !== "object") return { ...fb };
  return {
    x: sanitizeNum(v.x, fb.x),
    y: sanitizeNum(v.y, fb.y),
    z: sanitizeNum(v.z, fb.z),
  };
}

export function vecLength(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function clampMagnitude(v, max) {
  const m = vecLength(v);
  if (!Number.isFinite(m) || m <= max || m === 0) {
    return { x: sanitizeNum(v.x), y: sanitizeNum(v.y), z: sanitizeNum(v.z) };
  }
  const s = max / m;
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}


export function eulerDegToQuat(ex, ey, ez) {
  const x = sanitizeNum(ex) * DEG / 2;
  const y = sanitizeNum(ey) * DEG / 2;
  const z = sanitizeNum(ez) * DEG / 2;
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);

  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}


export function quatToEulerDeg(q) {
  const x = q.x, y = q.y, z = q.z, w = q.w;

  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m23 = 2 * (y * z - x * w);
  const m33 = 1 - 2 * (x * x + y * y);

  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  let ex;
  let ez;
  if (Math.abs(m13) < 0.9999999) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    const m21 = 2 * (x * y + z * w);
    const m22 = 1 - 2 * (x * x + z * z);
    ex = Math.atan2(m21, m22);
    ez = 0;
  }
  return { x: ex / DEG, y: ey / DEG, z: ez / DEG };
}

export function quatMultiply(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatConjugate(q) {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}


export function rotateVecByQuat(v, q) {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;

  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);

  return {
    x: v.x + qw * tx + (qy * tz - qz * ty),
    y: v.y + qw * ty + (qz * tx - qx * tz),
    z: v.z + qw * tz + (qx * ty - qy * tx),
  };
}


export function partPointToWorld(part, local) {
  const pos = sanitizeVec(part.getProperty("Position"));
  const rot = sanitizeVec(part.getProperty("Rotation"));
  const q = eulerDegToQuat(rot.x, rot.y, rot.z);
  const r = rotateVecByQuat(local, q);
  return { x: pos.x + r.x, y: pos.y + r.y, z: pos.z + r.z };
}
