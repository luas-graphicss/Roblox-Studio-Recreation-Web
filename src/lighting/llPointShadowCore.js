import {
  SA_PAD,
  saProjectToSlot,
  saSlotUv,
  saSpotViewProj,
} from "./shadowAtlasCore.js";
import {
  ATLAS_META_ROW_BASE,
  ATLAS_META_ROWS_PER_KIND,
  ATLAS_PAGE_MAX_HALF_ANGLE,
  ATLAS_PAGE_NEAR,
} from "./llShadowGateCore.js";

export const CUBE_FACE_COUNT = 6;


export const POINT_CUBE_MAX_LIGHTS = Math.floor(ATLAS_META_ROWS_PER_KIND / CUBE_FACE_COUNT);


export const CUBE_FACE_IDS = Object.freeze(["+X", "-X", "+Y", "-Y", "+Z", "-Z"]);

const CUBE_FACE_FORWARDS = Object.freeze([
  Object.freeze([1, 0, 0]),
  Object.freeze([-1, 0, 0]),
  Object.freeze([0, 1, 0]),
  Object.freeze([0, -1, 0]),
  Object.freeze([0, 0, 1]),
  Object.freeze([0, 0, -1]),
]);

function clampFaceIndex(faceIndex) {
  const index = Math.floor(Number(faceIndex) || 0);
  if (index < 0) return 0;
  return index >= CUBE_FACE_COUNT ? CUBE_FACE_COUNT - 1 : index;
}

export function cubeFaceForward(faceIndex) {
  const index = clampFaceIndex(faceIndex);
  return CUBE_FACE_FORWARDS[index];
}


export function cubeFaceUpVector(faceIndex) {
  const forward = cubeFaceForward(faceIndex);
  return Math.abs(forward[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
}

export function cubeFaceId(faceIndex) {
  return CUBE_FACE_IDS[clampFaceIndex(faceIndex)];
}


export function cubeFaces() {
  const faces = [];
  for (let faceIndex = 0; faceIndex < CUBE_FACE_COUNT; faceIndex++) {
    faces.push(
      Object.freeze({
        faceIndex: faceIndex,
        id: CUBE_FACE_IDS[faceIndex],
        forward: CUBE_FACE_FORWARDS[faceIndex],
        up: Object.freeze(cubeFaceUpVector(faceIndex)),
      })
    );
  }
  return Object.freeze(faces);
}


export function selectCubeFaceIndex(x, y, z) {
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  const absZ = Math.abs(z);
  if (absX >= absY && absX >= absZ) return x > 0 ? 0 : 1;
  if (absY >= absZ) return y > 0 ? 2 : 3;
  return z > 0 ? 4 : 5;
}


export function cubeFaceUvInset(resolution, padTexels) {
  const texels = Math.max(1, Math.floor(Number(resolution) || 0));
  const pad = padTexels === undefined ? SA_PAD : Math.max(0, Number(padTexels) || 0);
  return (pad + 0.5) / texels;
}


export const SEAM_GUARD_SLACK_TEXELS = 0.5;

export function cubeFaceSeamMargin(resolution, padTexels) {
  const texels = Math.max(1, Math.floor(Number(resolution) || 0));
  const inset = cubeFaceUvInset(resolution, padTexels) + SEAM_GUARD_SLACK_TEXELS / texels;


  const safeInset = Math.min(inset, 0.2);
  return (2 * safeInset) / (1 - 2 * safeInset);
}


export function cubeFaceHalfAngleRad(resolution, padTexels) {
  const halfAngle = Math.atan(1 + cubeFaceSeamMargin(resolution, padTexels));
  return Math.min(halfAngle, ATLAS_PAGE_MAX_HALF_ANGLE);
}


export function metaRowForCubeFace(pointIndex, faceIndex) {
  const light = Math.max(0, Math.floor(Number(pointIndex) || 0));
  return ATLAS_META_ROW_BASE.pointCubeFace + light * CUBE_FACE_COUNT + clampFaceIndex(faceIndex);
}

export function isCubeFaceMetaRowInRange(pointIndex) {
  const light = Math.floor(Number(pointIndex) || 0);
  return light >= 0 && light < POINT_CUBE_MAX_LIGHTS;
}


export function cubeFacePageKey(lightKey, faceIndex) {
  return String(lightKey) + "#" + clampFaceIndex(faceIndex);
}


export function cubeFaceViewProjection(light, faceIndex, resolution, padTexels) {
  const position = (light && light.worldPosition) || [0, 0, 0];
  const forward = cubeFaceForward(faceIndex);
  const range = Math.max(Number(light && light.range) || 0, ATLAS_PAGE_NEAR + 0.01);
  return saSpotViewProj(
    Number(position[0]) || 0,
    Number(position[1]) || 0,
    Number(position[2]) || 0,
    forward[0],
    forward[1],
    forward[2],
    cubeFaceHalfAngleRad(resolution, padTexels),
    range,
    ATLAS_PAGE_NEAR
  );
}


export function projectIntoCubeFace(input) {
  const options = input || {};
  const page = options.page || {};
  const resolution = Math.max(1, Math.floor(Number(page.res) || 0));
  const viewProjection =
    options.viewProjection || cubeFaceViewProjection(options.light, page.faceIndex, resolution, options.padTexels);
  const projected = saProjectToSlot(
    viewProjection,
    Number(options.x) || 0,
    Number(options.y) || 0,
    Number(options.z) || 0
  );
  if (!projected) return null;
  const slot = saSlotUv(
    page.x,
    page.y,
    resolution,
    options.atlasSize,
    options.padTexels === undefined ? SA_PAD : options.padTexels
  );
  return Object.freeze({
    faceUv: Object.freeze([projected.u, projected.v]),
    depth01: projected.depth01,
    atlasUv: Object.freeze([projected.u * slot.su + slot.ou, projected.v * slot.sv + slot.ov]),
    guard: slot,
  });
}


export function isWithinPageGuard(atlasUv, guard) {
  if (!atlasUv || !guard) return false;
  const u = Number(atlasUv[0]);
  const v = Number(atlasUv[1]);
  return u >= guard.minU && u <= guard.maxU && v >= guard.minV && v <= guard.maxV;
}
