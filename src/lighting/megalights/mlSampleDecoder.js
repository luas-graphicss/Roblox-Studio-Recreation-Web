import {
  EMPTY_LIGHT_INDEX,
  LIGHT_SAMPLE_CHANNELS,
  decodeLightSamplesForPixel,
} from "./mlLightSampleEncodingCore.js";
import { isSlotEmpty, unpackLightFromArray } from "./mlLightPackingCore.js";
import { MGL_LIGHT_SHAPE_INDEX, shapeNameForIndex } from "./mlLightSceneDataCore.js";
import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import {
  buildOrthonormalBasis,
  crossProduct,
  normalizeVector,
} from "./mlSamplingGeometryCore.js";
import { sampleRectangle } from "./mlRectSamplingCore.js";
import { sampleSphere } from "./mlSphereSamplingCore.js";
import { sampleTube } from "./mlTubeSamplingCore.js";
import {
  SOURCE_RADIANCE_REFUSAL,
  sourceRadianceTowardsShadingPoint,
} from "./mlSourceRadianceCore.js";


export const DECODED_SLOT_CHANNELS = LIGHT_SAMPLE_CHANNELS;

export const SAMPLE_DECODE_REFUSAL = Object.freeze({
  none: "none",
  emptySlot: "emptySlot",
  lightBufferMissing: "lightBufferMissing",
  lightSlotEmpty: "lightSlotEmpty",
  unknownLightShape: "unknownLightShape",
  visibilityNotResolved: "visibilityNotResolved",
  degeneratePdf: "degeneratePdf",
  nonPositiveReservoirWeight: "nonPositiveReservoirWeight",
  degenerateSource: SOURCE_RADIANCE_REFUSAL.degenerateSource,
  noEmission: SOURCE_RADIANCE_REFUSAL.noEmission,
  outsideAttenuationRadius: SOURCE_RADIANCE_REFUSAL.outsideAttenuationRadius,
  outsideCone: SOURCE_RADIANCE_REFUSAL.outsideCone,
});

function vectorFromArray(source) {
  const values = Array.isArray(source) ? source : [0, 0, 0];
  return {
    x: Number(values[0]) || 0,
    y: Number(values[1]) || 0,
    z: Number(values[2]) || 0,
  };
}

function refused(refusal, lightIndex) {
  return {
    refusal,
    lightIndex: Number.isFinite(lightIndex) ? lightIndex : EMPTY_LIGHT_INDEX,
    shapeName: "",
    sample: null,
  };
}


export function isContractTraceResult(traceResult) {
  return (
    traceResult === MGL_TRACE_RESULT.visible ||
    traceResult === MGL_TRACE_RESULT.occluded ||
    traceResult === MGL_TRACE_RESULT.unknown
  );
}










export function createPackedLightReader(lightSceneData) {
  const handle = lightSceneData || null;
  const packedFloats = handle ? handle.floats : null;
  if (!packedFloats) return null;
  const lightIdOfSlot = handle && typeof handle.lightIdOfSlot === "function" ? handle.lightIdOfSlot : null;
  const reusedDescriptor = {};
  return function readLightAt(lightIndex) {
    if (!(lightIndex >= 0)) return null;
    if (lightIdOfSlot && !lightIdOfSlot(lightIndex)) return null;
    if (isSlotEmpty(packedFloats, lightIndex)) return null;
    return unpackLightFromArray(packedFloats, lightIndex, reusedDescriptor);
  };
}


export function rectangleAxesFacing(emissionDirection) {
  const normal = normalizeVector(emissionDirection);
  const rightAxis = buildOrthonormalBasis(normal).tangent;
  return { normal, rightAxis, upAxis: crossProduct(normal, rightAxis) };
}


export function samplePointOnSource(request) {
  const input = request || {};
  const light = input.light || {};
  const shadingPoint = input.shadingPoint || { x: 0, y: 0, z: 0 };
  const firstRandom = Number(input.u1) || 0;
  const secondRandom = Number(input.u2) || 0;
  const shapeIndex = Math.floor(Number(light.shapeIndex));
  const center = vectorFromArray(light.positionView);
  const radiusOrWidth = Math.max(Number(light.sourceRadiusOrWidth) || 0, 0);
  const lengthOrHeight = Math.max(Number(light.sourceLengthOrHeight) || 0, 0);

  if (shapeIndex === MGL_LIGHT_SHAPE_INDEX.sphere) {
    return sampleSphere({
      shadingPoint,
      center,
      radius: radiusOrWidth,
      u1: firstRandom,
      u2: secondRandom,
    });
  }
  if (shapeIndex === MGL_LIGHT_SHAPE_INDEX.rect) {
    const axes = rectangleAxesFacing(vectorFromArray(light.directionView));
    return sampleRectangle({
      shadingPoint,
      center,
      rightAxis: axes.rightAxis,
      upAxis: axes.upAxis,
      halfWidth: radiusOrWidth * 0.5,
      halfHeight: lengthOrHeight * 0.5,
      u1: firstRandom,
      u2: secondRandom,
    });
  }
  if (shapeIndex === MGL_LIGHT_SHAPE_INDEX.tube) {
    return sampleTube({
      shadingPoint,
      center,
      axis: vectorFromArray(light.directionView),
      halfLength: lengthOrHeight * 0.5,
      radius: radiusOrWidth,
      u1: firstRandom,
      u2: secondRandom,
    });
  }
  return null;
}


function estimatorWeightOfSlot(encodedSlot) {
  const underContractName = Number(encodedSlot.reservoirWeight);
  if (Number.isFinite(underContractName)) return underContractName;
  return Number(encodedSlot.estimatorWeight);
}


export function decodeLightSample(request) {
  const input = request || {};
  const encodedSlot = input.encodedSlot || null;
  if (!encodedSlot) return refused(SAMPLE_DECODE_REFUSAL.emptySlot);

  const lightIndex = Math.floor(Number(encodedSlot.lightIndex));
  if (!(lightIndex >= 0)) return refused(SAMPLE_DECODE_REFUSAL.emptySlot, lightIndex);
  if (typeof input.readLightAt !== "function") {
    return refused(SAMPLE_DECODE_REFUSAL.lightBufferMissing, lightIndex);
  }


  const light = input.readLightAt(lightIndex);
  if (!light) return refused(SAMPLE_DECODE_REFUSAL.lightSlotEmpty, lightIndex);

  const traceResult = input.traceResult;
  if (!isContractTraceResult(traceResult)) {
    return refused(SAMPLE_DECODE_REFUSAL.visibilityNotResolved, lightIndex);
  }

  const reservoirWeight = estimatorWeightOfSlot(encodedSlot);
  if (!(reservoirWeight > 0)) {
    return refused(SAMPLE_DECODE_REFUSAL.nonPositiveReservoirWeight, lightIndex);
  }

  const surface = input.surface || null;
  const geometry = samplePointOnSource({
    light,
    shadingPoint: (surface && surface.positionView) || { x: 0, y: 0, z: 0 },
    u1: encodedSlot.sourcePointU,
    u2: encodedSlot.sourcePointV,
  });
  if (!geometry) return refused(SAMPLE_DECODE_REFUSAL.unknownLightShape, lightIndex);
  if (!(geometry.pdfSolidAngle > 0)) return refused(SAMPLE_DECODE_REFUSAL.degeneratePdf, lightIndex);

  const emission = sourceRadianceTowardsShadingPoint({
    light,
    direction: geometry.direction,
    distanceToSample: geometry.distanceToSample,
  });
  if (emission.refusal !== SOURCE_RADIANCE_REFUSAL.none) {
    return refused(emission.refusal, lightIndex);
  }

  return {
    refusal: SAMPLE_DECODE_REFUSAL.none,
    lightIndex,
    shapeName: shapeNameForIndex(Math.floor(Number(light.shapeIndex))),
    sample: {
      direction: geometry.direction,
      radiance: emission.radiance,
      probabilityDensity: geometry.pdfSolidAngle,
      reservoirWeight,
      traceResult,
      lightIndex,
      slotIndex: Math.floor(Number(encodedSlot.slotIndex)) || 0,
      distanceToLightSample: geometry.distanceToSample,
      cosineAtLight: Number(geometry.cosineAtLight) || 0,
    },
  };
}


export function decodeSamplesForSamplePixel(request) {
  const input = request || {};
  const encodedSlots = decodeLightSamplesForPixel({
    texels: input.texels,
    sampleX: input.sampleX,
    sampleY: input.sampleY,
    sampleColumnCount: input.sampleColumnCount,
    sampleRowCount: input.sampleRowCount,
    samplesPerPixel: input.samplesPerPixel,
  });
  const decodedSamples = Array.isArray(input.destination) ? input.destination : [];
  decodedSamples.length = 0;
  const refusalCounts = input.refusalCounts || {};
  const resolveTraceResult =
    typeof input.traceResultForSlot === "function" ? input.traceResultForSlot : null;
  const slotCount = Array.isArray(encodedSlots) ? encodedSlots.length : 0;

  for (let slot = 0; slot !== slotCount; slot += 1) {
    const encodedSlot = encodedSlots[slot];
    const decoded = decodeLightSample({
      encodedSlot,
      readLightAt: input.readLightAt,
      surface: input.surface,
      traceResult: resolveTraceResult
        ? resolveTraceResult(Math.floor(Number(encodedSlot.slotIndex)) || slot, encodedSlot)
        : undefined,
    });
    if (decoded.sample) {
      decodedSamples.push(decoded.sample);
    } else {
      refusalCounts[decoded.refusal] = (refusalCounts[decoded.refusal] || 0) + 1;
    }
  }

  return { samples: decodedSamples, encodedSlotCount: slotCount, refusalCounts };
}

export function describeSampleDecoder() {
  return {
    channels: DECODED_SLOT_CHANNELS,
    channelRIsAnIndex: true,
    resolvesIndexWith: "unpackLightFromArray, through createPackedLightReader",
    turnsUvIntoAPointWith: "sampleSphere / sampleRectangle / sampleTube of ML-F7",
    refusals: SAMPLE_DECODE_REFUSAL,
    neverEmits: "a sample whose traceResult is not a state of MGL_TRACE_RESULT",
  };
}
