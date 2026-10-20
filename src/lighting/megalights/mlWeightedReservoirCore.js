export const RESERVOIR_EMPTY_KEY = Number.NEGATIVE_INFINITY;


export const MINIMUM_UNIT_RANDOM = Number.MIN_VALUE;

function isPositiveFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}


export function reservoirSortKey(unitRandom, weight) {
  if (!isPositiveFinite(weight)) return RESERVOIR_EMPTY_KEY;
  const clampedRandom = isPositiveFinite(unitRandom) ? Math.min(unitRandom, 1) : MINIMUM_UNIT_RANDOM;
  return Math.log(clampedRandom) / weight;
}


export function createReservoirSet(slotCount) {
  const usableSlotCount = Math.max(0, Math.floor(Number(slotCount) || 0));
  const slots = [];
  for (let slotIndex = 0; slotIndex < usableSlotCount; slotIndex += 1) {
    slots.push({ slotIndex, candidate: null, weight: 0, sortKey: RESERVOIR_EMPTY_KEY });
  }
  return {
    slots,
    slotCount: usableSlotCount,
    weightSum: 0,
    candidatesConsidered: 0,
    candidatesRefused: 0,
  };
}


export function resetReservoirSet(reservoirSet) {
  if (!reservoirSet) return null;
  for (let slotIndex = 0; slotIndex < reservoirSet.slotCount; slotIndex += 1) {
    const slot = reservoirSet.slots[slotIndex];
    slot.candidate = null;
    slot.weight = 0;
    slot.sortKey = RESERVOIR_EMPTY_KEY;
  }
  reservoirSet.weightSum = 0;
  reservoirSet.candidatesConsidered = 0;
  reservoirSet.candidatesRefused = 0;
  return reservoirSet;
}


export function offerCandidateToReservoirSet(reservoirSet, candidate, weight, unitRandomForSlot) {
  if (!reservoirSet) return false;
  if (!isPositiveFinite(weight)) {
    reservoirSet.candidatesRefused += 1;
    return false;
  }
  reservoirSet.candidatesConsidered += 1;
  reservoirSet.weightSum += weight;
  for (let slotIndex = 0; slotIndex < reservoirSet.slotCount; slotIndex += 1) {
    const slot = reservoirSet.slots[slotIndex];
    const sortKey = reservoirSortKey(unitRandomForSlot(slotIndex), weight);
    if (slot.candidate === null || sortKey > slot.sortKey) {
      slot.candidate = candidate;
      slot.weight = weight;
      slot.sortKey = sortKey;
    }
  }
  return true;
}

export function selectionProbability(weight, weightSum) {
  if (!isPositiveFinite(weight) || !isPositiveFinite(weightSum)) return 0;
  return weight / weightSum;
}


export function unbiasedEstimatorWeight(weight, weightSum, slotCount) {
  if (!isPositiveFinite(weight) || !isPositiveFinite(weightSum) || !isPositiveFinite(slotCount)) return 0;
  return weightSum / (slotCount * weight);
}


export function reservoirSetSamples(reservoirSet) {
  if (!reservoirSet) return [];
  const samples = [];
  for (let slotIndex = 0; slotIndex < reservoirSet.slotCount; slotIndex += 1) {
    const slot = reservoirSet.slots[slotIndex];
    if (slot.candidate === null) continue;
    samples.push({
      slotIndex: slot.slotIndex,
      candidate: slot.candidate,
      weight: slot.weight,
      selectionProbability: selectionProbability(slot.weight, reservoirSet.weightSum),
      estimatorWeight: unbiasedEstimatorWeight(slot.weight, reservoirSet.weightSum, reservoirSet.slotCount),
    });
  }
  return samples;
}


export function describeReservoirSet(reservoirSet) {
  if (!reservoirSet) {
    return { slotCount: 0, weightSum: 0, candidatesConsidered: 0, candidatesRefused: 0, filledSlotCount: 0 };
  }
  let filledSlotCount = 0;
  for (let slotIndex = 0; slotIndex < reservoirSet.slotCount; slotIndex += 1) {
    if (reservoirSet.slots[slotIndex].candidate !== null) filledSlotCount += 1;
  }
  return {
    slotCount: reservoirSet.slotCount,
    weightSum: reservoirSet.weightSum,
    candidatesConsidered: reservoirSet.candidatesConsidered,
    candidatesRefused: reservoirSet.candidatesRefused,
    filledSlotCount,
  };
}
