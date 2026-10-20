import { luminanceOf } from "./mlTonemappedAccumulationCore.js";


export const DISOCCLUSION_TAP_OFFSETS = Object.freeze([
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: -1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: 1 }),
  Object.freeze({ x: -1, y: -1 }),
  Object.freeze({ x: 1, y: -1 }),
  Object.freeze({ x: -1, y: 1 }),
  Object.freeze({ x: 2, y: 0 }),
  Object.freeze({ x: -2, y: 0 }),
  Object.freeze({ x: 0, y: 2 }),
  Object.freeze({ x: 0, y: -2 }),
  Object.freeze({ x: 2, y: 2 }),
  Object.freeze({ x: -2, y: -2 }),
  Object.freeze({ x: 2, y: -2 }),
  Object.freeze({ x: -2, y: 2 }),
]);

export const SURFACE_SIMILARITY_DEFAULTS = Object.freeze({


  maximumRelativeDepthDifference: 0.05,


  minimumNormalDot: 0.9,
});

function dotOfNormals(left, right) {
  if (!left || !right) return 1;
  return (Number(left.x) || 0) * (Number(right.x) || 0) +
    (Number(left.y) || 0) * (Number(right.y) || 0) +
    (Number(left.z) || 0) * (Number(right.z) || 0);
}


export function isTapOnSameSurface(centreTexel, tapTexel, thresholds) {
  if (!tapTexel) return false;
  if (!centreTexel) return true;

  const limits = thresholds || SURFACE_SIMILARITY_DEFAULTS;
  const centreDepth = Number(centreTexel.depth) || 0;
  const tapDepth = Number(tapTexel.depth) || 0;
  const depthScale = Math.max(1e-4, Math.abs(centreDepth));
  const depthIsClose =
    Math.abs(centreDepth - tapDepth) / depthScale <= limits.maximumRelativeDepthDifference;
  if (!depthIsClose) return false;

  return dotOfNormals(centreTexel.normal, tapTexel.normal) >= limits.minimumNormalDot;
}


export function gatherDisocclusionNeighbourhood(request) {
  const settings = request || {};
  const readTexel = typeof settings.readTexel === "function" ? settings.readTexel : null;
  const width = Math.max(0, Math.floor(Number(settings.width) || 0));
  const height = Math.max(0, Math.floor(Number(settings.height) || 0));
  const pixelX = Math.floor(Number(settings.pixelX) || 0);
  const pixelY = Math.floor(Number(settings.pixelY) || 0);
  const requestedTaps = Math.max(0, Math.floor(Number(settings.tapCount) || 0));
  const tapCount = Math.min(requestedTaps, DISOCCLUSION_TAP_OFFSETS.length);

  let acceptedTapCount = 0;
  let rejectedTapCount = 0;
  let diffuseRed = 0;
  let diffuseGreen = 0;
  let diffuseBlue = 0;
  let specularRed = 0;
  let specularGreen = 0;
  let specularBlue = 0;
  let totalLuminance = 0;

  for (let index = 0; index !== tapCount; index += 1) {
    const offset = DISOCCLUSION_TAP_OFFSETS[index];
    const tapX = pixelX + offset.x;
    const tapY = pixelY + offset.y;
    const tapIsInsideFrame = tapX >= 0 && tapY >= 0 && !(tapX >= width) && !(tapY >= height);
    if (!readTexel || !tapIsInsideFrame) {
      rejectedTapCount += 1;
      continue;
    }

    const tapTexel = readTexel(tapX, tapY);
    if (!isTapOnSameSurface(settings.centreTexel, tapTexel, settings.thresholds)) {
      rejectedTapCount += 1;
      continue;
    }

    const diffuse = tapTexel.diffuse || { r: 0, g: 0, b: 0 };
    const specular = tapTexel.specular || { r: 0, g: 0, b: 0 };
    diffuseRed += Number(diffuse.r) || 0;
    diffuseGreen += Number(diffuse.g) || 0;
    diffuseBlue += Number(diffuse.b) || 0;
    specularRed += Number(specular.r) || 0;
    specularGreen += Number(specular.g) || 0;
    specularBlue += Number(specular.b) || 0;
    totalLuminance += luminanceOf({
      r: (Number(diffuse.r) || 0) + (Number(specular.r) || 0),
      g: (Number(diffuse.g) || 0) + (Number(specular.g) || 0),
      b: (Number(diffuse.b) || 0) + (Number(specular.b) || 0),
    });
    acceptedTapCount += 1;
  }

  const divisor = acceptedTapCount === 0 ? 1 : acceptedTapCount;
  return Object.freeze({
    acceptedTapCount,
    rejectedTapCount,
    diffuse: Object.freeze({ r: diffuseRed / divisor, g: diffuseGreen / divisor, b: diffuseBlue / divisor }),
    specular: Object.freeze({ r: specularRed / divisor, g: specularGreen / divisor, b: specularBlue / divisor }),
    meanLuminance: totalLuminance / divisor,
  });
}
