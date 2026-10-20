export function colliderEligible(inst) {
  if (!inst || !inst.hasProperty) return false;
  if (!inst.hasProperty("Size") || !inst.hasProperty("Position")) return false;
  if (!inst.hasProperty("CanCollide")) return false;
  return inst.getProperty("CanCollide") !== false;
}


export function partAabb(part) {
  let pos = null;
  let size = null;
  try {
    pos = part.getProperty("Position");
    size = part.getProperty("Size");
  } catch (_) {
    return null;
  }
  if (!pos || !size) return null;
  const hx = (Number(size.x) || 0) / 2;
  const hy = (Number(size.y) || 0) / 2;
  const hz = (Number(size.z) || 0) / 2;
  const box = {
    minX: pos.x - hx, maxX: pos.x + hx,
    minY: pos.y - hy, maxY: pos.y + hy,
    minZ: pos.z - hz, maxZ: pos.z + hz,
  };
  if (!Number.isFinite(box.minX) || !Number.isFinite(box.maxX) ||
      !Number.isFinite(box.minY) || !Number.isFinite(box.maxY) ||
      !Number.isFinite(box.minZ) || !Number.isFinite(box.maxZ)) return null;
  return box;
}
