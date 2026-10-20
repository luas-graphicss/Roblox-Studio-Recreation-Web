import { SA_ML_MAX, SA_META_TEXELS, SA_META_TEX_W, SA_DEFAULT_BIAS } from "../shadowAtlasCore.js";
import { MSM_GRID_MAX_LIGHT_COUNT } from "./msmWorldGridLayout.js";


export const MSM_ATLAS_VISIBILITY_LIT = 1;
export const MSM_ATLAS_VISIBILITY_BLOCKED = 0;
export const MSM_ATLAS_VISIBILITY_NO_INFORMATION = -1;


export const MSM_ATLAS_META_TEXEL = Object.freeze({
  VIEW_PROJECTION_COLUMN_0: 0,
  VIEW_PROJECTION_COLUMN_1: 1,
  VIEW_PROJECTION_COLUMN_2: 2,
  VIEW_PROJECTION_COLUMN_3: 3,
  SLOT_TRANSFORM: 4,
  SLOT_BOUNDS: 5,
});


export const MSM_ATLAS_META_TEXELS_PER_ROW = SA_META_TEXELS;
export const MSM_ATLAS_META_TEXTURE_WIDTH = SA_META_TEX_W;
export const MSM_ATLAS_DEFAULT_DEPTH_BIAS = SA_DEFAULT_BIAS;


export const MSM_ATLAS_ROW_COUNT = SA_ML_MAX;
export const MSM_ATLAS_LAST_ROW = SA_ML_MAX - 1;
export const MSM_ATLAS_UNMAPPED_ROW = -1;


export const MSM_ATLAS_LIGHTS_WITHOUT_ROW = Math.max(0, MSM_GRID_MAX_LIGHT_COUNT - SA_ML_MAX);


export const MSM_ATLAS_MAX_DEPTH_TAPS_PER_SAMPLE = 1;


export const MSM_ATLAS_VISIBILITY_REASON = Object.freeze({
  ATLAS_ASLEEP: "atlas asleep - the uniform gate is off",
  ROW_UNMAPPED: "light has no atlas row - beyond the meta texture",
  NO_READER: "no atlas reader was provided - nothing to sample",
  SLOT_EMPTY: "atlas row carries no slot - the page was never rendered",
  BEHIND_LIGHT: "sample sits behind the light - the page cannot answer",
  OUTSIDE_PAGE: "sample sits outside the page frustum - the page cannot answer",
  DEPTH_TAP: "one atlas depth tap decided it",
});


export const MSM_ATLAS_VISIBILITY_MIRROR_ARGUMENT_ORDER = Object.freeze([
  "atlasEnabled",
  "atlasRow",
  "viewPosition",
  "viewToWorldMatrix",
  "readMetaTexel",
  "sampleAtlasDepth",
  "depthBias",
]);


const ATLAS_UNPACK_DOWNSCALE = 255 / 256;
const ATLAS_UNPACK_FACTORS = Object.freeze([
  ATLAS_UNPACK_DOWNSCALE / (256 * 256 * 256),
  ATLAS_UNPACK_DOWNSCALE / (256 * 256),
  ATLAS_UNPACK_DOWNSCALE / 256,
  ATLAS_UNPACK_DOWNSCALE,
]);

const IDENTITY_MATRIX_4 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);


export function unpackAtlasDepth(packedDepth) {
  const channels = toVector4(packedDepth);
  return (
    channels[0] * ATLAS_UNPACK_FACTORS[0] +
    channels[1] * ATLAS_UNPACK_FACTORS[1] +
    channels[2] * ATLAS_UNPACK_FACTORS[2] +
    channels[3] * ATLAS_UNPACK_FACTORS[3]
  );
}


export function isUsableAtlasRow(atlasRow) {
  const row = Math.floor(Number(atlasRow));
  return row >= 0 && row <= MSM_ATLAS_LAST_ROW;
}















export function resolveAtlasRowForLightIndex(lightIndex, atlasRowByLightIndex) {
  const index = Math.floor(Number(lightIndex));
  if (!(index >= 0) || index >= MSM_GRID_MAX_LIGHT_COUNT) return MSM_ATLAS_UNMAPPED_ROW;

  const table = atlasRowByLightIndex;
  let rawRow;
  if (table instanceof Map) rawRow = table.get(index);
  else if (table && typeof table.length === "number") rawRow = table[index];
  else return MSM_ATLAS_UNMAPPED_ROW;

  const row = Math.floor(Number(rawRow));
  return isUsableAtlasRow(row) ? row : MSM_ATLAS_UNMAPPED_ROW;
}


export function hasAtlasSlot(slotTransformTexel) {
  return toVector4(slotTransformTexel)[0] > 0;
}


export function describeAtlasVisibility(request) {
  const source = request && typeof request === "object" ? request : {};

  if (source.atlasEnabled !== true) {
    return buildAnswer(MSM_ATLAS_VISIBILITY_NO_INFORMATION, MSM_ATLAS_VISIBILITY_REASON.ATLAS_ASLEEP, null);
  }

  const atlasRow = Math.floor(Number(source.atlasRow));
  if (!isUsableAtlasRow(atlasRow)) {
    return buildAnswer(MSM_ATLAS_VISIBILITY_NO_INFORMATION, MSM_ATLAS_VISIBILITY_REASON.ROW_UNMAPPED, null);
  }

  const readMetaTexel = typeof source.readMetaTexel === "function" ? source.readMetaTexel : null;
  const sampleAtlasDepth = typeof source.sampleAtlasDepth === "function" ? source.sampleAtlasDepth : null;
  if (readMetaTexel === null || sampleAtlasDepth === null) {
    return buildAnswer(MSM_ATLAS_VISIBILITY_NO_INFORMATION, MSM_ATLAS_VISIBILITY_REASON.NO_READER, null);
  }

  const slotTransform = toVector4(readMetaTexel(atlasRow, MSM_ATLAS_META_TEXEL.SLOT_TRANSFORM));
  if (!hasAtlasSlot(slotTransform)) {
    return buildAnswer(MSM_ATLAS_VISIBILITY_NO_INFORMATION, MSM_ATLAS_VISIBILITY_REASON.SLOT_EMPTY, null);
  }

  const viewPosition = toVector3(source.viewPosition);
  const viewToWorld = toMatrix4(source.viewToWorldMatrix);
  const worldPosition = transformPoint(viewToWorld, viewPosition);

  const clipPosition = projectByMetaColumns(
    toVector4(readMetaTexel(atlasRow, MSM_ATLAS_META_TEXEL.VIEW_PROJECTION_COLUMN_0)),
    toVector4(readMetaTexel(atlasRow, MSM_ATLAS_META_TEXEL.VIEW_PROJECTION_COLUMN_1)),
    toVector4(readMetaTexel(atlasRow, MSM_ATLAS_META_TEXEL.VIEW_PROJECTION_COLUMN_2)),
    toVector4(readMetaTexel(atlasRow, MSM_ATLAS_META_TEXEL.VIEW_PROJECTION_COLUMN_3)),
    worldPosition
  );


  if (clipPosition[3] <= 0) {
    return buildAnswer(MSM_ATLAS_VISIBILITY_LIT, MSM_ATLAS_VISIBILITY_REASON.BEHIND_LIGHT, null);
  }

  const deviceX = clipPosition[0] / clipPosition[3];
  const deviceY = clipPosition[1] / clipPosition[3];
  const deviceZ = clipPosition[2] / clipPosition[3];
  if (Math.abs(deviceX) >= 1 || Math.abs(deviceY) >= 1 || deviceZ >= 1 || deviceZ <= -1) {
    return buildAnswer(MSM_ATLAS_VISIBILITY_LIT, MSM_ATLAS_VISIBILITY_REASON.OUTSIDE_PAGE, null);
  }

  const slotBounds = toVector4(readMetaTexel(atlasRow, MSM_ATLAS_META_TEXEL.SLOT_BOUNDS));
  const pageU = clampNumber((deviceX * 0.5 + 0.5) * slotTransform[0] + slotTransform[2], slotBounds[0], slotBounds[2]);
  const pageV = clampNumber((deviceY * 0.5 + 0.5) * slotTransform[1] + slotTransform[3], slotBounds[1], slotBounds[3]);

  const depthBias = Number.isFinite(source.depthBias) ? source.depthBias : MSM_ATLAS_DEFAULT_DEPTH_BIAS;
  const reference = deviceZ * 0.5 + 0.5 - depthBias;


  const storedDepth = unpackAtlasDepth(sampleAtlasDepth(pageU, pageV));
  const visibility = storedDepth >= reference ? MSM_ATLAS_VISIBILITY_LIT : MSM_ATLAS_VISIBILITY_BLOCKED;

  return buildAnswer(visibility, MSM_ATLAS_VISIBILITY_REASON.DEPTH_TAP, {
    tapCount: MSM_ATLAS_MAX_DEPTH_TAPS_PER_SAMPLE,
    pageUv: Object.freeze([pageU, pageV]),
    reference,
    storedDepth,
  });
}


export function atlasVisibilityFor(request) {
  return describeAtlasVisibility(request).visibility;
}


function buildAnswer(visibility, reason, extra) {
  return Object.freeze({
    visibility,
    reason,
    tapCount: 0,
    pageUv: null,
    reference: null,
    storedDepth: null,
    ...(extra || {}),
  });
}

function toVector4(value) {
  if (Array.isArray(value) || (value && typeof value.length === "number")) {
    return [toFiniteNumber(value[0]), toFiniteNumber(value[1]), toFiniteNumber(value[2]), toFiniteNumber(value[3])];
  }
  if (value && typeof value === "object") {
    return [toFiniteNumber(value.x), toFiniteNumber(value.y), toFiniteNumber(value.z), toFiniteNumber(value.w)];
  }
  return [0, 0, 0, 0];
}

function toVector3(value) {
  if (Array.isArray(value) || (value && typeof value.length === "number")) {
    return [toFiniteNumber(value[0]), toFiniteNumber(value[1]), toFiniteNumber(value[2])];
  }
  if (value && typeof value === "object") {
    return [toFiniteNumber(value.x), toFiniteNumber(value.y), toFiniteNumber(value.z)];
  }
  return [0, 0, 0];
}

function toMatrix4(value) {
  if (value && typeof value.length === "number" && value.length >= 16) {
    const elements = [];
    let index = 0;
    while (index < 16) {
      elements.push(toFiniteNumber(value[index]));
      index += 1;
    }
    return elements;
  }
  return IDENTITY_MATRIX_4.slice();
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clampNumber(value, minimum, maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}


function transformPoint(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
    matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15],
  ];
}


function projectByMetaColumns(column0, column1, column2, column3, point) {
  const result = [];
  let row = 0;
  while (row < 4) {
    result.push(
      column0[row] * point[0] + column1[row] * point[1] + column2[row] * point[2] + column3[row]
    );
    row += 1;
  }
  return result;
}
