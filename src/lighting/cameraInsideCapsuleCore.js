export const CAMERA_CAPSULE_CLEARANCE = 0.5;

function isFiniteVector(x, y, z) {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}


export function squaredDistanceToCapsuleAxis(capsule, point) {
  if (!capsule || typeof capsule !== "object") return Infinity;
  if (!point || typeof point !== "object") return Infinity;
  if (!isFiniteVector(capsule.ax, capsule.ay, capsule.az)) return Infinity;
  if (!isFiniteVector(capsule.bx, capsule.by, capsule.bz)) return Infinity;
  if (!isFiniteVector(point.x, point.y, point.z)) return Infinity;
  const axisX = capsule.bx - capsule.ax;
  const axisY = capsule.by - capsule.ay;
  const axisZ = capsule.bz - capsule.az;
  const toPointX = point.x - capsule.ax;
  const toPointY = point.y - capsule.ay;
  const toPointZ = point.z - capsule.az;
  const axisLengthSquared = axisX * axisX + axisY * axisY + axisZ * axisZ;
  let axisFraction = 0;
  if (axisLengthSquared > 1e-12) {
    const projection = toPointX * axisX + toPointY * axisY + toPointZ * axisZ;
    axisFraction = Math.min(1, Math.max(0, projection / axisLengthSquared));
  }
  const offsetX = toPointX - axisX * axisFraction;
  const offsetY = toPointY - axisY * axisFraction;
  const offsetZ = toPointZ - axisZ * axisFraction;
  return offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
}


export function isCameraInsideCapsule(capsule, cameraPosition, clearance) {
  const squaredDistance = squaredDistanceToCapsuleAxis(capsule, cameraPosition);
  if (!Number.isFinite(squaredDistance)) return false;
  const radius = Number.isFinite(capsule.r) ? Math.max(capsule.r, 0) : 0;
  const margin = Number.isFinite(clearance)
    ? Math.max(clearance, 0)
    : CAMERA_CAPSULE_CLEARANCE;
  const reach = radius + margin;
  return reach * reach >= squaredDistance;
}


export function rejectCapsulesAroundCamera(capsules, cameraPosition, clearance) {
  if (!Array.isArray(capsules)) return [];
  const kept = [];
  for (const capsule of capsules) {
    if (!capsule) continue;
    if (isCameraInsideCapsule(capsule, cameraPosition, clearance)) continue;
    kept.push(capsule);
  }
  return kept;
}
