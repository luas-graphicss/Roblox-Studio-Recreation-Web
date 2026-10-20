export const WORLD_BOUNDS_STRIDE = 6;


export const DIRECTION_EPSILON = 1e-12;

export function createWorldBounds() {
  return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
}

export function createSegmentRange() {
  return { entry: 0, exit: 0 };
}

export function boundsOverlap(first, second) {
  return (
    first.minX <= second.maxX && first.maxX >= second.minX &&
    first.minY <= second.maxY && first.maxY >= second.minY &&
    first.minZ <= second.maxZ && first.maxZ >= second.minZ
  );
}

export function boundsOverlapFlat(flat, offset, box) {
  return (
    flat[offset] <= box.maxX && flat[offset + 3] >= box.minX &&
    flat[offset + 1] <= box.maxY && flat[offset + 4] >= box.minY &&
    flat[offset + 2] <= box.maxZ && flat[offset + 5] >= box.minZ
  );
}


function clipAgainstSlab(range, minValue, maxValue, origin, direction) {
  if (Math.abs(direction) < DIRECTION_EPSILON) {
    return origin >= minValue && origin <= maxValue;
  }
  const inverseDirection = 1 / direction;
  let near = (minValue - origin) * inverseDirection;
  let far = (maxValue - origin) * inverseDirection;
  if (near > far) {
    const swap = near;
    near = far;
    far = swap;
  }
  if (near > range.entry) range.entry = near;
  if (far < range.exit) range.exit = far;
  return range.entry <= range.exit;
}


export function clipSegmentToBox(
  range,
  minX, minY, minZ,
  maxX, maxY, maxZ,
  originX, originY, originZ,
  directionX, directionY, directionZ,
  maxDistance,
) {
  range.entry = 0;
  range.exit = maxDistance;
  if (!clipAgainstSlab(range, minX, maxX, originX, directionX)) return false;
  if (!clipAgainstSlab(range, minY, maxY, originY, directionY)) return false;
  if (!clipAgainstSlab(range, minZ, maxZ, originZ, directionZ)) return false;
  return true;
}


const booleanTestRange = createSegmentRange();

export function segmentIntersectsBoundsFlat(
  flat, offset,
  originX, originY, originZ,
  directionX, directionY, directionZ,
  maxDistance,
) {
  return clipSegmentToBox(
    booleanTestRange,
    flat[offset], flat[offset + 1], flat[offset + 2],
    flat[offset + 3], flat[offset + 4], flat[offset + 5],
    originX, originY, originZ,
    directionX, directionY, directionZ,
    maxDistance,
  );
}
