import { SA_PAD } from "./shadowAtlasCore.js";
import { cubeFaceHalfAngleRad } from "./llPointShadowCore.js";


export function maxKernelRadiusTexels(padTexels) {
  const pad = padTexels === undefined ? SA_PAD : Number(padTexels) || 0;
  return Math.max(0, pad);
}


export function cubeFaceTexelAngleRad(resolution, padTexels) {
  const texels = Math.max(1, Math.floor(Number(resolution) || 0));
  return (2 * cubeFaceHalfAngleRad(texels, padTexels)) / texels;
}


export function penumbraWidthWorld(input) {
  const options = input || {};
  const sourceRadius = Math.max(0, Number(options.sourceRadius) || 0);
  const blockerDistance = Number(options.blockerDistance) || 0;
  const receiverDistance = Number(options.receiverDistance) || 0;
  if (sourceRadius <= 0) return 0;
  if (blockerDistance <= 0 || receiverDistance <= blockerDistance) return 0;
  return (sourceRadius * (receiverDistance - blockerDistance)) / blockerDistance;
}


export function penumbraRadiusTexels(input) {
  const options = input || {};
  const resolution = Math.max(1, Math.floor(Number(options.resolution) || 0));
  const receiverDistance = Number(options.receiverDistance) || 0;
  const world = penumbraWidthWorld(options);
  const ceiling = maxKernelRadiusTexels(options.padTexels);
  if (world <= 0 || receiverDistance <= 0) {
    return Object.freeze({ world: 0, texels: 0, clampedTexels: 0, clamped: false });
  }
  const tangent = Math.tan(cubeFaceHalfAngleRad(resolution, options.padTexels));
  const texels = (world * resolution) / (2 * receiverDistance * tangent);
  const clampedTexels = Math.min(texels, ceiling);
  return Object.freeze({
    world: world,
    texels: texels,
    clampedTexels: clampedTexels,
    clamped: texels > ceiling,
  });
}
