import { requireKeys, requireVector, requireNumber, freezeData } from "./settingsValidation.js";

export function validateVolumeBounds(input) {
  if (input?.type === "sphere") {
    requireKeys(input, ["type", "center", "radius"], "Sphere bounds");
    return freezeData({ type: "sphere", center: requireVector(input.center, 3, "Sphere center"), radius: requireNumber(input.radius, "Sphere radius", 0) });
  }
  requireKeys(input, ["type", "center", "halfExtents", "rotation"], "Box bounds");
  if (input.type !== "box") throw new TypeError("Supported volume bounds are sphere and box");
  const bounds = { type: "box", center: requireVector(input.center, 3, "Box center"), halfExtents: requireVector(input.halfExtents, 3, "Box half extents", 0) };
  if (input.rotation !== undefined) {
    bounds.rotation = requireVector(input.rotation, 4, "Box rotation");
    if (Math.abs(Math.hypot(...bounds.rotation) - 1) > 1e-10) throw new TypeError("Box rotation must be a unit quaternion");
  }
  return freezeData(bounds);
}

export function distanceOutsideVolume(bounds, position) {
  let horizontal = position[0] - bounds.center[0];
  let vertical = position[1] - bounds.center[1];
  let depth = position[2] - bounds.center[2];
  if (bounds.type === "sphere") return Math.max(0, Math.hypot(horizontal, vertical, depth) - bounds.radius);
  if (bounds.rotation) {
    const [rotationX, rotationY, rotationZ, rotationW] = bounds.rotation;
    const crossX = 2 * (-rotationY * depth + rotationZ * vertical);
    const crossY = 2 * (-rotationZ * horizontal + rotationX * depth);
    const crossZ = 2 * (-rotationX * vertical + rotationY * horizontal);
    horizontal += rotationW * crossX - rotationY * crossZ + rotationZ * crossY;
    vertical += rotationW * crossY - rotationZ * crossX + rotationX * crossZ;
    depth += rotationW * crossZ - rotationX * crossY + rotationY * crossX;
  }
  return Math.hypot(Math.max(0, Math.abs(horizontal) - bounds.halfExtents[0]), Math.max(0, Math.abs(vertical) - bounds.halfExtents[1]), Math.max(0, Math.abs(depth) - bounds.halfExtents[2]));
}

export function volumeInfluence(volume, position) {
  if (volume.enabled === false || volume.blendWeight === 0) return 0;
  const authoredWeight = volume.blendWeight ?? 1;
  if (volume.unbound === true) return authoredWeight;
  const distance = distanceOutsideVolume(volume.bounds, position);
  if (distance === 0) return authoredWeight;
  const radius = volume.blendRadius ?? 0;
  return radius === 0 || distance >= radius ? 0 : authoredWeight * (1 - distance / radius);
}
