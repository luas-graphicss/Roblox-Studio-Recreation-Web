import {
  SA_DEFAULT_BIAS,
  SA_TILE,
  saProjectToSlot,
} from "../shadowAtlasCore.js";
import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import {
  CONTACT_DEPTH_SLACK,
  contactReferenceDepthAtTap,
  receiverPlaneDepthSlopeInPage,
} from "./mlVsmContactBiasCore.js";

export const VSM_UNKNOWN_REASON = Object.freeze({
  lightHasNoPage: "lightHasNoPage",
  pageNeverRendered: "pageNeverRendered",
  outsideLightFrustum: "outsideLightFrustum",
  noDepthReader: "noDepthReader",
  depthOutOfReaderRange: "depthOutOfReaderRange",
});


export const VSM_TAP_OFFSETS = Object.freeze([
  Object.freeze([-1, -1]),
  Object.freeze([1, -1]),
  Object.freeze([-1, 1]),
  Object.freeze([1, 1]),
]);


export const PARTIAL_VISIBILITY_THRESHOLD = 0.5;

export const CUBE_FACE = Object.freeze({
  positiveX: 0,
  negativeX: 1,
  positiveY: 2,
  negativeY: 3,
  positiveZ: 4,
  negativeZ: 5,
});


const UNPACK_DOWNSCALE = 255 / 256;
const UNPACK_FACTORS = Object.freeze([
  UNPACK_DOWNSCALE / 16777216,
  UNPACK_DOWNSCALE / 65536,
  UNPACK_DOWNSCALE / 256,
  UNPACK_DOWNSCALE,
]);


export function unpackDepth01FromRgbaBytes(redByte, greenByte, blueByte, alphaByte) {
  return (
    (redByte / 255) * UNPACK_FACTORS[0] +
    (greenByte / 255) * UNPACK_FACTORS[1] +
    (blueByte / 255) * UNPACK_FACTORS[2] +
    (alphaByte / 255) * UNPACK_FACTORS[3]
  );
}


export function cubeFaceForDirection(directionX, directionY, directionZ) {
  const absoluteX = Math.abs(Number(directionX) || 0);
  const absoluteY = Math.abs(Number(directionY) || 0);
  const absoluteZ = Math.abs(Number(directionZ) || 0);
  if (absoluteX >= absoluteY && absoluteX >= absoluteZ) {
    return directionX >= 0 ? CUBE_FACE.positiveX : CUBE_FACE.negativeX;
  }
  if (absoluteY >= absoluteZ) {
    return directionY >= 0 ? CUBE_FACE.positiveY : CUBE_FACE.negativeY;
  }
  return directionZ >= 0 ? CUBE_FACE.positiveZ : CUBE_FACE.negativeZ;
}


export function depthBiasForPageResolution(pageResolution) {
  const resolution = Number(pageResolution);
  if (!Number.isFinite(resolution) || resolution <= 0) return SA_DEFAULT_BIAS;
  return SA_DEFAULT_BIAS * (SA_TILE / resolution);
}


export function atlasTexelSize(atlasSize) {
  const size = Number(atlasSize);
  if (!Number.isFinite(size) || size <= 0) return 0;
  return 1 / size;
}

function hasPage(slotUv) {
  return !!slotUv && Number(slotUv.su) > 0 && Number(slotUv.sv) > 0;
}









export function projectSampleIntoPage(input) {
  const settings = input || {};
  const slotUv = settings.slotUv;
  if (!hasPage(slotUv)) return { ok: false, reason: VSM_UNKNOWN_REASON.lightHasNoPage };

  const worldPoint = Array.isArray(settings.worldPoint) ? settings.worldPoint : null;
  const lightViewProjection = settings.lightViewProjection;
  if (!worldPoint || !lightViewProjection || lightViewProjection.length < 16) {
    return { ok: false, reason: VSM_UNKNOWN_REASON.outsideLightFrustum };
  }

  const projected = saProjectToSlot(lightViewProjection, worldPoint[0], worldPoint[1], worldPoint[2]);
  if (!projected) return { ok: false, reason: VSM_UNKNOWN_REASON.outsideLightFrustum };

  return {
    ok: true,
    atlasU: projected.u * slotUv.su + slotUv.ou,
    atlasV: projected.v * slotUv.sv + slotUv.ov,
    depth01: projected.depth01,
  };
}

function clampToPage(value, minimum, maximum) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return value;
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}


export function resolveSampleVisibility(input) {
  const settings = input || {};
  const unknown = (reason) => ({
    result: MGL_TRACE_RESULT.unknown,
    visibility: 0,
    reason,
    atlasUv: null,
    referenceDepth: null,
    tapCount: VSM_TAP_OFFSETS.length,
    readableTapCount: 0,
    occludedTapCount: 0,
  });


  if (settings.pageRendered === false) return unknown(VSM_UNKNOWN_REASON.pageNeverRendered);
  if (typeof settings.readDepth01 !== "function") return unknown(VSM_UNKNOWN_REASON.noDepthReader);

  const projection = projectSampleIntoPage(settings);
  if (!projection.ok) return unknown(projection.reason);

  const slotUv = settings.slotUv;
  const texelSize = atlasTexelSize(settings.atlasSize);
  const depthBias = Number.isFinite(Number(settings.depthBias))
    ? Number(settings.depthBias)
    : depthBiasForPageResolution(settings.pageResolution);


  const receiverPlane = receiverPlaneDepthSlopeInPage({
    lightViewProjection: settings.lightViewProjection,
    slotUv,
    worldPoint: settings.worldPoint,
    worldNormal: settings.worldNormal,
  });
  const referenceDepth = receiverPlane.ok
    ? projection.depth01 - CONTACT_DEPTH_SLACK
    : projection.depth01 - depthBias;

  let readableTapCount = 0;
  let visibleTapCount = 0;
  VSM_TAP_OFFSETS.forEach((offset) => {
    const tapU = clampToPage(projection.atlasU + offset[0] * texelSize, slotUv.minU, slotUv.maxU);
    const tapV = clampToPage(projection.atlasV + offset[1] * texelSize, slotUv.minV, slotUv.maxV);
    const storedDepth = settings.readDepth01(tapU, tapV);
    if (storedDepth === null || storedDepth === undefined || !Number.isFinite(Number(storedDepth))) return;
    readableTapCount++;


    const tapReferenceDepth = receiverPlane.ok
      ? contactReferenceDepthAtTap({
          centerDepth01: projection.depth01,
          slopeU: receiverPlane.slopeU,
          slopeV: receiverPlane.slopeV,
          tapOffsetU: tapU - projection.atlasU,
          tapOffsetV: tapV - projection.atlasV,
        })
      : referenceDepth;


    if (Number(storedDepth) >= tapReferenceDepth) visibleTapCount++;
  });

  if (readableTapCount === 0) return unknown(VSM_UNKNOWN_REASON.depthOutOfReaderRange);

  const visibility = visibleTapCount / readableTapCount;
  return {
    result: visibility >= PARTIAL_VISIBILITY_THRESHOLD ? MGL_TRACE_RESULT.visible : MGL_TRACE_RESULT.occluded,
    visibility,
    reason: "",
    atlasUv: [projection.atlasU, projection.atlasV],
    referenceDepth,
    tapCount: VSM_TAP_OFFSETS.length,
    readableTapCount,
    occludedTapCount: readableTapCount - visibleTapCount,
  };
}
