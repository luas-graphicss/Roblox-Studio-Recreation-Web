import { requireFiniteArray } from "./motionContract.js";

export function transformHomogeneous(matrix, point) {
  requireFiniteArray(matrix, 16, "Matrix");
  requireFiniteArray(point, 4, "Point");
  return [0, 1, 2, 3].map(
    (row) =>
      matrix[row] * point[0] +
      matrix[row + 4] * point[1] +
      matrix[row + 8] * point[2] +
      matrix[row + 12] * point[3],
  );
}

export function projectMotion(currentClip, previousClip, historyValid = true) {
  requireFiniteArray(currentClip, 4, "Current clip");
  requireFiniteArray(previousClip, 4, "Previous clip");
  if (
    historyValid !== true ||
    currentClip[3] <= 0 ||
    previousClip[3] <= 0 ||
    Math.abs(currentClip[2]) > currentClip[3] ||
    Math.abs(previousClip[2]) > previousClip[3]
  )
    return { velocity: [0, 0], valid: false, previousUv: null, reason: "invalid-history-or-clipping" };
  const currentUv = [0, 1].map((axis) => (currentClip[axis] / currentClip[3]) * 0.5 + 0.5);
  const previousUv = [0, 1].map((axis) => (previousClip[axis] / previousClip[3]) * 0.5 + 0.5);
  const velocity = currentUv.map((value, axis) => value - previousUv[axis]);
  if (!velocity.every((value) => Number.isFinite(value) && Math.abs(value) <= 65504))
    return { velocity: [0, 0], valid: false, previousUv, reason: "unrepresentable-fp16-motion" };
  return { velocity, valid: true, previousUv, reason: "valid" };
}

export function reprojectPixel(pixel, velocity, size, currentJitter = [0, 0], previousJitter = [0, 0]) {
  for (const [value, label] of [
    [pixel, "Pixel"],
    [velocity, "Velocity"],
    [currentJitter, "Current jitter"],
    [previousJitter, "Previous jitter"],
  ])
    requireFiniteArray(value, 2, label);
  if (
    !size ||
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width < 1 ||
    size.height < 1
  )
    throw new TypeError("Invalid reprojection size");
  return pixel.map(
    (value, axis) =>
      value -
      currentJitter[axis] -
      velocity[axis] * (axis === 0 ? size.width : size.height) +
      previousJitter[axis],
  );
}

export function readMotionCamera(frame) {
  const jitter = frame.jitterPixels ?? [0, 0];
  requireFiniteArray(jitter, 2, "Jitter");
  const matrices = frame.matrices;
  const explicit = matrices?.viewProjectionNoJitter;
  if (!explicit && jitter.some((value) => value !== 0))
    throw new Error("CP-F06 requires viewProjectionNoJitter when raster jitter is nonzero");
  const viewProjection = Array.from(
    requireFiniteArray(explicit ?? matrices?.viewProjection, 16, "Unjittered view projection"),
  );
  return {
    viewProjection,
    view: Array.from(requireFiniteArray(matrices?.view, 16, "View")),
    jitter: Array.from(jitter),
    width: frame.renderSize.width,
    height: frame.renderSize.height,
  };
}
