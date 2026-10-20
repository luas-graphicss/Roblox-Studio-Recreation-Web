import { saSpotViewProj } from "./shadowAtlasCore.js";

export const SHADOW_PAGE_DEFAULT_NEAR = 0.5;
export const CUBE_FACE_HALF_FOV_RAD = Math.PI / 4;                            
export const SPOT_HALF_ANGLE_MIN_RAD = 0.05;                                  
export const SPOT_HALF_ANGLE_MAX_RAD = 1.53;
export const FULL_MAP_UV_RECT = Object.freeze({ minU: 0, minV: 0, maxU: 1, maxV: 1 });

export const CUBE_FACE_DIRECTIONS = Object.freeze([
  Object.freeze({ faceName: "+X", direction: Object.freeze([1, 0, 0]) }),
  Object.freeze({ faceName: "-X", direction: Object.freeze([-1, 0, 0]) }),
  Object.freeze({ faceName: "+Y", direction: Object.freeze([0, 1, 0]) }),
  Object.freeze({ faceName: "-Y", direction: Object.freeze([0, -1, 0]) }),
  Object.freeze({ faceName: "+Z", direction: Object.freeze([0, 0, 1]) }),
  Object.freeze({ faceName: "-Z", direction: Object.freeze([0, 0, -1]) }),
]);

const BEHIND_LIGHT_PLANE_EPSILON = 1e-6;
const BOX_CORNER_OFFSETS = Object.freeze([
  Object.freeze([0, 0, 0]),
  Object.freeze([1, 0, 0]),
  Object.freeze([0, 1, 0]),
  Object.freeze([1, 1, 0]),
  Object.freeze([0, 0, 1]),
  Object.freeze([1, 0, 1]),
  Object.freeze([0, 1, 1]),
  Object.freeze([1, 1, 1]),
]);

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vectorOr(value, fallback) {
  if (!value) return fallback.slice();
  return [numberOr(value[0], fallback[0]), numberOr(value[1], fallback[1]), numberOr(value[2], fallback[2])];
}

function normalizedOr(vector, fallback) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!(length > 1e-9)) return fallback.slice();
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function isSpotKind(lightKind) {
  return lightKind === "spot";
}

export function faceCountFor(lightKind) {
  return isSpotKind(lightKind) ? 1 : CUBE_FACE_DIRECTIONS.length;
}


export function resolveSpotHalfAngleRad(requestedHalfAngleRad) {
  const requested = numberOr(requestedHalfAngleRad, CUBE_FACE_HALF_FOV_RAD);
  const halfAngleRad = Math.min(SPOT_HALF_ANGLE_MAX_RAD, Math.max(SPOT_HALF_ANGLE_MIN_RAD, requested));
  return { halfAngleRad: halfAngleRad, clamped: Math.abs(halfAngleRad - requested) > 1e-9 };
}


export function shadowPageOwnerFor(light, faceIndex) {
  const source = light || {};
  const spot = isSpotKind(source.kind);
  const position = vectorOr(source.position, [0, 0, 0]);
  const range = Math.max(0.02, numberOr(source.range, 1));
  const near = Math.min(range * 0.5, Math.max(0.01, numberOr(source.near, SHADOW_PAGE_DEFAULT_NEAR)));
  const face = CUBE_FACE_DIRECTIONS[faceIndex] || CUBE_FACE_DIRECTIONS[0];
  const direction = spot ? normalizedOr(vectorOr(source.direction, [0, -1, 0]), [0, -1, 0]) : face.direction.slice();
  const angle = spot
    ? resolveSpotHalfAngleRad(source.outerHalfAngleRad)
    : { halfAngleRad: CUBE_FACE_HALF_FOV_RAD, clamped: false };
  return {
    lightKey: String(source.key === undefined ? "light" : source.key),
    faceIndex: spot ? 0 : faceIndex,
    faceName: spot ? "cone" : face.faceName,
    halfFovRad: angle.halfAngleRad,
    near: near,
    range: range,
    conservativeFullMap: angle.clamped,
    viewProjection: saSpotViewProj(
      position[0], position[1], position[2],
      direction[0], direction[1], direction[2],
      angle.halfAngleRad, range, near,
    ),
  };
}

export function buildShadowPageOwners(light) {
  const source = light || {};
  const owners = [];
  const faces = faceCountFor(source.kind);
  for (let faceIndex = 0; faces > faceIndex; faceIndex++) owners.push(shadowPageOwnerFor(source, faceIndex));
  return owners;
}


export function projectWorldPointToClip(viewProjection, x, y, z) {
  const m = viewProjection;
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
    w: m[3] * x + m[7] * y + m[11] * z + m[15],
  };
}

function normalizedWorldBox(worldBox) {
  if (!worldBox || !worldBox.min || !worldBox.max) return null;
  const min = vectorOr(worldBox.min, [NaN, NaN, NaN]);
  const max = vectorOr(worldBox.max, [NaN, NaN, NaN]);
  if (!min.concat(max).every((value) => Number.isFinite(value))) return null;
  return {
    min: [Math.min(min[0], max[0]), Math.min(min[1], max[1]), Math.min(min[2], max[2])],
    max: [Math.max(min[0], max[0]), Math.max(min[1], max[1]), Math.max(min[2], max[2])],
  };
}

function ownerOf(ownerOrViewProjection) {
  if (!ownerOrViewProjection) return null;
  if (ownerOrViewProjection.viewProjection) return ownerOrViewProjection;
  return {
    viewProjection: ownerOrViewProjection,
    near: SHADOW_PAGE_DEFAULT_NEAR,
    halfFovRad: CUBE_FACE_HALF_FOV_RAD,
    conservativeFullMap: false,
  };
}

function emptyProjection(crossesLightPlane, cornersInFront) {
  return { visible: false, uvRect: null, crossesLightPlane: crossesLightPlane, cornersInFront: cornersInFront };
}


export function projectWorldBoxToUvRect(ownerOrViewProjection, worldBox) {
  const owner = ownerOf(ownerOrViewProjection);
  const box = normalizedWorldBox(worldBox);
  if (!owner || !box) return emptyProjection(false, 0);
  const cotangentOfHalfFov = 1 / Math.tan(numberOr(owner.halfFovRad, CUBE_FACE_HALF_FOV_RAD));
  const near = Math.max(1e-4, numberOr(owner.near, SHADOW_PAGE_DEFAULT_NEAR));
  let cornersInFront = 0;
  let anyCornerBehind = false;
  let everyCornerPastRange = true;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  let minLateralX = Infinity;
  let maxLateralX = -Infinity;
  let minLateralY = Infinity;
  let maxLateralY = -Infinity;

  for (let cornerIndex = 0; BOX_CORNER_OFFSETS.length > cornerIndex; cornerIndex++) {
    const offset = BOX_CORNER_OFFSETS[cornerIndex];
    const clip = projectWorldPointToClip(
      owner.viewProjection,
      offset[0] ? box.max[0] : box.min[0],
      offset[1] ? box.max[1] : box.min[1],
      offset[2] ? box.max[2] : box.min[2],
    );


    const lateralX = clip.x / cotangentOfHalfFov;
    const lateralY = clip.y / cotangentOfHalfFov;
    if (lateralX > maxLateralX) maxLateralX = lateralX;
    if (minLateralX > lateralX) minLateralX = lateralX;
    if (lateralY > maxLateralY) maxLateralY = lateralY;
    if (minLateralY > lateralY) minLateralY = lateralY;
    if (BEHIND_LIGHT_PLANE_EPSILON >= clip.w) {
      anyCornerBehind = true;
      continue;
    }
    cornersInFront++;
    const u = (clip.x / clip.w) * 0.5 + 0.5;
    const v = (clip.y / clip.w) * 0.5 + 0.5;
    if (u > maxU) maxU = u;
    if (minU > u) minU = u;
    if (v > maxV) maxV = v;
    if (minV > v) minV = v;
    if (1 >= clip.z / clip.w) everyCornerPastRange = false;
  }

  if (cornersInFront === 0) return emptyProjection(anyCornerBehind, 0);
  if (owner.conservativeFullMap) {
    return { visible: true, uvRect: Object.assign({}, FULL_MAP_UV_RECT), crossesLightPlane: anyCornerBehind, cornersInFront: cornersInFront };
  }
  if (anyCornerBehind) {
    const nearScale = (0.5 * cotangentOfHalfFov) / near;
    minU = Math.min(minU, 0.5 + minLateralX * nearScale, 0.5 + maxLateralX * nearScale);
    maxU = Math.max(maxU, 0.5 + minLateralX * nearScale, 0.5 + maxLateralX * nearScale);
    minV = Math.min(minV, 0.5 + minLateralY * nearScale, 0.5 + maxLateralY * nearScale);
    maxV = Math.max(maxV, 0.5 + minLateralY * nearScale, 0.5 + maxLateralY * nearScale);
  } else if (everyCornerPastRange) {
    return emptyProjection(false, cornersInFront);
  }
  if (minU > 1 || minV > 1 || 0 > maxU || 0 > maxV) return emptyProjection(anyCornerBehind, cornersInFront);
  return {
    visible: true,
    uvRect: { minU: minU, minV: minV, maxU: maxU, maxV: maxV },
    crossesLightPlane: anyCornerBehind,
    cornersInFront: cornersInFront,
  };
}
