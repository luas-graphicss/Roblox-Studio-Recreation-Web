export const VELOCITY_ENCODING_REVISION = "mv-13a";


export const MAXIMUM_VELOCITY_IN_UV = 0.25;


export const VELOCITY_DEAD_ZONE_IN_ENCODED_UNITS = 0.6 / 255;


export const ENCODED_ZERO_VELOCITY = Object.freeze([0.5, 0.5]);

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value, minimum, maximum) {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}


export function encodeVelocityToUnitRange(velocityU, velocityV) {
  const clampedU = clampNumber(finiteNumberOrFallback(velocityU, 0), -MAXIMUM_VELOCITY_IN_UV, MAXIMUM_VELOCITY_IN_UV);
  const clampedV = clampNumber(finiteNumberOrFallback(velocityV, 0), -MAXIMUM_VELOCITY_IN_UV, MAXIMUM_VELOCITY_IN_UV);
  return [
    clampedU / (2 * MAXIMUM_VELOCITY_IN_UV) + 0.5,
    clampedV / (2 * MAXIMUM_VELOCITY_IN_UV) + 0.5,
  ];
}


export function decodeVelocityFromUnitRange(encodedU, encodedV) {
  let centeredU = clampNumber(finiteNumberOrFallback(encodedU, 0.5), 0, 1) - 0.5;
  let centeredV = clampNumber(finiteNumberOrFallback(encodedV, 0.5), 0, 1) - 0.5;
  if (Math.abs(centeredU) <= VELOCITY_DEAD_ZONE_IN_ENCODED_UNITS) centeredU = 0;
  if (Math.abs(centeredV) <= VELOCITY_DEAD_ZONE_IN_ENCODED_UNITS) centeredV = 0;
  return [centeredU * (2 * MAXIMUM_VELOCITY_IN_UV), centeredV * (2 * MAXIMUM_VELOCITY_IN_UV)];
}


export function previousUvFromVelocity(uv, velocity) {
  const currentUv = Array.isArray(uv) ? uv : [0.5, 0.5];
  const screenVelocity = Array.isArray(velocity) ? velocity : [0, 0];
  return [
    finiteNumberOrFallback(currentUv[0], 0.5) - finiteNumberOrFallback(screenVelocity[0], 0),
    finiteNumberOrFallback(currentUv[1], 0.5) - finiteNumberOrFallback(screenVelocity[1], 0),
  ];
}


export function velocityLengthInPixels(velocity, width, height) {
  const screenVelocity = Array.isArray(velocity) ? velocity : [0, 0];
  const pixelsAlongU = finiteNumberOrFallback(screenVelocity[0], 0) * Math.max(1, finiteNumberOrFallback(width, 1));
  const pixelsAlongV = finiteNumberOrFallback(screenVelocity[1], 0) * Math.max(1, finiteNumberOrFallback(height, 1));
  return Math.sqrt(pixelsAlongU * pixelsAlongU + pixelsAlongV * pixelsAlongV);
}
