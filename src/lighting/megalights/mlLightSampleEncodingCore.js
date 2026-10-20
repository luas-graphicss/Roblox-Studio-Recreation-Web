export const LIGHT_SAMPLE_CHANNELS = Object.freeze({
  r: "lightIndex",
  g: "reservoirWeight",
  b: "sourcePointU",
  a: "sourcePointV",
});

export const CHANNELS_PER_TEXEL = 4;
export const TEXELS_PER_SAMPLE = 1;
export const EMPTY_LIGHT_INDEX = -1;

function normalizeGeometry(request) {
  const source = request || {};
  return {
    sampleColumnCount: Math.max(1, Math.floor(Number(source.sampleColumnCount) || 1)),
    sampleRowCount: Math.max(1, Math.floor(Number(source.sampleRowCount) || 1)),
    samplesPerPixel: Math.max(1, Math.floor(Number(source.samplesPerPixel) || 1)),
  };
}


export function lightSampleTextureSize(geometry) {
  const grid = normalizeGeometry(geometry);
  const width = grid.sampleColumnCount * grid.samplesPerPixel;
  const height = grid.sampleRowCount;
  return {
    width,
    height,
    texelCount: width * height,
    floatCount: width * height * CHANNELS_PER_TEXEL,
  };
}

export function createLightSampleTexels(geometry) {
  const size = lightSampleTextureSize(geometry);
  return clearLightSampleTexels(new Float32Array(size.floatCount));
}


export function clearLightSampleTexels(texels) {
  for (let offset = 0; offset < texels.length; offset += CHANNELS_PER_TEXEL) {
    texels[offset] = EMPTY_LIGHT_INDEX;
    texels[offset + 1] = 0;
    texels[offset + 2] = 0;
    texels[offset + 3] = 0;
  }
  return texels;
}


export function sampleTexelIndex(location) {
  const source = location || {};
  const sampleColumnCount = Math.max(1, Math.floor(Number(source.sampleColumnCount) || 1));
  const samplesPerPixel = Math.max(1, Math.floor(Number(source.samplesPerPixel) || 1));
  const sampleX = Math.floor(Number(source.sampleX));
  const sampleY = Math.floor(Number(source.sampleY));
  const slotIndex = Math.floor(Number(source.slotIndex));
  if (!(sampleX >= 0) || !(sampleY >= 0) || !(slotIndex >= 0)) return -1;
  if (sampleX >= sampleColumnCount || slotIndex >= samplesPerPixel) return -1;
  const rowWidth = sampleColumnCount * samplesPerPixel;
  return sampleY * rowWidth + sampleX * samplesPerPixel + slotIndex;
}


export function encodeLightSamplesForPixel(request) {
  const source = request || {};
  const geometry = normalizeGeometry(source);
  const destination = source.destination;
  const samples = Array.isArray(source.samples) ? source.samples : [];

  let writtenSlotCount = 0;
  let clearedSlotCount = 0;
  let refusedSampleCount = 0;
  if (!destination) return { writtenSlotCount, clearedSlotCount, refusedSampleCount: samples.length };

  for (let slotIndex = 0; slotIndex < geometry.samplesPerPixel; slotIndex += 1) {
    const texelIndex = sampleTexelIndex({
      sampleX: source.sampleX,
      sampleY: source.sampleY,
      slotIndex,
      sampleColumnCount: geometry.sampleColumnCount,
      samplesPerPixel: geometry.samplesPerPixel,
    });
    if (texelIndex < 0) continue;
    const offset = texelIndex * CHANNELS_PER_TEXEL;
    if (offset + CHANNELS_PER_TEXEL > destination.length) continue;

    const sample = findSampleForSlot(samples, slotIndex);
    if (!sample) {
      destination[offset] = EMPTY_LIGHT_INDEX;
      destination[offset + 1] = 0;
      destination[offset + 2] = 0;
      destination[offset + 3] = 0;
      clearedSlotCount += 1;
      continue;
    }

    const lightIndex = Math.floor(Number(sample.lightIndex));
    const estimatorWeight = Number(sample.estimatorWeight);
    if (!(lightIndex >= 0) || !Number.isFinite(estimatorWeight)) {


      destination[offset] = EMPTY_LIGHT_INDEX;
      destination[offset + 1] = 0;
      destination[offset + 2] = 0;
      destination[offset + 3] = 0;
      clearedSlotCount += 1;
      refusedSampleCount += 1;
      continue;
    }

    destination[offset] = lightIndex;
    destination[offset + 1] = estimatorWeight;
    destination[offset + 2] = clampUnitInterval(sample.sourcePointU);
    destination[offset + 3] = clampUnitInterval(sample.sourcePointV);
    writtenSlotCount += 1;
  }

  return { writtenSlotCount, clearedSlotCount, refusedSampleCount };
}

function findSampleForSlot(samples, slotIndex) {
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample && Math.floor(Number(sample.slotIndex)) === slotIndex) return sample;
  }
  return null;
}

function clampUnitInterval(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number < 0) return 0;
  if (number > 1) return 1;
  return number;
}


export function decodeLightSamplesForPixelInto(request) {
  const source = request || {};
  const geometry = normalizeGeometry(source);
  const texels = source.texels;
  const acquireSlot = typeof source.acquireSlot === "function" ? source.acquireSlot : null;
  let writtenSlotCount = 0;
  if (!texels || !acquireSlot) return writtenSlotCount;


  const location = {
    sampleX: source.sampleX,
    sampleY: source.sampleY,
    slotIndex: 0,
    sampleColumnCount: geometry.sampleColumnCount,
    samplesPerPixel: geometry.samplesPerPixel,
  };

  for (let slotIndex = 0; slotIndex < geometry.samplesPerPixel; slotIndex += 1) {
    location.slotIndex = slotIndex;
    const texelIndex = sampleTexelIndex(location);
    if (texelIndex < 0) continue;
    const offset = texelIndex * CHANNELS_PER_TEXEL;
    if (offset + CHANNELS_PER_TEXEL > texels.length) continue;
    const lightIndex = texels[offset];
    if (!(lightIndex >= 0)) continue;
    const slot = acquireSlot(writtenSlotCount);
    if (!slot) continue;
    slot.slotIndex = slotIndex;
    slot.lightIndex = lightIndex;
    slot.estimatorWeight = texels[offset + 1];
    slot.sourcePointU = texels[offset + 2];
    slot.sourcePointV = texels[offset + 3];
    writtenSlotCount += 1;
  }
  return writtenSlotCount;
}


export function decodeLightSamplesForPixel(request) {
  const source = request || {};
  const samples = [];
  decodeLightSamplesForPixelInto({
    texels: source.texels,
    sampleX: source.sampleX,
    sampleY: source.sampleY,
    sampleColumnCount: source.sampleColumnCount,
    sampleRowCount: source.sampleRowCount,
    samplesPerPixel: source.samplesPerPixel,
    acquireSlot() {
      const slot = {
        slotIndex: 0,
        lightIndex: EMPTY_LIGHT_INDEX,
        estimatorWeight: 0,
        sourcePointU: 0,
        sourcePointV: 0,
      };
      samples.push(slot);
      return slot;
    },
  });
  return samples;
}


export function encodedChannelNames() {
  return [
    LIGHT_SAMPLE_CHANNELS.r,
    LIGHT_SAMPLE_CHANNELS.g,
    LIGHT_SAMPLE_CHANNELS.b,
    LIGHT_SAMPLE_CHANNELS.a,
  ];
}
