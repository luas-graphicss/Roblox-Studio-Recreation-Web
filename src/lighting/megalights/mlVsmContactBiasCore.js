export const PAGE_DEPTH_QUANTIZATION_STEP = 1 / 16777216;
export const CONTACT_DEPTH_SLACK = 2 * PAGE_DEPTH_QUANTIZATION_STEP;


export const MINIMUM_PAGE_AXIS_SINE = 1e-4;

function normalizedVector(x, y, z) {
  const length = Math.sqrt(x * x + y * y + z * z);
  if (!Number.isFinite(length) || length <= 0) return null;
  return [x / length, y / length, z / length];
}

function crossProduct(first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}


export function receiverPlaneTangents(worldNormal) {
  if (!Array.isArray(worldNormal) && !ArrayBuffer.isView(worldNormal)) return null;
  const normal = normalizedVector(
    Number(worldNormal[0]) || 0,
    Number(worldNormal[1]) || 0,
    Number(worldNormal[2]) || 0,
  );
  if (!normal) return null;

  const absoluteX = Math.abs(normal[0]);
  const absoluteY = Math.abs(normal[1]);
  const absoluteZ = Math.abs(normal[2]);
  let helperAxis = [0, 0, 1];
  if (absoluteX <= absoluteY && absoluteX <= absoluteZ) helperAxis = [1, 0, 0];
  else if (absoluteY <= absoluteZ) helperAxis = [0, 1, 0];

  const rawFirstTangent = crossProduct(normal, helperAxis);
  const firstTangent = normalizedVector(rawFirstTangent[0], rawFirstTangent[1], rawFirstTangent[2]);
  if (!firstTangent) return null;

  return { normal, firstTangent, secondTangent: crossProduct(normal, firstTangent) };
}


function transformToClip(matrix, x, y, z, homogeneous) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * homogeneous,
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * homogeneous,
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * homogeneous,
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * homogeneous,
  ];
}


function pageStepAlongWorldDirection(matrix, slotScale, centerClipW, centerNdc, direction) {
  const directionClip = transformToClip(matrix, direction[0], direction[1], direction[2], 0);
  const inverseClipW = 1 / centerClipW;
  const ndcStepX = (directionClip[0] - centerNdc[0] * directionClip[3]) * inverseClipW;
  const ndcStepY = (directionClip[1] - centerNdc[1] * directionClip[3]) * inverseClipW;
  const ndcStepZ = (directionClip[2] - centerNdc[2] * directionClip[3]) * inverseClipW;
  return {
    pageU: 0.5 * slotScale.su * ndcStepX,
    pageV: 0.5 * slotScale.sv * ndcStepY,
    depth01: 0.5 * ndcStepZ,
  };
}


export function receiverPlaneDepthSlopeInPage(input) {
  const settings = input || {};
  const noPlane = { ok: false, slopeU: 0, slopeV: 0 };

  const matrix = settings.lightViewProjection;
  if (!matrix || matrix.length < 16) return noPlane;

  const worldPoint = settings.worldPoint;
  if (!worldPoint || worldPoint.length < 3) return noPlane;

  const slotUv = settings.slotUv || {};
  const su = Number(slotUv.su);
  const sv = Number(slotUv.sv);
  if (!Number.isFinite(su) || !Number.isFinite(sv) || su <= 0 || sv <= 0) return noPlane;

  const tangents = receiverPlaneTangents(settings.worldNormal);
  if (!tangents) return noPlane;

  const centerClip = transformToClip(matrix, worldPoint[0], worldPoint[1], worldPoint[2], 1);
  const centerClipW = centerClip[3];
  if (!Number.isFinite(centerClipW) || centerClipW <= 0) return noPlane;
  const centerNdc = [
    centerClip[0] / centerClipW,
    centerClip[1] / centerClipW,
    centerClip[2] / centerClipW,
  ];

  const slotScale = { su, sv };
  const firstStep = pageStepAlongWorldDirection(matrix, slotScale, centerClipW, centerNdc, tangents.firstTangent);
  const secondStep = pageStepAlongWorldDirection(matrix, slotScale, centerClipW, centerNdc, tangents.secondTangent);

  const pageAxisDeterminant = firstStep.pageU * secondStep.pageV - secondStep.pageU * firstStep.pageV;
  const pageAxisScale =
    Math.sqrt(firstStep.pageU * firstStep.pageU + firstStep.pageV * firstStep.pageV) *
    Math.sqrt(secondStep.pageU * secondStep.pageU + secondStep.pageV * secondStep.pageV);
  if (!Number.isFinite(pageAxisDeterminant) || !(pageAxisScale > 0)) return noPlane;
  if (Math.abs(pageAxisDeterminant) < MINIMUM_PAGE_AXIS_SINE * pageAxisScale) return noPlane;

  const slopeU = (firstStep.depth01 * secondStep.pageV - secondStep.depth01 * firstStep.pageV) / pageAxisDeterminant;
  const slopeV = (firstStep.pageU * secondStep.depth01 - secondStep.pageU * firstStep.depth01) / pageAxisDeterminant;
  if (!Number.isFinite(slopeU) || !Number.isFinite(slopeV)) return noPlane;

  return { ok: true, slopeU, slopeV };
}


export function contactReferenceDepthAtTap(input) {
  const settings = input || {};
  const centerDepth01 = Number(settings.centerDepth01) || 0;
  const slopeU = Number(settings.slopeU) || 0;
  const slopeV = Number(settings.slopeV) || 0;
  const tapOffsetU = Number(settings.tapOffsetU) || 0;
  const tapOffsetV = Number(settings.tapOffsetV) || 0;

  const planeDepth = centerDepth01 + slopeU * tapOffsetU + slopeV * tapOffsetV;
  const referenceDepth = planeDepth - CONTACT_DEPTH_SLACK;
  if (!Number.isFinite(referenceDepth)) return centerDepth01 - CONTACT_DEPTH_SLACK;


  if (referenceDepth < 0) return 0;
  if (referenceDepth > 1) return 1;
  return referenceDepth;
}
