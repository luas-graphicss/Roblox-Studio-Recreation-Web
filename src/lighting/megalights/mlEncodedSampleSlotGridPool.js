import {
  decodeLightSamplesForPixelInto,
  EMPTY_LIGHT_INDEX,
} from "./mlLightSampleEncodingCore.js";

export function createEncodedSampleSlotGridPool() {

  const liveSlotsByGridPixel = [];
  const parkedSlotsByGridPixel = [];


  const acquireTarget = { liveSlots: null, parkedSlots: null };

  function createSlot() {
    return {
      slotIndex: 0,
      lightIndex: EMPTY_LIGHT_INDEX,
      estimatorWeight: 0,
      sourcePointU: 0,
      sourcePointV: 0,
    };
  }

  function acquireSlotFromPool(writtenSlotIndex) {
    const liveSlots = acquireTarget.liveSlots;
    if (!liveSlots) return null;
    const alreadyLive = liveSlots[writtenSlotIndex];
    if (alreadyLive) return alreadyLive;
    const parkedSlots = acquireTarget.parkedSlots;
    const revived = parkedSlots && parkedSlots.length > 0 ? parkedSlots.pop() : createSlot();
    liveSlots[writtenSlotIndex] = revived;
    return revived;
  }

  const decodeRequest = {
    texels: null,
    sampleX: 0,
    sampleY: 0,
    sampleColumnCount: 1,
    sampleRowCount: 1,
    samplesPerPixel: 1,
    acquireSlot: acquireSlotFromPool,
  };


  function beginFrame(request) {
    const source = request || {};
    decodeRequest.texels = source.texels || null;
    decodeRequest.sampleColumnCount = source.sampleColumnCount;
    decodeRequest.sampleRowCount = source.sampleRowCount;
    decodeRequest.samplesPerPixel = source.samplesPerPixel;
  }


  function decodeGridPixel(gridPixelIndex, sampleX, sampleY) {
    let liveSlots = liveSlotsByGridPixel[gridPixelIndex];
    if (!liveSlots) {
      liveSlots = [];
      liveSlotsByGridPixel[gridPixelIndex] = liveSlots;
    }
    let parkedSlots = parkedSlotsByGridPixel[gridPixelIndex];
    if (!parkedSlots) {
      parkedSlots = [];
      parkedSlotsByGridPixel[gridPixelIndex] = parkedSlots;
    }

    acquireTarget.liveSlots = liveSlots;
    acquireTarget.parkedSlots = parkedSlots;
    decodeRequest.sampleX = sampleX;
    decodeRequest.sampleY = sampleY;
    const writtenSlotCount = decodeLightSamplesForPixelInto(decodeRequest);
    acquireTarget.liveSlots = null;
    acquireTarget.parkedSlots = null;


    for (let index = writtenSlotCount; index !== liveSlots.length; index += 1) {
      parkedSlots.push(liveSlots[index]);
    }
    liveSlots.length = writtenSlotCount;
    return liveSlots;
  }

  function describe() {
    return { pooledGridPixelCount: liveSlotsByGridPixel.length };
  }

  return { beginFrame, decodeGridPixel, describe };
}
