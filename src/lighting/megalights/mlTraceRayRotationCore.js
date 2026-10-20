import { raysToCompleteOneSample } from "./mlTraceRayBudgetCore.js";

export const TRACE_ROTATION_LIMITS = Object.freeze({
  minimumSamplesPerPulse: 1,
});

function toWholeCount(rawValue) {
  const wholeValue = Math.floor(Number(rawValue));
  if (!Number.isFinite(wholeValue) || !(wholeValue > 0)) return 0;
  return wholeValue;
}

function toPulseIndex(rawValue) {
  const pulseIndex = Math.floor(Number(rawValue));
  if (!Number.isFinite(pulseIndex) || !(pulseIndex > 0)) return 0;
  return pulseIndex;
}


export function normalizePendingSampleIndices(rawIndices) {
  if (!Array.isArray(rawIndices)) return Object.freeze([]);
  const pendingSampleIndices = [];
  rawIndices.forEach((rawIndex) => {
    const sampleIndex = Math.floor(Number(rawIndex));
    if (Number.isFinite(sampleIndex) && sampleIndex > -1) pendingSampleIndices.push(sampleIndex);
  });
  return Object.freeze(pendingSampleIndices);
}


export function samplesServedPerPulse(request) {
  const input = request || {};
  const raysPerSample = raysToCompleteOneSample(input.tierName);
  const availableRays = toWholeCount(input.availableRays);
  if (!(raysPerSample > 0) || !(availableRays > 0)) return 0;
  return Math.floor(availableRays / raysPerSample);
}


export function rotationPulsesToServeAll(request) {
  const input = request || {};
  const pendingSampleCount = toWholeCount(input.pendingSampleCount);
  const samplesPerPulse = toWholeCount(input.samplesPerPulse);
  if (pendingSampleCount === 0) return 0;
  if (samplesPerPulse === 0) return null;
  return Math.ceil(pendingSampleCount / samplesPerPulse);
}


export function planRotationPulse(request) {
  const input = request || {};
  const pendingSampleIndices = normalizePendingSampleIndices(input.pendingSampleIndices);
  const pendingSampleCount = pendingSampleIndices.length;
  const requestedSamplesPerPulse = toWholeCount(input.samplesPerPulse);
  const pulseIndex = toPulseIndex(input.pulseIndex);
  const servedWindowSize = Math.min(requestedSamplesPerPulse, pendingSampleCount);
  const cursorStart =
    pendingSampleCount > 0 ? (pulseIndex * requestedSamplesPerPulse) % pendingSampleCount : 0;

  const servedSampleIndices = [];
  const servedPositions = new Set();
  for (let step = 0; step !== servedWindowSize; step += 1) {
    const position = (cursorStart + step) % pendingSampleCount;
    servedPositions.add(position);
    servedSampleIndices.push(pendingSampleIndices[position]);
  }

  const deferredSampleIndices = [];
  pendingSampleIndices.forEach((sampleIndex, position) => {
    if (!servedPositions.has(position)) deferredSampleIndices.push(sampleIndex);
  });

  return Object.freeze({
    pulseIndex,
    pendingSampleCount,
    requestedSamplesPerPulse,
    samplesPerPulse: servedWindowSize,
    cursorStart,
    servedSampleIndices: Object.freeze(servedSampleIndices),
    deferredSampleIndices: Object.freeze(deferredSampleIndices),
    servedCount: servedSampleIndices.length,
    deferredCount: deferredSampleIndices.length,
    pulsesToServeAll: rotationPulsesToServeAll({
      pendingSampleCount,
      samplesPerPulse: requestedSamplesPerPulse,
    }),


    starvation: pendingSampleCount > 0 && servedWindowSize === 0,
  });
}


export function runRotationCycle(request) {
  const input = request || {};
  const pendingSampleIndices = normalizePendingSampleIndices(input.pendingSampleIndices);
  const samplesPerPulse = toWholeCount(input.samplesPerPulse);
  const firstPulseIndex = toPulseIndex(input.firstPulseIndex);
  const pulsesToServeAll = rotationPulsesToServeAll({
    pendingSampleCount: pendingSampleIndices.length,
    samplesPerPulse,
  });

  const serviceCountBySampleIndex = {};
  pendingSampleIndices.forEach((sampleIndex) => {
    serviceCountBySampleIndex[sampleIndex] = 0;
  });


  const pulsesToRun = pulsesToServeAll === null ? 1 : pulsesToServeAll;
  const pulses = [];
  for (let pulse = 0; pulse !== pulsesToRun; pulse += 1) {
    const plan = planRotationPulse({
      pendingSampleIndices,
      samplesPerPulse,
      pulseIndex: firstPulseIndex + pulse,
    });
    plan.servedSampleIndices.forEach((sampleIndex) => {
      serviceCountBySampleIndex[sampleIndex] += 1;
    });
    pulses.push(plan);
  }

  const starvedSampleIndices = pendingSampleIndices.filter(
    (sampleIndex) => serviceCountBySampleIndex[sampleIndex] === 0
  );

  let duplicateServiceCount = 0;
  Object.keys(serviceCountBySampleIndex).forEach((sampleIndexKey) => {
    const serviceCount = serviceCountBySampleIndex[sampleIndexKey];
    if (serviceCount > 1) duplicateServiceCount += serviceCount - 1;
  });

  return Object.freeze({
    pendingSampleCount: pendingSampleIndices.length,
    samplesPerPulse,
    pulsesToServeAll,
    pulsesRun: pulses.length,
    pulses: Object.freeze(pulses),
    serviceCountBySampleIndex: Object.freeze(serviceCountBySampleIndex),
    everySampleServed: starvedSampleIndices.length === 0,
    starvedSampleIndices: Object.freeze(starvedSampleIndices),

    duplicateServiceCount,
  });
}
