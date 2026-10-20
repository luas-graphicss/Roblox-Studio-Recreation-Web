const registry = new Map();


function finiteVec(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function sanitizeCollision(col) {
  if (!col || typeof col !== "object") return null;
  let hull = null;
  const rawHull = col.hull;
  if (
    rawHull &&
    Array.isArray(rawHull.vertices) &&
    rawHull.vertices.length >= 4 &&
    rawHull.vertices.length <= 64 &&
    rawHull.vertices.every(finiteVec) &&
    Array.isArray(rawHull.faces) &&
    rawHull.faces.length >= 4 &&
    rawHull.faces.every(
      (f) =>
        Array.isArray(f) &&
        f.length >= 3 &&
        f.every((i) => Number.isInteger(i) && i >= 0 && i < rawHull.vertices.length),
    )
  ) {
    hull = rawHull;
  }
  let boxes = null;
  if (
    Array.isArray(col.boxes) &&
    col.boxes.length > 0 &&
    col.boxes.length <= 128 &&
    col.boxes.every(
      (b) => !!b && finiteVec(b.c) && finiteVec(b.h) && b.h.x > 0 && b.h.y > 0 && b.h.z > 0,
    )
  ) {
    boxes = col.boxes;
  }
  if (!hull && !boxes) return null;
  return { hull, boxes };
}

export const meshRegistry = {


  register(meshId, info) {
    if (typeof meshId !== "string" || !meshId || !info) return;


    const dim = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0.001, n) : 1;
    };
    const sx = dim(info.size && info.size.x);
    const sy = dim(info.size && info.size.y);
    const sz = dim(info.size && info.size.z);
    const maxDim = Math.max(sx, sy, sz);
    registry.set(meshId, {
      size: { x: sx, y: sy, z: sz },
      extents: { x: sx / maxDim, y: sy / maxDim, z: sz / maxDim },
      triangles: Math.max(0, Number(info.triangles) || 0),
      collision: sanitizeCollision(info.collision),
    });
  },
  get(meshId) {
    return registry.get(meshId) || null;
  },
  has(meshId) {
    return registry.has(meshId);
  },
  clear() {
    registry.clear();
  },
};
