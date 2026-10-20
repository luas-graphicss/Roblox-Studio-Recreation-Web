import {
  MGL_LIGHT_FLAG_MASK,
  MGL_LIGHT_SHAPE_MASK,
  MGL_LIGHT_SHAPE_BIT_COUNT,
  MGL_MAX_ATLAS_SLOT,
  MGL_NO_ATLAS_SLOT,
} from "./mlLightSceneDataCore.js";


export const MGL_LIGHT_TEXELS_PER_LIGHT = 4;
export const MGL_CHANNELS_PER_TEXEL = 4;
export const MGL_FLOATS_PER_LIGHT = MGL_LIGHT_TEXELS_PER_LIGHT * MGL_CHANNELS_PER_TEXEL;


export const MGL_LIGHTS_PER_TEXTURE_ROW = 64;
export const MGL_LIGHT_TEXTURE_WIDTH = MGL_LIGHT_TEXELS_PER_LIGHT * MGL_LIGHTS_PER_TEXTURE_ROW;


export const MGL_CONE_QUANTISATION_STEPS = 4095;
export const MGL_PACKED_FIELD_STRIDE = 4096;
export const MGL_MAX_EXACT_PACKED_INTEGER = 16777216;        


export const MGL_PACKING_CHANNEL_NAMES = Object.freeze([
  "positionViewX",
  "positionViewY",
  "positionViewZ",
  "attenuationRadius",
  "colorR",
  "colorG",
  "colorB",
  "intensityCandela",
  "directionViewX",
  "directionViewY",
  "directionViewZ",
  "packedConeAngles",
  "sourceRadiusOrWidth",
  "sourceLengthOrHeight",
  "packedShapeAndFlags",
  "packedAtlasSlots",
]);

function clampNumber(value, minimum, maximum) {
  if (!Number.isFinite(value)) return minimum;
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}


export function lightTextureSize(capacity) {
  const lightCount = Math.max(1, Math.ceil(Number(capacity) || 1));
  return {
    width: MGL_LIGHT_TEXTURE_WIDTH,
    height: Math.ceil(lightCount / MGL_LIGHTS_PER_TEXTURE_ROW),
  };
}


export function paddedCapacityFor(capacity) {
  return lightTextureSize(capacity).height * MGL_LIGHTS_PER_TEXTURE_ROW;
}

export function requiredFloatCount(capacity) {
  const size = lightTextureSize(capacity);
  return size.width * size.height * MGL_CHANNELS_PER_TEXEL;
}


export function floatOffsetFor(lightIndex, texelIndex, channelIndex) {
  const row = Math.floor(lightIndex / MGL_LIGHTS_PER_TEXTURE_ROW);
  const column = lightIndex % MGL_LIGHTS_PER_TEXTURE_ROW;
  const texelX = column * MGL_LIGHT_TEXELS_PER_LIGHT + texelIndex;
  return (row * MGL_LIGHT_TEXTURE_WIDTH + texelX) * MGL_CHANNELS_PER_TEXEL + channelIndex;
}


export function firstFloatOffsetOf(lightIndex) {
  return floatOffsetFor(lightIndex, 0, 0);
}

export function quantiseCosine(cosine) {
  const clamped = clampNumber(cosine, -1, 1);
  return Math.round(((clamped + 1) / 2) * MGL_CONE_QUANTISATION_STEPS);
}

export function dequantiseCosine(quantised) {
  const steps = clampNumber(Math.round(quantised), 0, MGL_CONE_QUANTISATION_STEPS);
  return (steps / MGL_CONE_QUANTISATION_STEPS) * 2 - 1;
}

export function packConeAngles(coneCosOuter, coneCosInner) {
  return quantiseCosine(coneCosOuter) + quantiseCosine(coneCosInner) * MGL_PACKED_FIELD_STRIDE;
}

export function unpackConeAngles(packedValue) {
  const packed = Math.max(0, Math.round(packedValue));
  const outerSteps = packed % MGL_PACKED_FIELD_STRIDE;
  const innerSteps = Math.floor(packed / MGL_PACKED_FIELD_STRIDE);
  return { coneCosOuter: dequantiseCosine(outerSteps), coneCosInner: dequantiseCosine(innerSteps) };
}

export function packShapeAndFlags(shapeIndex, flags) {
  const shape = Math.round(clampNumber(shapeIndex, 0, MGL_LIGHT_SHAPE_MASK));
  const flagBits = Math.round(clampNumber(flags, 0, MGL_LIGHT_FLAG_MASK));
  return shape + flagBits * (1 << MGL_LIGHT_SHAPE_BIT_COUNT);
}

export function unpackShapeAndFlags(packedValue) {
  const packed = Math.max(0, Math.round(packedValue));
  const shapeStride = 1 << MGL_LIGHT_SHAPE_BIT_COUNT;
  return {
    shapeIndex: packed % shapeStride,
    flags: Math.floor(packed / shapeStride) & MGL_LIGHT_FLAG_MASK,
  };
}



export function packAtlasSlots(atlasSlot, functionSlot) {
  const atlas = Math.round(clampNumber(atlasSlot, MGL_NO_ATLAS_SLOT, MGL_MAX_ATLAS_SLOT)) + 1;
  const lightFunction = Math.round(clampNumber(functionSlot, MGL_NO_ATLAS_SLOT, MGL_MAX_ATLAS_SLOT)) + 1;
  return atlas + lightFunction * MGL_PACKED_FIELD_STRIDE;
}

export function unpackAtlasSlots(packedValue) {
  const packed = Math.max(0, Math.round(packedValue));
  return {
    atlasSlot: (packed % MGL_PACKED_FIELD_STRIDE) - 1,
    functionSlot: Math.floor(packed / MGL_PACKED_FIELD_STRIDE) - 1,
  };
}


export function packLightIntoArray(targetFloats, lightIndex, descriptor) {
  const base = firstFloatOffsetOf(lightIndex);

  targetFloats[base + 0] = descriptor.positionView[0];
  targetFloats[base + 1] = descriptor.positionView[1];
  targetFloats[base + 2] = descriptor.positionView[2];
  targetFloats[base + 3] = descriptor.attenuationRadius;

  targetFloats[base + 4] = descriptor.color[0];
  targetFloats[base + 5] = descriptor.color[1];
  targetFloats[base + 6] = descriptor.color[2];
  targetFloats[base + 7] = descriptor.intensityCandela;

  targetFloats[base + 8] = descriptor.directionView[0];
  targetFloats[base + 9] = descriptor.directionView[1];
  targetFloats[base + 10] = descriptor.directionView[2];
  targetFloats[base + 11] = packConeAngles(descriptor.coneCosOuter, descriptor.coneCosInner);

  targetFloats[base + 12] = descriptor.sourceRadiusOrWidth;
  targetFloats[base + 13] = descriptor.sourceLengthOrHeight;
  targetFloats[base + 14] = packShapeAndFlags(descriptor.shapeIndex, descriptor.flags);
  targetFloats[base + 15] = packAtlasSlots(descriptor.atlasSlot, descriptor.functionSlot);

  return MGL_FLOATS_PER_LIGHT;
}


export function unpackLightFromArray(sourceFloats, lightIndex, target) {
  const base = firstFloatOffsetOf(lightIndex);
  const cone = unpackConeAngles(sourceFloats[base + 11]);
  const shapeAndFlags = unpackShapeAndFlags(sourceFloats[base + 14]);
  const slots = unpackAtlasSlots(sourceFloats[base + 15]);
  const result = target && typeof target === "object" ? target : {};

  result.positionView = [sourceFloats[base + 0], sourceFloats[base + 1], sourceFloats[base + 2]];
  result.attenuationRadius = sourceFloats[base + 3];
  result.color = [sourceFloats[base + 4], sourceFloats[base + 5], sourceFloats[base + 6]];
  result.intensityCandela = sourceFloats[base + 7];
  result.directionView = [sourceFloats[base + 8], sourceFloats[base + 9], sourceFloats[base + 10]];
  result.coneCosOuter = cone.coneCosOuter;
  result.coneCosInner = cone.coneCosInner;
  result.sourceRadiusOrWidth = sourceFloats[base + 12];
  result.sourceLengthOrHeight = sourceFloats[base + 13];
  result.shapeIndex = shapeAndFlags.shapeIndex;
  result.flags = shapeAndFlags.flags;
  result.atlasSlot = slots.atlasSlot;
  result.functionSlot = slots.functionSlot;
  return result;
}


export function clearLightInArray(targetFloats, lightIndex) {
  const base = firstFloatOffsetOf(lightIndex);
  for (let channel = 0; channel < MGL_FLOATS_PER_LIGHT; channel++) targetFloats[base + channel] = 0;
  return MGL_FLOATS_PER_LIGHT;
}


export function isSlotEmpty(sourceFloats, lightIndex) {
  const base = firstFloatOffsetOf(lightIndex);
  for (let channel = 0; channel < MGL_FLOATS_PER_LIGHT; channel++) {
    if (sourceFloats[base + channel] !== 0) return false;
  }
  return true;
}

export function packingChannelNames() {
  return MGL_PACKING_CHANNEL_NAMES.slice();
}
