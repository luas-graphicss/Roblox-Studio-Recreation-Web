const UINT32_RANGE = 4294967296;

export function validateDepthCamera(camera) {
  const { nearMeters, farMeters, projection = "perspective" } = camera ?? {};
  if (!Number.isFinite(nearMeters) || nearMeters <= 0 || !Number.isFinite(farMeters) || farMeters <= nearMeters) {
    throw new TypeError("CP-F05 requires finite camera planes with 0 < nearMeters < farMeters");
  }
  if (!["perspective", "orthographic"].includes(projection)) throw new TypeError("CP-F05 requires an explicit supported projection");
  return { nearMeters, farMeters, projection };
}

export function validateUnitInterval(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`${label} must be finite in [0, 1]`);
  return value;
}

export function hardwareDepthToMeters(depth, camera) {
  validateUnitInterval(depth, "hardware depth");
  const { nearMeters, farMeters, projection } = validateDepthCamera(camera);
  return projection === "orthographic"
    ? nearMeters + depth * (farMeters - nearMeters)
    : nearMeters * farMeters / (farMeters - depth * (farMeters - nearMeters));
}

export function metersToHardwareDepth(distanceMeters, camera) {
  const { nearMeters, farMeters, projection } = validateDepthCamera(camera);
  if (!Number.isFinite(distanceMeters) || distanceMeters < nearMeters || distanceMeters > farMeters) throw new TypeError("Distance must lie between the camera planes");
  const depth = projection === "orthographic"
    ? (distanceMeters - nearMeters) / (farMeters - nearMeters)
    : farMeters * (distanceMeters - nearMeters) / (distanceMeters * (farMeters - nearMeters));
  return Math.min(1, Math.max(0, depth));
}

export function unpackRgbaDepth(channels, { bytes = false } = {}) {
  if (!channels || channels.length !== 4) throw new TypeError("RGBADepthPacking requires four channels");
  let integerDepth = 0;
  for (let channel = 0; channel < 4; channel += 1) {
    const value = channels[channel];
    if (bytes ? !Number.isInteger(value) || value < 0 || value > 255 : !Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError("Invalid RGBADepthPacking channel");
    }
    integerDepth += (bytes ? value : value * 255) * 256 ** channel;
  }
  return integerDepth / UINT32_RANGE;
}

export function pixelCenterUv(x, y, width, height, origin = "bottom-left") {
  if (![x, y, width, height].every(Number.isInteger) || width < 1 || height < 1 || x < 0 || y < 0 || x >= width || y >= height) throw new TypeError("Invalid physical pixel coordinate");
  if (!["bottom-left", "top-left"].includes(origin)) throw new TypeError("Unknown texture origin");
  const verticalUv = (y + 0.5) / height;
  return [(x + 0.5) / width, origin === "top-left" ? 1 - verticalUv : verticalUv];
}

export function reconstructViewPosition(uv, depth, inverseProjection) {
  if (!uv || uv.length !== 2) throw new TypeError("UV requires two components");
  uv.forEach((value) => validateUnitInterval(value, "UV"));
  validateUnitInterval(depth, "hardware depth");
  if (!inverseProjection || inverseProjection.length !== 16 || !Array.from(inverseProjection).every(Number.isFinite)) throw new TypeError("Inverse projection requires sixteen finite column-major values");
  const clip = [uv[0] * 2 - 1, uv[1] * 2 - 1, depth * 2 - 1, 1];
  const position = [0, 0, 0, 0];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) position[row] += inverseProjection[column * 4 + row] * clip[column];
  }
  if (!Number.isFinite(position[3]) || Math.abs(position[3]) < 1e-15) throw new RangeError("Unprojection produced an invalid homogeneous position");
  return position.slice(0, 3).map((component) => component / position[3]);
}
