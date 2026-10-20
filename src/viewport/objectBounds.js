const pt = { x: 0, y: 0, z: 0 };

export function expandBoxWithSkeleton(obj, box) {
  if (!obj || !box || typeof obj.traverse !== "function") return box;
  let margin = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let hasPrev = false;
  obj.traverse((n) => {
    if (!n.isSkinnedMesh || !n.skeleton || !Array.isArray(n.skeleton.bones)) return;
    hasPrev = false;
    for (const b of n.skeleton.bones) {
      const e = b && b.matrixWorld && b.matrixWorld.elements;
      if (!e) continue;
      pt.x = e[12];
      pt.y = e[13];
      pt.z = e[14];
      if (!Number.isFinite(pt.x + pt.y + pt.z)) continue;
      box.expandByPoint(pt);
      if (hasPrev) {
        const d = Math.hypot(pt.x - px, pt.y - py, pt.z - pz);
        if (d > margin) margin = d;
      }
      px = pt.x;
      py = pt.y;
      pz = pt.z;
      hasPrev = true;
    }
  });
  if (margin > 0) box.expandByScalar(Math.min(4, margin * 0.75));
  return box;
}

export function computeVisualBox(obj, box) {
  box.setFromObject(obj);
  expandBoxWithSkeleton(obj, box);
  return box;
}
