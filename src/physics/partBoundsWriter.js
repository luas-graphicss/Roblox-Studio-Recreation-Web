export const PART_BOUNDS_MARGIN = 1e-3;

function isFiniteVector(value) {
  return (
    !!value &&
    Number.isFinite(Number(value.x)) &&
    Number.isFinite(Number(value.y)) &&
    Number.isFinite(Number(value.z))
  );
}

export function writeAxisAlignedPartBounds(target, instance) {
  const position = instance.getProperty("Position");
  const size = instance.getProperty("Size");
  if (!isFiniteVector(position) || !isFiniteVector(size)) return false;
  const halfX = Math.abs(Number(size.x)) / 2;
  const halfY = Math.abs(Number(size.y)) / 2;
  const halfZ = Math.abs(Number(size.z)) / 2;
  const centerX = Number(position.x);
  const centerY = Number(position.y);
  const centerZ = Number(position.z);
  target.minX = centerX - halfX;
  target.minY = centerY - halfY;
  target.minZ = centerZ - halfZ;
  target.maxX = centerX + halfX;
  target.maxY = centerY + halfY;
  target.maxZ = centerZ + halfZ;
  return true;
}

export function writeConservativePartBounds(target, instance) {
  const position = instance.getProperty("Position");
  const size = instance.getProperty("Size");
  if (!isFiniteVector(position) || !isFiniteVector(size)) return false;
  const halfX = Math.abs(Number(size.x)) / 2;
  const halfY = Math.abs(Number(size.y)) / 2;
  const halfZ = Math.abs(Number(size.z)) / 2;
  const rotationProofRadius =
    Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ) + PART_BOUNDS_MARGIN;
  const centerX = Number(position.x);
  const centerY = Number(position.y);
  const centerZ = Number(position.z);
  target.minX = centerX - rotationProofRadius;
  target.minY = centerY - rotationProofRadius;
  target.minZ = centerZ - rotationProofRadius;
  target.maxX = centerX + rotationProofRadius;
  target.maxY = centerY + rotationProofRadius;
  target.maxZ = centerZ + rotationProofRadius;
  return true;
}
