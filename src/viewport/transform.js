export const MAX_COORD = 1e6;                                          
export const MIN_SIZE = 0.05;                              
export const MAX_SIZE = 1e5;                              

export function isSafeNumber(n) {
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX_COORD;
}

export function isSafeVec3(v) {
  return !!v && typeof v === "object" &&
    isSafeNumber(v.x) && isSafeNumber(v.y) && isSafeNumber(v.z);
}


export function snap(value, step) {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}


export function wrapAngle(deg) {
  if (!Number.isFinite(deg)) return 0;
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

export function clampSize(n) {
  if (!Number.isFinite(n)) return MIN_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));
}


export function computeMove(before, delta, step, ignoreSnap) {
  if (!isSafeVec3(before) || !isSafeVec3(delta)) return null;
  const useSnap = !ignoreSnap && Number.isFinite(step) && step > 0;
  const out = {
    x: before.x + delta.x,
    y: before.y + delta.y,
    z: before.z + delta.z,
  };
  if (useSnap) {
    if (delta.x !== 0) out.x = snap(out.x, step);
    if (delta.y !== 0) out.y = snap(out.y, step);
    if (delta.z !== 0) out.z = snap(out.z, step);
  }
  return isSafeVec3(out) ? out : null;
}


export function computeScale(before, delta, step, ignoreSnap) {
  if (!isSafeVec3(before) || !isSafeVec3(delta)) return null;
  const useSnap = !ignoreSnap && Number.isFinite(step) && step > 0;
  const comp = (b, d) => {
    let v = b + d;
    if (useSnap && d !== 0) v = snap(v, step);
    return clampSize(v);
  };
  const out = {
    x: comp(before.x, delta.x),
    y: comp(before.y, delta.y),
    z: comp(before.z, delta.z),
  };
  return isSafeVec3(out) ? out : null;
}


export function computeRotate(before, axis, deg, step, ignoreSnap) {
  if (!isSafeVec3(before) || !Number.isFinite(deg)) return null;
  if (axis !== 0 && axis !== 1 && axis !== 2) return null;
  const useSnap = !ignoreSnap && Number.isFinite(step) && step > 0;
  const keys = ["x", "y", "z"];
  const k = keys[axis];
  let a = before[k] + deg;
  if (useSnap) a = snap(a, step);
  a = wrapAngle(a);
  const out = { x: before.x, y: before.y, z: before.z };
  out[k] = a;
  return isSafeVec3(out) ? out : null;
}
