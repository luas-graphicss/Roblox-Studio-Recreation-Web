export const RAY_DIRECTION_EPSILON = 1e-5;

export const SEGMENT_EXIT_LIMIT = 0.02;

export const SEGMENT_ENTER_LIMIT = 0.98;

export function guardedInverse(component) {
  const value = Number(component) || 0;
  const guarded = value >= 0
    ? Math.max(value, RAY_DIRECTION_EPSILON)
    : Math.min(value, -RAY_DIRECTION_EPSILON);
  return 1 / guarded;
}

export function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale3(v, k) {
  return [v[0] * k, v[1] * k, v[2] * k];
}

export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length3(v) {
  return Math.sqrt(dot3(v, v));
}

export function normalize3(v) {
  const len = length3(v);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}


export function intersectRayWithBox(origin, direction, box) {
  const invX = guardedInverse(direction[0]);
  const invY = guardedInverse(direction[1]);
  const invZ = guardedInverse(direction[2]);
  const tx0 = (box.minX - origin[0]) * invX;
  const tx1 = (box.maxX - origin[0]) * invX;
  const ty0 = (box.minY - origin[1]) * invY;
  const ty1 = (box.maxY - origin[1]) * invY;
  const tz0 = (box.minZ - origin[2]) * invZ;
  const tz1 = (box.maxZ - origin[2]) * invZ;
  const tEnter = Math.max(Math.min(tx0, tx1), Math.min(ty0, ty1), Math.min(tz0, tz1));
  const tExit = Math.min(Math.max(tx0, tx1), Math.max(ty0, ty1), Math.max(tz0, tz1));
  return { hit: tEnter < tExit, tEnter, tExit };
}

export function intersectSegmentWithBox(origin, target, box) {
  return intersectRayWithBox(origin, subtract3(target, origin), box);
}


export function segmentCrossesBox(origin, target, box) {
  const hit = intersectSegmentWithBox(origin, target, box);
  return hit.hit && hit.tExit > SEGMENT_EXIT_LIMIT && hit.tEnter < SEGMENT_ENTER_LIMIT;
}


export function segmentLengthInsideBox(origin, target, box) {
  const span = subtract3(target, origin);
  const spanLength = length3(span);
  if (spanLength <= 0) return 0;
  const hit = intersectRayWithBox(origin, span, box);
  if (!hit.hit) return 0;
  const enter = Math.min(Math.max(hit.tEnter, 0), 1);
  const exit = Math.min(Math.max(hit.tExit, 0), 1);
  return Math.max(exit - enter, 0) * spanLength;
}


export function nearestBoxHitAlongRay(origin, direction, boxes, maxDistance) {
  const limit = Number.isFinite(maxDistance) ? maxDistance : Infinity;
  const list = Array.isArray(boxes) ? boxes : [];
  let best = { hit: false, distance: Infinity, boxIndex: -1 };
  for (let index = 0; index < list.length; index++) {
    const box = list[index];
    if (!box) continue;
    const result = intersectRayWithBox(origin, direction, box);
    if (!result.hit || result.tExit <= 0) continue;
    const distance = result.tEnter > 0 ? result.tEnter : 0;
    if (distance <= limit && distance < best.distance) {
      best = { hit: true, distance, boxIndex: index };
    }
  }
  return best;
}

export function boxExtent(box) {
  return [box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ];
}

export function boxVolume(box) {
  const extent = boxExtent(box);
  return Math.max(extent[0], 0) * Math.max(extent[1], 0) * Math.max(extent[2], 0);
}

export function boxCenter(box) {
  return [
    (box.minX + box.maxX) * 0.5,
    (box.minY + box.maxY) * 0.5,
    (box.minZ + box.maxZ) * 0.5,
  ];
}


export function boxSmallestExtent(box) {
  const extent = boxExtent(box);
  return Math.max(Math.min(extent[0], extent[1], extent[2]), 0);
}
