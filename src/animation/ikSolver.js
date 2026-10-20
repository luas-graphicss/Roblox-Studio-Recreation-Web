export const IK_MAX_ITERATIONS = 10;
export const IK_TOLERANCE = 0.01;
export const IK_MAX_CHAIN = 20;
export const IK_MAX_CONTROLS = 16;
export const IK_LOD_SKIP_DISTANCE = 250;
export const IK_LOD_SLOW_DISTANCE = 100;

const EPS = 1e-8;

export function clampWeight(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function clampSmoothTime(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 5 ? 5 : n;
}

export function clampPriority(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < -1000 ? -1000 : n > 1000 ? 1000 : n;
}


export const LOOKAT_YAW_LIMIT = 80;
export const LOOKAT_PITCH_LIMIT = 60;
export const LOOKAT_CONE_MARGIN = 15;


export function lookAtConeAngles(yawDeg, pitchDeg) {
  const y = Number.isFinite(yawDeg) ? yawDeg : 0;
  const p = Number.isFinite(pitchDeg) ? pitchDeg : 0;
  const over = Math.max(
    Math.abs(y) - LOOKAT_YAW_LIMIT,
    Math.abs(p) - LOOKAT_PITCH_LIMIT,
    0,
  );
  if (over >= LOOKAT_CONE_MARGIN) return { yaw: 0, pitch: 0 };
  const factor = 1 - over / LOOKAT_CONE_MARGIN;
  return {
    yaw: Math.max(-LOOKAT_YAW_LIMIT, Math.min(LOOKAT_YAW_LIMIT, y)) * factor,
    pitch: Math.max(-LOOKAT_PITCH_LIMIT, Math.min(LOOKAT_PITCH_LIMIT, p)) * factor,
  };
}


export function smoothFactor(smoothTime, dt) {
  const st = clampSmoothTime(smoothTime);
  if (st <= 0) return 1;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
  return 1 - Math.exp((-3 * d) / st);
}

export function vLen(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function vDist(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function vSet(out, x, y, z) {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

function vCopy(out, a) {
  return vSet(out, a.x, a.y, a.z);
}

function vNormTo(out, a) {
  const l = vLen(a);
  if (l < EPS) return vSet(out, 0, 1, 0);
  return vSet(out, a.x / l, a.y / l, a.z / l);
}

function vCross(out, a, b) {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  return vSet(out, x, y, z);
}

function vDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}


export function chainLengths(points) {
  const out = [];
  for (let i = 1; i < points.length; i += 1) out.push(vDist(points[i - 1], points[i]));
  return out;
}

export function chainTotalLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) sum += vDist(points[i - 1], points[i]);
  return sum;
}


const _dir = { x: 0, y: 0, z: 0 };
const _bend = { x: 0, y: 0, z: 0 };
const _tmp = { x: 0, y: 0, z: 0 };
const _axis = { x: 0, y: 0, z: 0 };


export function solveTwoBone(points, target, pole) {
  const a = points[0];
  const b = points[1];
  const c = points[2];
  const l1 = Math.max(vDist(a, b), EPS);
  const l2 = Math.max(vDist(b, c), EPS);
  const total = l1 + l2;
  vSet(_tmp, target.x - a.x, target.y - a.y, target.z - a.z);
  const dRaw = vLen(_tmp);


  const minReach = Math.abs(l1 - l2);
  const reached = dRaw <= total + IK_TOLERANCE && dRaw >= minReach - IK_TOLERANCE;
  vNormTo(_dir, _tmp);
  const dLo = Math.min(minReach + 1e-4, total);
  const dHi = Math.max(total - 1e-4, dLo);
  const d = Math.min(Math.max(dRaw, dLo), dHi);


  const ref = pole || b;
  vSet(_bend, ref.x - a.x, ref.y - a.y, ref.z - a.z);
  const along = vDot(_bend, _dir);
  vSet(_bend, _bend.x - _dir.x * along, _bend.y - _dir.y * along, _bend.z - _dir.z * along);
  if (vLen(_bend) < EPS) {

    vSet(_bend, -_dir.y, _dir.x, 0);
    if (vLen(_bend) < EPS) vSet(_bend, 0, -_dir.z, _dir.y);
  }
  vNormTo(_bend, _bend);

  const cosA = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  vSet(b, a.x + _dir.x * (l1 * cosA) + _bend.x * (l1 * sinA),
    a.y + _dir.y * (l1 * cosA) + _bend.y * (l1 * sinA),
    a.z + _dir.z * (l1 * cosA) + _bend.z * (l1 * sinA));
  if (reached) {
    vCopy(c, target);
  } else if (dRaw > total) {


    vSet(b, a.x + _dir.x * l1, a.y + _dir.y * l1, a.z + _dir.z * l1);
    vSet(c, a.x + _dir.x * total, a.y + _dir.y * total, a.z + _dir.z * total);
  } else {


    vSet(c, a.x + _dir.x * d, a.y + _dir.y * d, a.z + _dir.z * d);
  }
  return { reached, iterations: 0 };
}


export function solveFABRIK(points, target, opts) {
  const n = points.length;
  const maxIter = opts && opts.maxIterations ? opts.maxIterations : IK_MAX_ITERATIONS;
  const tol = opts && opts.tolerance ? opts.tolerance : IK_TOLERANCE;
  const lengths = opts && opts.lengths ? opts.lengths : chainLengths(points);
  let total = 0;
  for (const l of lengths) total += l;
  const rootX = points[0].x;
  const rootY = points[0].y;
  const rootZ = points[0].z;

  const distRootTarget = vDist(points[0], target);
  if (distRootTarget >= total) {

    vSet(_tmp, target.x - rootX, target.y - rootY, target.z - rootZ);
    vNormTo(_dir, _tmp);
    let acc = 0;
    for (let i = 1; i < n; i += 1) {
      acc += lengths[i - 1];
      vSet(points[i], rootX + _dir.x * acc, rootY + _dir.y * acc, rootZ + _dir.z * acc);
    }


    return { reached: distRootTarget - total <= tol, iterations: 0 };
  }

  let iterations = 0;
  for (let iter = 0; iter < maxIter; iter += 1) {
    iterations = iter + 1;

    vCopy(points[n - 1], target);
    for (let i = n - 2; i >= 0; i -= 1) {
      vSet(_tmp, points[i].x - points[i + 1].x, points[i].y - points[i + 1].y, points[i].z - points[i + 1].z);
      vNormTo(_dir, _tmp);
      const l = lengths[i];
      vSet(points[i], points[i + 1].x + _dir.x * l, points[i + 1].y + _dir.y * l, points[i + 1].z + _dir.z * l);
    }

    vSet(points[0], rootX, rootY, rootZ);
    for (let i = 1; i < n; i += 1) {
      vSet(_tmp, points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z);
      vNormTo(_dir, _tmp);
      const l = lengths[i - 1];
      vSet(points[i], points[i - 1].x + _dir.x * l, points[i - 1].y + _dir.y * l, points[i - 1].z + _dir.z * l);
    }
    if (vDist(points[n - 1], target) <= tol) return { reached: true, iterations };
  }
  return { reached: vDist(points[n - 1], target) <= tol, iterations };
}


export function applyPole(points, pole) {
  const n = points.length;
  if (!pole || n < 3) return;
  const a = points[0];
  const c = points[n - 1];
  vSet(_axis, c.x - a.x, c.y - a.y, c.z - a.z);
  if (vLen(_axis) < EPS) return;
  vNormTo(_axis, _axis);

  const mid = points[(n - 1) >> 1];
  vSet(_bend, mid.x - a.x, mid.y - a.y, mid.z - a.z);
  let along = vDot(_bend, _axis);
  vSet(_bend, _bend.x - _axis.x * along, _bend.y - _axis.y * along, _bend.z - _axis.z * along);
  if (vLen(_bend) < EPS) return;

  vSet(_tmp, pole.x - a.x, pole.y - a.y, pole.z - a.z);
  along = vDot(_tmp, _axis);
  vSet(_tmp, _tmp.x - _axis.x * along, _tmp.y - _axis.y * along, _tmp.z - _axis.z * along);
  if (vLen(_tmp) < EPS) return;

  vNormTo(_bend, _bend);
  vNormTo(_tmp, _tmp);
  const cosT = Math.max(-1, Math.min(1, vDot(_bend, _tmp)));
  const crossV = vCross({ x: 0, y: 0, z: 0 }, _bend, _tmp);
  const sinT = vDot(crossV, _axis) >= 0 ? Math.sqrt(Math.max(0, 1 - cosT * cosT)) : -Math.sqrt(Math.max(0, 1 - cosT * cosT));

  for (let i = 1; i < n - 1; i += 1) {
    const p = points[i];
    vSet(_tmp, p.x - a.x, p.y - a.y, p.z - a.z);
    const dAlong = vDot(_tmp, _axis);

    const px = _tmp.x - _axis.x * dAlong;
    const py = _tmp.y - _axis.y * dAlong;
    const pz = _tmp.z - _axis.z * dAlong;

    const cx = _axis.y * pz - _axis.z * py;
    const cy = _axis.z * px - _axis.x * pz;
    const cz = _axis.x * py - _axis.y * px;
    vSet(p,
      a.x + _axis.x * dAlong + px * cosT + cx * sinT,
      a.y + _axis.y * dAlong + py * cosT + cy * sinT,
      a.z + _axis.z * dAlong + pz * cosT + cz * sinT);
  }
}


export function solveChain(points, target, pole) {
  if (!Array.isArray(points) || points.length < 2 || !target) {
    return { reached: false, iterations: 0 };
  }
  if (points.length === 2) {

    const l = Math.max(vDist(points[0], points[1]), EPS);
    vSet(_tmp, target.x - points[0].x, target.y - points[0].y, target.z - points[0].z);
    const d = vLen(_tmp);
    vNormTo(_dir, _tmp);


    const reached = Math.abs(d - l) <= IK_TOLERANCE;
    vSet(points[1], points[0].x + _dir.x * l, points[0].y + _dir.y * l, points[0].z + _dir.z * l);
    if (reached) vCopy(points[1], target);
    return { reached, iterations: 0 };
  }
  if (points.length === 3) return solveTwoBone(points, target, pole);
  const res = solveFABRIK(points, target, null);
  applyPole(points, pole);
  return res;
}
